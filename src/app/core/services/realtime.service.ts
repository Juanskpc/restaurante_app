import { DestroyRef, Injectable, PLATFORM_ID, computed, effect, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Áreas de datos que el servidor puede anunciar. Coinciden con `avisoService.js`. */
export type TemaRealtime = 'pedidos' | 'mesas' | 'cocina' | 'caja' | 'clientes';

/** Espera antes de recargar, para juntar varios avisos seguidos en una sola consulta. */
const AGRUPAR_MS = 250;

/**
 * Ruido añadido a esa espera. Con doce tablets oyendo el mismo aviso, sin esto las doce
 * consultarían en el mismo milisegundo — y al otro lado hay un servidor de un solo núcleo.
 */
const DISPERSION_MS = 400;

/** Mínimo entre dos recargas del mismo tema. Protege contra una ráfaga de cambios. */
const MINIMO_ENTRE_RECARGAS_MS = 1_500;

/** Espera de reconexión: crece al fallar, hasta este tope. */
const REINTENTO_INICIAL_MS = 1_000;
const REINTENTO_MAXIMO_MS = 30_000;

/** Tras estos fallos seguidos se da por perdido el canal y se vuelve al refresco por reloj. */
const FALLOS_PARA_RESPALDO = 3;

/** Cada cuánto se recarga todo cuando el canal no se puede abrir. */
const RESPALDO_MS = 30_000;

interface Suscripcion {
  temas: TemaRealtime[];
  accion: () => void;
}

/**
 * Lee un bloque del flujo SSE y devuelve los temas que anuncia.
 *
 * Se exporta suelta —y no como método— porque es la pieza que más formas tiene de fallar: un
 * latido, un bloque partido a la mitad, un aviso sin datos, un JSON roto. Probarla aparte no
 * necesita ni servidor ni sesión.
 *
 * @returns los temas anunciados, o `null` si el bloque no es un aviso de cambio.
 */
export function parsearAvisoSse(bloque: string): TemaRealtime[] | null {
  // Las líneas que empiezan por «:» son el latido: solo sirven para que la conexión no se dé
  // por abandonada y para saber que sigue viva. No anuncian nada.
  if (!bloque.trim() || bloque.startsWith(':')) return null;

  const evento = /^event:\s*(\w+)/m.exec(bloque)?.[1];
  const datos = /^data:\s*(.*)$/m.exec(bloque)?.[1];
  if (evento !== 'cambio' || !datos) return null;

  try {
    const temas = JSON.parse(datos)?.temas;
    if (!Array.isArray(temas) || temas.length === 0) return null;
    return temas.filter((t): t is TemaRealtime => typeof t === 'string');
  } catch {
    // Un aviso ilegible no puede tumbar la conexión: se ignora y se sigue leyendo.
    return null;
  }
}

/**
 * RealtimeService — mantiene UNA conexión con el servidor por pestaña y avisa a las pantallas
 * cuando un compañero del mismo negocio cambia algo.
 *
 * ## Una sola conexión, no una por pantalla
 *
 * Es la decisión que sostiene todo lo demás. El navegador limita cuántas conexiones simultáneas
 * mantiene contra un mismo servidor (seis, cuando la conexión no es HTTP/2 — por ejemplo en
 * desarrollo contra `localhost:3000`). Una conexión por pantalla abierta se comería ese cupo y
 * dejaría al POS sin poder ni cobrar: las peticiones normales se quedarían esperando turno
 * detrás de conexiones que, por definición, no terminan nunca.
 *
 * ## Lo que llega es una señal, no los datos
 *
 * El servidor dice «cambió algo de pedidos» y esta clase llama a quien se haya apuntado a ese
 * tema para que recargue por donde siempre. Así las reglas de quién ve qué siguen viviendo en
 * un solo sitio (ver `app_core/realtime/index.js` en el backend).
 *
 * ## Nunca deja la app peor que antes
 *
 * Si el canal no se puede abrir —wifi del local, un proxy raro, el servidor saturado— pasa a
 * recargar por reloj cada 30 segundos, que es lo que hacía cocina antes de existir esto. Y al
 * reconectar recarga todo, porque lo que se perdió mientras no había línea no se reenvía: la
 * puesta al día la hace la pantalla preguntando, no el servidor recordando.
 */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly esNavegador = isPlatformBrowser(this.platformId);

  /** ¿Hay línea abierta con el servidor ahora mismo? */
  private readonly _conectado = signal(false);
  readonly conectado = this._conectado.asReadonly();

  /** El canal no se pudo abrir y se está recargando por reloj. */
  private readonly _modoRespaldo = signal(false);
  readonly modoRespaldo = this._modoRespaldo.asReadonly();

  /** Para la UI: «en vivo» o «actualizando cada 30 s». */
  readonly enVivo = computed(() => this._conectado());

  private readonly suscripciones = new Set<Suscripcion>();
  private readonly pendientes = new Set<TemaRealtime>();
  private readonly ultimaRecarga = new Map<TemaRealtime, number>();

  private controlador: AbortController | null = null;
  private negocioConectado: number | null = null;
  private fallosSeguidos = 0;
  private yaConectoAlgunaVez = false;

  private temporizadorRecarga: ReturnType<typeof setTimeout> | null = null;
  private temporizadorReintento: ReturnType<typeof setTimeout> | null = null;
  private temporizadorRespaldo: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!this.esNavegador) return;

    // La conexión sigue a la sesión: se abre cuando hay negocio activo, se rehace al cambiar
    // de negocio y se cierra al salir. Sin esto, cambiar de inquilino dejaría abierta la línea
    // del anterior y llegarían avisos de un negocio mientras se mira otro.
    effect(() => {
      const idNegocio = this.auth.isAuthenticated()
        ? this.auth.negocio()?.id_negocio ?? null
        : null;

      if (idNegocio === this.negocioConectado) return;
      this.desconectar();
      if (idNegocio) this.conectar(idNegocio);
    });

    // Con la pestaña de fondo no se recarga nada: se apunta y se pone al día al volver. Un
    // restaurante deja pestañas abiertas todo el día, y recargar lo que nadie está mirando es
    // gastar servidor a cambio de nada.
    document.addEventListener('visibilitychange', this.alCambiarVisibilidad);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', this.alCambiarVisibilidad);
      this.desconectar();
    });
  }

  /**
   * Apunta una pantalla a uno o varios temas.
   *
   * @returns la función para darse de baja. Llamarla al destruir el componente.
   *
   * @example
   *   this.destroyRef.onDestroy(
   *     this.realtime.alCambiar(['mesas', 'pedidos'], () => this.loadMesas()),
   *   );
   */
  alCambiar(temas: TemaRealtime[], accion: () => void): () => void {
    const suscripcion: Suscripcion = { temas, accion };
    this.suscripciones.add(suscripcion);
    return () => this.suscripciones.delete(suscripcion);
  }

  /** Fuerza la recarga de unos temas, como si el servidor los hubiera anunciado. */
  refrescar(temas: TemaRealtime[]): void {
    for (const tema of temas) this.pendientes.add(tema);
    this.programarRecarga();
  }

  // ============================================================
  // Conexión
  // ============================================================

  private conectar(idNegocio: number): void {
    this.negocioConectado = idNegocio;
    this.controlador = new AbortController();
    void this.bucle(idNegocio, this.controlador);
  }

  private desconectar(): void {
    this.controlador?.abort();
    this.controlador = null;
    this.negocioConectado = null;
    this.fallosSeguidos = 0;
    this.yaConectoAlgunaVez = false;
    this._conectado.set(false);
    this.detenerRespaldo();

    if (this.temporizadorReintento) {
      clearTimeout(this.temporizadorReintento);
      this.temporizadorReintento = null;
    }
  }

  /**
   * Mantiene la conexión viva: conecta, lee hasta que se corta y vuelve a intentarlo.
   *
   * Se usa `fetch` y no el `EventSource` del navegador por una razón concreta: `EventSource`
   * no deja poner cabeceras, así que el token tendría que viajar en la URL — y las URLs
   * quedan escritas en los registros de Caddy. Un token de sesión en un archivo de log es una
   * llave tirada en el suelo. Con `fetch` va en `Authorization`, como en el resto de la app.
   */
  private async bucle(idNegocio: number, controlador: AbortController): Promise<void> {
    while (!controlador.signal.aborted) {
      let abrioBien = false;

      try {
        const token = this.auth.getAccessToken();
        if (!token) return;

        const respuesta = await fetch(
          `${environment.apiUrl}/eventos?id_negocio=${idNegocio}`,
          {
            headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
            signal: controlador.signal,
          },
        );

        // 401/403: el token ya no vale o el negocio no es suyo. Reintentar no lo va a
        // arreglar y además machacaría el servidor; el resto de la app ya detecta la sesión
        // caída en su próxima petición normal.
        if (respuesta.status === 401 || respuesta.status === 403) return;
        if (!respuesta.ok || !respuesta.body) throw new Error(`HTTP ${respuesta.status}`);

        abrioBien = true;
        this.alConectar();
        await this.leer(respuesta.body, controlador.signal);
      } catch {
        // Cortarse es lo normal aquí: wifi, suspensión del equipo, reinicio del servidor.
      }

      if (controlador.signal.aborted) return;

      this._conectado.set(false);
      // Una conexión que se abrió bien y luego se cayó no cuenta como fallo: el servidor
      // estaba ahí. Solo cuentan los intentos que ni siquiera llegaron a abrirse.
      this.fallosSeguidos = abrioBien ? 0 : this.fallosSeguidos + 1;
      if (this.fallosSeguidos >= FALLOS_PARA_RESPALDO) this.activarRespaldo();

      await this.esperarReintento(controlador.signal);
    }
  }

  /** Lee el flujo y trocea los avisos, que van separados por una línea en blanco. */
  private async leer(cuerpo: ReadableStream<Uint8Array>, señal: AbortSignal): Promise<void> {
    const lector = cuerpo.getReader();
    const decodificador = new TextDecoder();
    let resto = '';

    try {
      while (!señal.aborted) {
        const { done, value } = await lector.read();
        if (done) return;

        resto += decodificador.decode(value, { stream: true });
        const bloques = resto.split('\n\n');
        resto = bloques.pop() ?? '';

        for (const bloque of bloques) this.procesar(bloque);
      }
    } finally {
      try {
        await lector.cancel();
      } catch {
        // Ya estaba cerrado.
      }
    }
  }

  private procesar(bloque: string): void {
    const temas = parsearAvisoSse(bloque);
    if (temas) this.refrescar(temas);
  }

  private alConectar(): void {
    this._conectado.set(true);
    this.fallosSeguidos = 0;
    this.detenerRespaldo();

    // Al RE-conectar hay que ponerse al día: lo que pasó mientras no había línea no se
    // reenvía. En la primera conexión no, porque las pantallas acaban de cargar sus datos y
    // sería pedirlo todo dos veces al arrancar.
    if (this.yaConectoAlgunaVez) {
      this.refrescar(['pedidos', 'mesas', 'cocina', 'caja', 'clientes']);
    }
    this.yaConectoAlgunaVez = true;
  }

  private esperarReintento(señal: AbortSignal): Promise<void> {
    const base = Math.min(
      REINTENTO_INICIAL_MS * 2 ** Math.max(0, this.fallosSeguidos - 1),
      REINTENTO_MAXIMO_MS,
    );
    // Otra vez dispersión: si se cae el servidor, no queremos que todas las tablets vuelvan
    // a llamar a la puerta en el mismo instante justo cuando está levantándose.
    const espera = base + Math.random() * DISPERSION_MS * 2;

    return new Promise((resolver) => {
      this.temporizadorReintento = setTimeout(resolver, espera);
      señal.addEventListener('abort', () => {
        if (this.temporizadorReintento) clearTimeout(this.temporizadorReintento);
        resolver();
      }, { once: true });
    });
  }

  // ============================================================
  // Recargas
  // ============================================================

  private programarRecarga(): void {
    if (this.temporizadorRecarga || this.pendientes.size === 0) return;

    const espera = AGRUPAR_MS + Math.random() * DISPERSION_MS;
    this.temporizadorRecarga = setTimeout(() => {
      this.temporizadorRecarga = null;
      this.recargarPendientes();
    }, espera);
  }

  private recargarPendientes(): void {
    // Nadie está mirando: se quedan apuntados y se recargan al volver a la pestaña.
    if (document.hidden) return;

    const ahora = Date.now();
    let hayQueEsperar = false;

    for (const tema of [...this.pendientes]) {
      const ultimo = this.ultimaRecarga.get(tema) ?? 0;
      if (ahora - ultimo < MINIMO_ENTRE_RECARGAS_MS) {
        // Se queda pendiente: no se pierde, solo se aplaza. Es lo que evita que una ráfaga
        // de cambios (un mesero metiendo diez productos) dispare diez consultas.
        hayQueEsperar = true;
        continue;
      }

      this.pendientes.delete(tema);
      this.ultimaRecarga.set(tema, ahora);

      for (const suscripcion of [...this.suscripciones]) {
        if (!suscripcion.temas.includes(tema)) continue;
        try {
          suscripcion.accion();
        } catch {
          // Una pantalla que falla al recargar no puede dejar sin avisos a las demás.
        }
      }
    }

    if (hayQueEsperar) this.programarRecarga();
  }

  private readonly alCambiarVisibilidad = (): void => {
    if (document.visibilityState !== 'visible') return;

    // Al volver, la pantalla puede llevar horas de retraso. Se pide todo lo que alguien esté
    // mirando, aunque no haya llegado ningún aviso: la pestaña pudo estar dormida y perderse
    // la conexión entera sin enterarse.
    this.refrescar(['pedidos', 'mesas', 'cocina', 'caja', 'clientes']);
  };

  // ============================================================
  // Respaldo por reloj
  // ============================================================

  private activarRespaldo(): void {
    if (this.temporizadorRespaldo) return;

    this._modoRespaldo.set(true);
    this.temporizadorRespaldo = setInterval(() => {
      this.refrescar(['pedidos', 'mesas', 'cocina', 'caja', 'clientes']);
    }, RESPALDO_MS);
  }

  private detenerRespaldo(): void {
    if (this.temporizadorRespaldo) {
      clearInterval(this.temporizadorRespaldo);
      this.temporizadorRespaldo = null;
    }
    this._modoRespaldo.set(false);
  }
}
