import { Injectable, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { AuthService } from './auth.service';
import { BandejaService } from './bandeja.service';
import { RealtimeService } from './realtime.service';

/** Cada cuánto se vuelve a preguntar mientras la pestaña está a la vista. */
const REFRESCO_MS = 30_000;

/**
 * Cuántas conversaciones esperan a una persona — para toda la app, no solo para la Bandeja.
 *
 * ## Por qué existe
 *
 * El número vivía dentro de la Bandeja, en el filtro «Esperan respuesta». Ahí solo se ve si ya
 * estás mirando las conversaciones, que es justo cuando menos falta hace: quien está en Pedidos
 * o en Caja no se entera de que hay alguien esperando. Ahora el mismo número pinta la burbuja
 * del menú (abajo en el móvil, al lado en el escritorio) y la del icono de la Bandeja.
 *
 * ## De dónde sale, y por qué no de la lista
 *
 * De un COUNT propio (`GET /intelligence/bandeja/pendientes`). Contar las filas de la lista
 * parecía gratis y no lo es: traería hasta 100 conversaciones con su último mensaje cada vez, y
 * daría un número equivocado en cuanto hubiera más de 100 esperando.
 *
 * ## Cuándo se refresca
 *
 * Tres disparadores, ninguno redundante:
 *   1. **Al arrancar el layout**, para que la burbuja esté bien en la primera pantalla.
 *   2. **Cada vez que el servidor avisa de una escalada** (SSE `escalada`). Es el camino rápido:
 *      el número sube en el segundo en que el cliente escribe.
 *   3. **Un sondeo lento de respaldo**, porque el número también BAJA —alguien contesta desde
 *      otro equipo, o el asistente retoma— y de eso no hay evento. Sin él, la burbuja se
 *      quedaría encendida enseñando trabajo que ya se hizo.
 *
 * El sondeo se detiene con la pestaña en segundo plano: una burbuja que nadie está mirando no
 * justifica una petición cada 30 s por cada equipo del local.
 */
@Injectable({ providedIn: 'root' })
export class ConversacionesPendientesService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly bandeja = inject(BandejaService);
  private readonly realtime = inject(RealtimeService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly _total = signal(0);
  /** Cuántas esperan respuesta. 0 mientras no se sepa: una burbuja es una afirmación. */
  readonly total = this._total.asReadonly();
  /** ¿Se pinta la burbuja? Con cero no hay nada que avisar. */
  readonly hay = computed(() => this._total() > 0);

  private temporizador: ReturnType<typeof setInterval> | null = null;
  private dejarDeEscuchar: (() => void) | null = null;
  private arrancado = false;

  /**
   * Empieza a vigilar. Lo llama el layout una vez; llamarlo de nuevo no duplica nada.
   *
   * No se arranca solo en el constructor a propósito: el servicio es `providedIn: 'root'` y se
   * instancia con la primera inyección, que puede ser durante el render del servidor o antes de
   * que haya sesión. Pedir el contador ahí es una petición que se sabe que va a fallar.
   */
  iniciar(): void {
    if (!this.isBrowser || this.arrancado) return;
    this.arrancado = true;

    this.refrescar();
    this.dejarDeEscuchar = this.realtime.alAvisar('escalada', () => this.refrescar());

    this.temporizador = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.refrescar();
    }, REFRESCO_MS);
  }

  /**
   * Vuelve a preguntar. Público porque la Bandeja lo llama al contestar o marcar atendida: ahí
   * el número cambia por algo que hizo esta misma persona, y esperar al sondeo deja la burbuja
   * mintiendo durante medio minuto delante de quien acaba de vaciarla.
   */
  refrescar(): void {
    if (!this.isBrowser || !this.auth.isAuthenticated()) return;
    // Sin permiso de la vista no hay burbuja que pintar, y el backend respondería 403: un
    // mesero no tiene por qué pagar una petición por un aviso que no puede atender.
    if (!this.auth.canAccessRoute('/conversaciones')) {
      this._total.set(0);
      return;
    }

    this.bandeja.getPendientes(this.auth.negocio()?.id_negocio ?? null).subscribe({
      next: (total) => this._total.set(total),
      // Un fallo de red no apaga la burbuja: lo que se sabía sigue siendo lo mejor que hay.
      // Borrarla haría creer que ya no espera nadie, que es el error caro de los dos.
      error: () => {},
    });
  }

  /** La Bandeja ya tiene el número exacto cuando está abierta: se lo pasa y evita una petición. */
  fijar(total: number): void {
    this._total.set(Math.max(0, total));
  }

  ngOnDestroy(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.dejarDeEscuchar?.();
  }
}
