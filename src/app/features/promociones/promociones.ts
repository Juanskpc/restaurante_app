import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal,
} from '@angular/core';
import {
  CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet, TitleCasePipe,
} from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
import {
  Audiencia, Campana, CodigoSegmento, Destinatario, Elegibilidad, EstadoCampana, InformeCampana,
  PlantillaPromo, PromocionesService, Segmento, Simulacion,
} from '../../core/services/promociones.service';
import { UiFeedbackService } from '../../core/ui-feedback/ui-feedback.service';
import { ModalCabeceraComponent } from '../conversaciones/shared/modal-cabecera';

/** Cuántos clientes se piden de una vez. La clientela de un restaurante son cientos, no miles. */
const LIMITE_LISTA = 500;

/**
 * Una sola pantalla para armar la promoción, y el historial aparte.
 *
 * Antes eran tres pasos; el dueño solo quiere tres cosas a la vista —qué dice, a cuántos le llega
 * y cuánto le cobran—, así que eso es la pantalla y todo lo demás (la lista de clientes, la cuenta
 * del costo, la prueba y el envío) va en ventanas que abre quien lo quiera ver.
 */
type Vista = 'crear' | 'historial';

/** Las ventanas de la pantalla de crear. El informe del historial tiene la suya aparte. */
type Ventana = 'lista' | 'costo' | 'enviar';

/** Cada cuánto se le pregunta al servidor si la prueba ya llegó, y cuántas veces (~2 minutos). */
const PRUEBA_INTERVALO_MS = 4000;
const PRUEBA_INTENTOS = 30;

/** Lo que acepta WhatsApp en el encabezado de una plantilla, que es lo que valida el servidor. */
const IMAGEN_TIPOS = ['image/jpeg', 'image/png'];
const IMAGEN_MAX_BYTES = 5 * 1024 * 1024;

/** El color de la etiqueta de estado en el historial: clases `tag--*` de la hoja de estilos. */
type TonoEstado = 'neutro' | 'marca' | 'bien' | 'alerta' | 'mal';

/** En qué va la prueba al móvil del dueño, para pintarlo sin que tenga que recargar. */
type EstadoPrueba = 'sin_mandar' | 'esperando' | 'tardando' | 'llego' | 'fallo';

/** Un icono por grupo: se reconoce antes de leerlo. Todos están en el registro de `app.config`. */
const ICONO_SEGMENTO: Record<CodigoSegmento, string> = {
  en_riesgo: 'clock',
  dormido: 'moon',
  ocasional: 'user-plus',
  intermedio: 'trending-up',
  frecuente: 'star',
  sin_actividad: 'circle-slash',
};

/**
 * Cómo se le nombra cada grupo al dueño del negocio.
 *
 * Los nombres del servidor («De una sola vez», «Intermedios») son exactos pero de quien diseñó la
 * segmentación; en la tarjeta va la frase que diría el dueño, y el detalle del servidor se lee al
 * desplegarla. Si llega un grupo que no está aquí, se usan los textos del servidor.
 */
const TEXTO_GRUPO: Record<CodigoSegmento, { titulo: string; sub: string }> = {
  en_riesgo: { titulo: 'Hace rato no vuelven', sub: 'Su último pedido fue hace 1 a 4 meses' },
  dormido: { titulo: 'Hace mucho no vuelven', sub: 'Llevan más de 4 meses sin pedir' },
  ocasional: { titulo: 'Pidieron una sola vez', sub: 'Probaron hace poco y no han repetido' },
  intermedio: { titulo: 'Piden de vez en cuando', sub: '2 o 3 pedidos, el último hace poco' },
  frecuente: { titulo: 'Tus clientes fieles', sub: 'Piden seguido: casi nunca hace falta escribirles' },
  sin_actividad: { titulo: 'Registrados sin pedidos', sub: 'Están en tu lista pero nunca han pedido' },
};

/**
 * Promociones — a quién le puedes escribir y cuánto costaría (F1).
 *
 * ## Qué resuelve esta pantalla, con las palabras del dueño
 *
 * > «Quiero sacar una promoción de 2 hamburguesas por $20.000, será para todos. Pero como tengo
 * > clientes activos, a estos no necesito enviarles mensaje, sino a los clientes no frecuentes
 * > para recuperar esta clientela.»
 *
 * O sea que el valor no está en poder mandarle a todos: está en **poder no mandarle al que ya
 * viene**. Por eso lo primero que se ve no es un botón de enviar, son los segmentos con su conteo,
 * y «Frecuentes» aparece marcado como el grupo al que normalmente NO hay que escribirle.
 *
 * ## Todavía no envía, y se dice en la primera línea
 *
 * F1 cuenta, segmenta y simula. El envío es F2 y el precio por crédito es F3. Una pantalla que
 * pareciera capaz de enviar y no lo hiciera sería peor que no tenerla, así que el aviso va arriba y
 * no hay ningún botón que insinúe otra cosa.
 *
 * ## Las tres cifras que tiene que dejar claras
 *
 *   1. **A cuántos se puede escribir de verdad**, que casi nunca es «todos mis clientes».
 *   2. **Qué cobra Meta y qué cobramos nosotros**, por separado y dicho quién cobra cada cosa: el
 *      cargo de Meta va a la tarjeta del negocio, no a su factura de EscalApp.
 *   3. **Cuántos pedidos tiene que traer para empatar**, calculado con el MARGEN y no con la venta
 *      (ver `simulador.js`: con la venta la cifra sale inflada y la primera campaña lo desmiente).
 */
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [
    FormsModule, CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet, TitleCasePipe,
    LucideAngularModule, ModalCabeceraComponent,
  ],
  templateUrl: './promociones.html',
  styleUrl: './promociones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'alEscape()' },
})
export class PromocionesComponent implements OnInit {
  private readonly promociones = inject(PromocionesService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dejarDeVigilarPrueba());
  }

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly audiencia = signal<Audiencia | null>(null);

  readonly cargandoLista = signal(false);
  readonly destinatarios = signal<Destinatario[]>([]);
  readonly totalLista = signal(0);
  readonly busqueda = signal('');

  /** Los segmentos elegidos. Vacío = todavía no hay nada que simular. */
  readonly seleccionados = signal<Set<CodigoSegmento>>(new Set());

  /**
   * Clientes quitados a mano de la selección.
   *
   * Se guarda a quién se **excluye** y no a quién se incluye: así, al cambiar de segmento, la
   * selección sigue siendo «todo el segmento menos estos» sin tener que rehacerla.
   */
  readonly quitados = signal<Set<string>>(new Set());

  /** Mostrar también a los que NO van a recibir nada, con su motivo. */
  readonly verExcluidos = signal(false);

  readonly simulacion = signal<Simulacion | null>(null);
  readonly simulando = signal(false);

  /** Margen bruto con el que se calcula el punto de equilibrio. Lo mueve el dueño. */
  readonly margen = signal(30);

  readonly resumen = computed(() => this.audiencia()?.resumen ?? null);
  readonly etiqueta = computed(() => this.audiencia()?.etiqueta ?? { uno: 'pedido', varios: 'pedidos' });

  readonly segmentos = computed<Segmento[]>(() =>
    [...(this.audiencia()?.segmentos ?? [])].sort((a, b) => a.orden - b.orden),
  );

  /** Lo que de verdad se enviaría: los contactables de los segmentos elegidos, menos los quitados. */
  readonly totalSeleccionado = computed(() => {
    const elegidos = this.seleccionados();
    const base = this.segmentos()
      .filter((s) => elegidos.has(s.codigo))
      .reduce((n, s) => n + s.contactables, 0);
    return Math.max(0, base - this.quitados().size);
  });

  readonly hayAlgoElegido = computed(() => this.seleccionados().size > 0);

  /** La lista que se pinta: con el filtro de búsqueda aplicado aquí, sin ir al servidor. */
  readonly listaVisible = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    const lista = this.destinatarios();
    if (!q) return lista;
    return lista.filter(
      (d) =>
        d.cliente.toLowerCase().includes(q) ||
        (digitos && (d.telefono ?? '').includes(digitos)),
    );
  });

  ngOnInit(): void {
    this.horaVistaPrevia.set(
      new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }),
    );
    this.cargarAudiencia();
    this.cargarPlantillas();
  }

  /** El negocio activo, igual que en el resto de las vistas. */
  private readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  private get idNegocio(): number | null {
    return this.negocioId();
  }

  cargarAudiencia(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) {
      this.cargando.set(false);
      this.error.set('No hay un negocio activo.');
      return;
    }

    this.cargando.set(true);
    this.promociones.audiencia(idNegocio).subscribe({
      next: (datos) => {
        this.audiencia.set(datos);
        this.error.set('');
        this.cargando.set(false);
        // Arranca con los segmentos recomendados ya marcados: es la respuesta a «¿a quién le
        // mando?» para quien abre esto por primera vez, y se puede deshacer con un clic.
        const recomendados = datos.segmentos
          .filter((s) => s.recomendado && s.contactables > 0)
          .map((s) => s.codigo);
        // Al recargar (tras una baja) se respeta lo que el dueño ya había elegido.
        if (this.seleccionados().size === 0 && recomendados.length) {
          this.seleccionados.set(new Set(recomendados));
        }
        if (this.seleccionados().size > 0) {
          this.cargarDestinatarios();
          this.simular();
        }
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.error?.message || 'No se pudo cargar la audiencia.');
      },
    });
  }

  alternarSegmento(codigo: CodigoSegmento): void {
    const actual = new Set(this.seleccionados());
    if (actual.has(codigo)) actual.delete(codigo);
    else actual.add(codigo);
    this.seleccionados.set(actual);
    // Al cambiar de grupo, los quitados a mano del grupo anterior dejan de tener sentido.
    this.quitados.set(new Set());
    this.cargarDestinatarios();
    this.simular();
  }

  alternarVerExcluidos(): void {
    this.verExcluidos.update((v) => !v);
    this.cargarDestinatarios();
  }

  cargarDestinatarios(): void {
    const idNegocio = this.idNegocio;
    const elegidos = [...this.seleccionados()];
    if (!idNegocio || !elegidos.length) {
      this.destinatarios.set([]);
      this.totalLista.set(0);
      return;
    }

    this.cargandoLista.set(true);
    this.promociones
      .destinatarios({
        idNegocio,
        segmentos: elegidos,
        soloContactables: !this.verExcluidos(),
        limite: LIMITE_LISTA,
      })
      .subscribe({
        next: (datos) => {
          this.destinatarios.set(datos.destinatarios);
          this.totalLista.set(datos.total);
          this.cargandoLista.set(false);
        },
        error: () => {
          this.cargandoLista.set(false);
          this.ui.error('No se pudo cargar la lista de clientes.');
        },
      });
  }

  /** Quita o devuelve un cliente a la selección de ESTA campaña (no es una baja). */
  alternarQuitado(d: Destinatario): void {
    const actual = new Set(this.quitados());
    if (actual.has(d.id_persona_negocio)) actual.delete(d.id_persona_negocio);
    else actual.add(d.id_persona_negocio);
    this.quitados.set(actual);
    this.simular();
  }

  estaQuitado(d: Destinatario): boolean {
    return this.quitados().has(d.id_persona_negocio);
  }

  simular(): void {
    const idNegocio = this.idNegocio;
    const elegidos = [...this.seleccionados()];
    if (!idNegocio || !elegidos.length) {
      this.simulacion.set(null);
      return;
    }

    // Con clientes quitados a mano se mandan los ids; si no, basta con los segmentos — y así el
    // servidor vuelve a resolver quién es contactable en ese momento.
    const quitados = this.quitados();
    const personas = quitados.size
      ? this.destinatarios()
          .filter((d) => d.contactable && !quitados.has(d.id_persona_negocio))
          .map((d) => d.id_persona_negocio)
      : undefined;

    this.simulando.set(true);
    this.promociones
      .simular({
        idNegocio,
        segmentos: personas ? undefined : (elegidos as CodigoSegmento[]),
        personas,
        margen: this.margen() / 100,
      })
      .subscribe({
        next: (s) => {
          this.simulacion.set(s);
          this.simulando.set(false);
        },
        error: (e) => {
          this.simulando.set(false);
          this.simulacion.set(null);
          // 422 con PROMOS_SIN_DESTINATARIOS es normal: el dueño quitó a todo el mundo.
          if (e?.status !== 422) this.ui.error('No se pudo calcular el costo.');
        },
      });
  }

  cambiarMargen(valor: string | number): void {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 1 || n > 100) return;
    this.margen.set(Math.round(n));
    this.simular();
  }

  /**
   * La baja de verdad: este cliente no vuelve a recibir promociones de este negocio.
   *
   * Es para quien lo pide en el mostrador o por teléfono. No se confunde con quitarlo de la
   * selección de una campaña: eso es `alternarQuitado`, y por eso están en botones distintos con
   * palabras distintas.
   */
  darDeBaja(d: Destinatario): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    this.promociones.baja(idNegocio, d.id_persona_negocio).subscribe({
      next: () => {
        this.ui.success(`${d.cliente} no volverá a recibir promociones.`, 'Baja registrada');
        this.cargarAudiencia();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo registrar la baja.'),
    });
  }

  /** Deshace la baja. */
  readmitir(d: Destinatario): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    this.promociones.readmitir(idNegocio, d.id_persona_negocio).subscribe({
      next: () => {
        this.ui.success(`${d.cliente} vuelve a recibir promociones.`);
        this.cargarAudiencia();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo readmitir al cliente.'),
    });
  }

  /** El texto del motivo por el que alguien no recibe nada. */
  motivo(d: Destinatario): string {
    switch (d.motivo_exclusion) {
      case 'pidio_baja':
        return 'Pidió no recibir promociones';
      case 'bloqueo_whatsapp':
        return 'Se dio de baja de todo el WhatsApp';
      case 'sin_telefono':
        return 'No tiene teléfono registrado';
      default:
        return '';
    }
  }

  /** «hace 3 días» / «hace 2 meses». El dueño piensa en eso, no en fechas. */
  haceCuanto(dias: number | null): string {
    if (dias === null || dias === undefined) return 'nunca';
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 30) return `hace ${dias} días`;
    const meses = Math.round(dias / 30);
    return meses <= 1 ? 'hace un mes' : `hace ${meses} meses`;
  }

  nombreSegmento(codigo: CodigoSegmento): string {
    return this.segmentos().find((s) => s.codigo === codigo)?.nombre ?? codigo;
  }

  iconoSegmento(codigo: CodigoSegmento): string {
    return ICONO_SEGMENTO[codigo] ?? 'users';
  }

  textoGrupo(s: Segmento): { titulo: string; sub: string } {
    return TEXTO_GRUPO[s.codigo] ?? { titulo: s.nombre, sub: s.descripcion };
  }

  /** Las tarjetas de grupo desplegadas. Se abren sin marcar el grupo: leer no es elegir. */
  readonly grupoAbierto = signal<Set<CodigoSegmento>>(new Set());

  alternarInfoGrupo(codigo: CodigoSegmento): void {
    const abiertos = new Set(this.grupoAbierto());
    if (abiertos.has(codigo)) abiertos.delete(codigo);
    else abiertos.add(codigo);
    this.grupoAbierto.set(abiertos);
  }

  // ── F2: el mensaje, el envío y el historial ───────────────────────────────────────────

  readonly vista = signal<Vista>('crear');
  readonly modal = signal<Ventana | null>(null);

  readonly plantillas = signal<PlantillaPromo[]>([]);
  readonly preparandoPlantillas = signal(false);

  readonly oferta = signal('');
  readonly imagenUrl = signal<string | null>(null);
  readonly subiendoImagen = signal(false);
  /** Hay un archivo encima de la zona de la imagen: se resalta para que se vea dónde soltarlo. */
  readonly arrastrando = signal(false);

  readonly gate = signal<Elegibilidad | null>(null);
  readonly campana = signal<Campana | null>(null);
  readonly preparando = signal(false);
  readonly probando = signal(false);
  /**
   * A qué móvil llega la prueba.
   *
   * Se pregunta y no se deduce: el número del negocio es el que ENVÍA, y WhatsApp no se manda
   * mensajes a sí mismo, así que la prueba tiene que llegar al móvil de quien la va a mirar.
   */
  readonly telefonoPrueba = signal('');
  readonly enviando = signal(false);

  readonly historial = signal<Campana[]>([]);
  readonly informe = signal<InformeCampana | null>(null);
  /** La promoción cuyo informe se está pidiendo, para marcar su botón mientras llega. */
  readonly cargandoInforme = signal<string | null>(null);

  // ── La vista previa de WhatsApp ──

  readonly nombreNegocio = computed(() => this.auth.negocio()?.nombre ?? 'Tu negocio');
  readonly inicialNegocio = computed(() => this.nombreNegocio().trim().charAt(0).toUpperCase());

  /** La hora de la burbuja: la de ahora, que es como se vería si llegara en este momento. */
  readonly horaVistaPrevia = signal('');

  readonly plantillaTexto = computed(
    () => this.plantillas().find((p) => !p.necesita_imagen) ?? null,
  );
  readonly plantillaImagen = computed(
    () => this.plantillas().find((p) => p.necesita_imagen) ?? null,
  );

  readonly hayPlantillaUsable = computed(() => this.plantillas().some((p) => p.usable));
  readonly algunaPendiente = computed(() =>
    this.plantillas().some((p) => p.estado === 'PENDIENTE'),
  );

  /**
   * Hay imagen subida y su plantilla aún no se ha pedido (o la rechazaron). Mientras la de texto
   * espera revisión, es lo único que se puede pedir — y sin esto el botón quedaba escondido.
   */
  readonly falteImagenPorPedir = computed(() => {
    const estado = this.plantillaImagen()?.estado;
    return Boolean(this.imagenUrl()) && estado !== 'PENDIENTE' && estado !== 'APPROVED';
  });

  /**
   * La plantilla con la que sale la promoción. No se elige: la decide la imagen.
   *
   * Con imagen y la plantilla de imagen aprobada, esa; si no, la de texto. Preguntarle al dueño
   * «¿formato texto o imagen?» era hacerle decidir algo que ya dijo al subir (o no) una imagen.
   */
  readonly plantillaAUsar = computed<PlantillaPromo | null>(() => {
    const imagen = this.plantillaImagen();
    if (this.imagenUrl() && imagen?.usable) return imagen;
    const texto = this.plantillaTexto();
    return texto?.usable ? texto : null;
  });

  /**
   * La que se pinta en la vista previa: la que se va a usar o, mientras WhatsApp no apruebe
   * ninguna, la que se usaría. Así el dueño ve su mensaje desde el primer momento.
   */
  readonly plantillaVista = computed<PlantillaPromo | null>(() => {
    const aUsar = this.plantillaAUsar();
    if (aUsar) return aUsar;
    if (this.hayPlantillaUsable()) return this.plantillaTexto();
    return (this.imagenUrl() ? this.plantillaImagen() : this.plantillaTexto()) ?? null;
  });

  /**
   * La vista previa: el cuerpo aprobado con los huecos rellenos.
   *
   * Se compone aquí con el texto que devuelve el servidor —y no con una copia escrita en el
   * frontend— para que lo que el dueño ve sea **exactamente** lo que Meta aprobó. Una vista previa
   * que se parece pero no es igual es peor que no tener vista previa. Por lo mismo, la oferta va
   * en una sola línea: el servidor junta los saltos porque Meta rechaza una variable con ellos.
   */
  readonly vistaPrevia = computed(() => {
    const p = this.plantillaVista();
    const oferta = this.oferta().replace(/\s+/g, ' ').trim();
    if (!p?.cuerpo) return oferta || 'Aquí aparece tu promoción.';
    const valores: Record<string, string> = {
      cliente: 'Ana',
      negocio: this.auth.negocio()?.nombre ?? 'tu negocio',
      oferta: oferta || '(aquí va tu promoción)',
    };
    return p.parametros.reduce(
      (texto, clave, i) => texto.replaceAll(`{{${i + 1}}}`, valores[clave] ?? ''),
      p.cuerpo,
    );
  });

  /** ¿Se puede abrir la ventana de enviar? */
  readonly mensajeListo = computed(
    () =>
      Boolean(this.plantillaAUsar())
      && this.oferta().trim().length >= 3
      && this.totalSeleccionado() > 0,
  );

  /** Lo que falta para poder seguir, dicho en una línea debajo del botón. */
  readonly queFalta = computed(() => {
    if (this.totalSeleccionado() === 0) return 'Elige a qué clientes se la mandas.';
    if (this.oferta().trim().length < 3) return 'Escribe tu promoción.';
    if (!this.plantillaAUsar()) return 'Falta que WhatsApp apruebe el formato del mensaje.';
    return '';
  });

  /** Algo del costo que el dueño debería leer: se avisa al lado de la cifra, el detalle en la ventana. */
  readonly hayAvisosDeCosto = computed(() => {
    const s = this.simulacion();
    if (!s) return false;
    return s.sin_entrega > 0
      || s.sin_tarifa_confirmada > 0
      || Boolean(s.asistente.cupo && !s.asistente.cupo.alcanza);
  });

  /** Lo de WhatsApp más lo de EscalApp, en pesos. `null` si lo de Meta no tiene valor en pesos. */
  readonly costoTotal = computed<number | null>(() => {
    const s = this.simulacion();
    if (!s || s.meta.costo_estimado_local === null) return null;
    return s.meta.costo_estimado_local + (s.escalapp.precio_local ?? 0);
  });

  /** A cuántos sale: lo que congeló la promoción preparada, o lo elegido si aún no hay. */
  readonly destinatariosCampana = computed(
    () => this.campana()?.destinatarios || this.totalSeleccionado(),
  );

  verHistorial(): void {
    this.vista.set('historial');
    this.cargarHistorial();
  }

  abrirModal(ventana: Ventana): void {
    this.modal.set(ventana);
  }

  cerrarModal(): void {
    if (this.modal() === 'enviar') this.dejarDeVigilarPrueba();
    this.modal.set(null);
  }

  /** Mientras está abierta la confirmación de enviar, Escape es de ella, no de la ventana. */
  private confirmando = false;

  alEscape(): void {
    if (this.confirmando) return;
    if (this.informe()) this.cerrarInforme();
    else if (this.modal()) this.cerrarModal();
  }

  cargarPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.plantillas(idNegocio).subscribe({
      next: (lista) => this.plantillas.set(lista),
      error: () => this.ui.error('No se pudieron leer las plantillas.'),
    });
  }

  /**
   * Pedir y comprobar devuelven solo el ESTADO de cada plantilla, sin su texto (eso lo trae
   * `GET /plantillas`). Reemplazar la lista con esa respuesta dejaba la vista previa sin saludo,
   * sin despedida y sin botón: se conserva el texto que ya se tenía, por nombre.
   */
  private conTextos(lista: PlantillaPromo[]): PlantillaPromo[] {
    const previas = new Map(this.plantillas().map((p) => [p.nombre, p]));
    const sinTexto = lista.some((p) => !p.cuerpo && !previas.get(p.nombre)?.cuerpo);
    if (sinTexto) this.cargarPlantillas();
    return lista.map((p) => {
      const previa = previas.get(p.nombre);
      return {
        ...p,
        cuerpo: p.cuerpo ?? previa?.cuerpo ?? null,
        pie: p.pie ?? previa?.pie ?? null,
        botones: p.botones ?? previa?.botones ?? [],
        parametros: p.parametros ?? previa?.parametros ?? [],
      };
    });
  }

  /**
   * Le pide a Meta las plantillas que falten.
   *
   * Conviene hacerlo con tiempo: Meta tarda de minutos a 24 horas en revisarlas, y hasta que
   * apruebe no se puede enviar nada.
   */
  prepararPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.preparandoPlantillas.set(true);
    this.promociones.asegurarPlantillas(idNegocio, this.imagenUrl()).subscribe({
      next: (lista) => {
        this.plantillas.set(this.conTextos(lista));
        this.preparandoPlantillas.set(false);
        this.ui.success(
          lista.every((p) => p.usable)
            ? 'WhatsApp ya aprobó el formato.'
            : 'Pedido a WhatsApp. Suele tardar unos minutos; vuelve a comprobar en un rato.',
          'Plantillas',
        );
      },
      error: (e) => {
        this.preparandoPlantillas.set(false);
        this.ui.error(e?.error?.message || 'No se pudieron pedir las plantillas.');
      },
    });
  }

  comprobarPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.preparandoPlantillas.set(true);
    this.promociones.sincronizarPlantillas(idNegocio).subscribe({
      next: (lista) => {
        this.plantillas.set(this.conTextos(lista));
        this.preparandoPlantillas.set(false);
        if (!lista.some((p) => p.usable)) {
          this.ui.info('Todavía no lo aprueba. Vuelve a comprobar en unos minutos.', 'WhatsApp');
        }
      },
      error: () => {
        this.preparandoPlantillas.set(false);
        this.ui.error('No se pudo consultar el estado en WhatsApp.');
      },
    });
  }

  subirImagen(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    // Se vacía para que elegir otra vez el mismo archivo vuelva a disparar el cambio.
    input.value = '';
    if (archivo) this.subirArchivo(archivo);
  }

  /** Sin esto el navegador no deja soltar: por defecto abre el archivo en la pestaña. */
  alArrastrar(evento: DragEvent): void {
    evento.preventDefault();
    if (!this.subiendoImagen()) this.arrastrando.set(true);
  }

  alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    const archivo = evento.dataTransfer?.files?.[0];
    if (archivo && !this.subiendoImagen()) this.subirArchivo(archivo);
  }

  private subirArchivo(archivo: File): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    // Lo mismo que rechaza el servidor, dicho antes de subir cinco megas para nada. Al soltar un
    // archivo el `accept` del campo no filtra, así que aquí es donde se comprueba.
    if (!IMAGEN_TIPOS.includes(archivo.type)) {
      this.ui.error('La imagen tiene que ser JPG o PNG.');
      return;
    }
    if (archivo.size > IMAGEN_MAX_BYTES) {
      this.ui.error('La imagen pesa más de 5 MB. Prueba con una más liviana.');
      return;
    }

    this.subiendoImagen.set(true);
    this.promociones.subirImagen(idNegocio, archivo).subscribe({
      next: ({ url }) => {
        this.imagenUrl.set(url);
        this.subiendoImagen.set(false);
      },
      error: (e) => {
        this.subiendoImagen.set(false);
        this.ui.error(e?.error?.message || 'No se pudo subir la imagen.');
      },
    });
  }

  quitarImagen(): void {
    this.imagenUrl.set(null);
  }

  /**
   * @param vigilar si la prueba ya salió y todavía no se sabe si llegó, se sigue preguntando. Es
   *   para quien vuelve a este paso con la prueba en camino.
   */
  cargarGate(vigilar = false): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones
      .elegibilidad(idNegocio, {
        idCampana: this.campana()?.id_campana,
        destinatarios: this.totalSeleccionado(),
      })
      .subscribe({
        next: (g) => {
          this.gate.set(g);
          if (vigilar && g.prueba.hecha && !g.prueba.entregada && !this.pruebaFallida(g)) {
            this.vigilarPrueba();
          }
        },
        error: () => this.ui.error('No se pudo comprobar si se puede enviar.'),
      });
  }

  // ── La prueba: se sigue preguntando hasta que llega ───────────────────────────────────

  private relojPrueba: ReturnType<typeof setInterval> | null = null;

  /** Se agotó la espera sin respuesta de WhatsApp: se deja de preguntar y se ofrece reintentar. */
  readonly pruebaTardando = signal(false);

  private pruebaFallida(g: Elegibilidad): boolean {
    const estado = String(g.prueba.estado ?? '').toLowerCase();
    return Boolean(g.prueba.codigo_error) || estado === 'fallido' || estado === 'failed';
  }

  readonly estadoPrueba = computed<EstadoPrueba>(() => {
    const g = this.gate();
    if (!g?.prueba.hecha) return 'sin_mandar';
    if (g.prueba.entregada) return 'llego';
    if (this.pruebaFallida(g)) return 'fallo';
    return this.pruebaTardando() ? 'tardando' : 'esperando';
  });

  /**
   * Pregunta cada pocos segundos si la prueba llegó, y para sola.
   *
   * El acuse de WhatsApp tarda entre uno y unos cuantos segundos, y a veces más: mirar una sola
   * vez dejaba la pantalla en «esperando» hasta que el dueño recargaba.
   */
  vigilarPrueba(): void {
    const idNegocio = this.idNegocio;
    const idCampana = this.campana()?.id_campana;
    if (!idNegocio || !idCampana) return;

    this.dejarDeVigilarPrueba();
    this.pruebaTardando.set(false);

    let intentos = 0;
    this.relojPrueba = setInterval(() => {
      intentos += 1;
      this.promociones
        .elegibilidad(idNegocio, { idCampana, destinatarios: this.totalSeleccionado() })
        .subscribe({
          next: (g) => {
            // Una respuesta que llega después de parar (o de salir del paso) ya no se pinta.
            if (!this.relojPrueba) return;
            this.gate.set(g);
            if (g.prueba.entregada) {
              this.dejarDeVigilarPrueba();
              this.ui.success('La prueba llegó. Ya puedes enviar la promoción.', 'Prueba recibida');
            } else if (this.pruebaFallida(g)) {
              this.dejarDeVigilarPrueba();
            } else if (intentos >= PRUEBA_INTENTOS) {
              this.dejarDeVigilarPrueba();
              this.pruebaTardando.set(true);
            }
          },
          error: () => {
            // Un fallo de red suelto no corta la espera; el último sí la cierra.
            if (this.relojPrueba && intentos >= PRUEBA_INTENTOS) {
              this.dejarDeVigilarPrueba();
              this.pruebaTardando.set(true);
            }
          },
        });
    }, PRUEBA_INTERVALO_MS);
  }

  private dejarDeVigilarPrueba(): void {
    if (this.relojPrueba) clearInterval(this.relojPrueba);
    this.relojPrueba = null;
  }

  /**
   * Lo que define una promoción preparada. Si no cambió desde la última vez, se reabre la misma
   * en vez de crear otra: así no se pierde la prueba ya mandada ni se llena el historial de
   * borradores cada vez que el dueño abre y cierra la ventana.
   */
  private firmaPreparada: string | null = null;

  private firmaActual(): string {
    return JSON.stringify({
      plantilla: this.plantillaAUsar()?.nombre ?? null,
      oferta: this.oferta().trim(),
      imagen: this.plantillaAUsar()?.necesita_imagen ? this.imagenUrl() : null,
      segmentos: [...this.seleccionados()].sort(),
      quitados: [...this.quitados()].sort(),
    });
  }

  /** «Revisar y enviar»: prepara la promoción (sin mandar nada) y abre la ventana de envío. */
  revisarYEnviar(): void {
    if (!this.mensajeListo()) return;
    if (this.campana() && this.firmaPreparada === this.firmaActual()) {
      this.modal.set('enviar');
      this.cargarGate(true);
      return;
    }
    this.prepararCampana();
  }

  /** Arma la campaña: congela la lista y deja el costo guardado. Todavía no manda nada. */
  private prepararCampana(): void {
    const idNegocio = this.idNegocio;
    const plantilla = this.plantillaAUsar();
    if (!idNegocio || !plantilla || !this.mensajeListo()) return;

    const quitados = this.quitados();
    const personas = quitados.size
      ? this.destinatarios()
          .filter((d) => d.contactable && !quitados.has(d.id_persona_negocio))
          .map((d) => d.id_persona_negocio)
      : undefined;

    const firma = this.firmaActual();
    const oferta = this.oferta().replace(/\s+/g, ' ').trim();
    this.preparando.set(true);
    this.gate.set(null);
    this.promociones
      .crearCampana({
        idNegocio,
        // El nombre para el historial sale del propio texto: pedirlo aparte era un campo más que
        // nadie llenaba.
        nombre: oferta.length > 60 ? `${oferta.slice(0, 57)}…` : oferta,
        plantilla: plantilla.nombre,
        oferta,
        imagenUrl: plantilla.necesita_imagen ? this.imagenUrl() : null,
        segmentos: personas ? undefined : ([...this.seleccionados()] as CodigoSegmento[]),
        personas,
        margen: this.margen() / 100,
      })
      .subscribe({
        next: (c) => {
          this.campana.set(c);
          this.firmaPreparada = firma;
          this.preparando.set(false);
          this.modal.set('enviar');
          this.cargarGate();
        },
        error: (e) => {
          this.preparando.set(false);
          this.ui.error(e?.error?.message || 'No se pudo preparar la promoción.');
        },
      });
  }

  mandarPrueba(): void {
    const idNegocio = this.idNegocio;
    const c = this.campana();
    if (!idNegocio || !c) return;

    // Se exige aquí y no solo en el servidor para no gastar una petición en lo que ya se sabe: sin
    // número no hay prueba, y el número es de quien la va a mirar en su móvil.
    const telefono = this.telefonoPrueba().trim();
    if (telefono.replace(/\D/g, '').length < 7) {
      this.ui.error('Escribe el WhatsApp al que quieres que llegue la prueba.');
      return;
    }
    // WhatsApp no deja que un número se escriba a sí mismo: con el número que ENVÍA, la prueba
    // sale y nunca llega. Se compara por los últimos diez dígitos, con o sin el 57 delante.
    const diez = (t: string | null | undefined) => String(t ?? '').replace(/\D/g, '').slice(-10);
    const numeroQueEnvia = this.gate()?.numero.telefono;
    if (numeroQueEnvia && diez(telefono) === diez(numeroQueEnvia)) {
      this.ui.error(
        'Ese es el número desde el que sale la promoción, y WhatsApp no se escribe a sí mismo. '
          + 'Usa otro WhatsApp, por ejemplo tu número personal.',
        'Usa otro número',
      );
      return;
    }

    this.probando.set(true);
    this.promociones.prueba(idNegocio, c.id_campana, telefono).subscribe({
      next: ({ telefono }) => {
        this.probando.set(false);
        this.ui.success(
          `Mandamos la promoción al ${telefono}. Míralo en tu WhatsApp antes de enviársela a los clientes.`,
          'Prueba enviada',
        );
        // La compuerta cambia en cuanto el acuse de Meta llega: se marca ya como mandada y se
        // sigue preguntando hasta que llegue.
        this.gate.update((g) => (g ? { ...g, prueba: { hecha: true, entregada: false } } : g));
        this.vigilarPrueba();
      },
      error: (e) => {
        this.probando.set(false);
        this.ui.error(e?.error?.message || 'No se pudo mandar la prueba.');
      },
    });
  }

  /**
   * El resumen que se confirma antes de enviar: a cuántos, cuánto cobra Meta y en cuántos días
   * sale. Es lo último que se lee antes de gastar plata, así que va en una frase cada cosa.
   */
  private resumenDeEnvio(c: Campana): string {
    const numero = new Intl.NumberFormat('es-CO');
    const n = c.destinatarios || this.totalSeleccionado();
    const partes = [
      `Vas a enviar esta promoción a ${numero.format(n)} ${n === 1 ? 'cliente' : 'clientes'}.`,
    ];

    const meta = this.simulacion()?.meta;
    if (meta) {
      const usd = meta.costo_usd.toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      partes.push(
        meta.costo_estimado_local !== null
          ? `Meta cobrará cerca de $${numero.format(Math.round(meta.costo_estimado_local))} (US$ ${usd}).`
          : `Meta cobrará US$ ${usd}.`,
      );
    }
    const escalapp = this.simulacion()?.escalapp;
    if (escalapp?.precio_local != null) {
      partes.push(
        `EscalApp: $${numero.format(escalapp.precio_local)}`
          + (escalapp.se_cobra === false ? ' (por ahora no se cobra).' : '.'),
      );
    }

    const linea = this.gate()?.numero;
    if (linea && !linea.ilimitado && linea.tier && n > linea.tier) {
      const dias = Math.ceil(n / linea.tier);
      partes.push(
        `Saldrá en unos ${dias} días: WhatsApp deja alcanzar ${numero.format(linea.tier)} `
          + 'personas nuevas cada 24 horas.',
      );
    }

    partes.push('Lo que ya salió no se puede deshacer.');
    return partes.join(' ');
  }

  async enviar(programada: string | null = null): Promise<void> {
    const idNegocio = this.idNegocio;
    const c = this.campana();
    if (!idNegocio || !c) return;

    this.confirmando = true;
    const seguir = await this.ui.confirm({
      title: 'Enviar la promoción',
      message: this.resumenDeEnvio(c),
      confirmText: 'Sí, enviar',
      cancelText: 'Todavía no',
      tone: 'warning',
    });
    this.confirmando = false;
    if (!seguir) return;

    this.enviando.set(true);
    this.promociones.enviarCampana(idNegocio, c.id_campana, programada).subscribe({
      next: () => {
        this.enviando.set(false);
        // Enviada, la pantalla queda en blanco para la siguiente: esta ya vive en el historial.
        this.cerrarModal();
        this.campana.set(null);
        this.firmaPreparada = null;
        this.gate.set(null);
        this.oferta.set('');
        this.imagenUrl.set(null);
        this.ui.success(
          programada
            ? 'Queda programada. Se enviará sola a la hora que elegiste.'
            : 'En marcha. Se van mandando poco a poco; puedes seguirlo en el historial.',
          'Promoción enviada',
        );
        this.verHistorial();
      },
      error: (e) => {
        this.enviando.set(false);
        this.ui.error(e?.error?.message || 'No se pudo enviar.');
      },
    });
  }

  cargarHistorial(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.campanas(idNegocio).subscribe({
      next: (lista) => this.historial.set(lista),
      error: () => this.ui.error('No se pudo leer el historial.'),
    });
  }

  verInforme(c: Campana): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.cargandoInforme.set(c.id_campana);
    this.promociones.informe(idNegocio, c.id_campana).subscribe({
      next: (i) => {
        this.cargandoInforme.set(null);
        this.informe.set(i);
      },
      error: () => {
        this.cargandoInforme.set(null);
        this.ui.error('No se pudo leer el informe.');
      },
    });
  }

  cerrarInforme(): void {
    if (this.informe()) this.informe.set(null);
  }

  /** Qué porcentaje de la promoción ya salió, para la barra del informe. */
  avanceDe(i: InformeCampana): number {
    const total = i.envio.destinatarios;
    if (!total) return 0;
    return Math.min(100, Math.round((i.envio.salieron / total) * 100));
  }

  tonoEstado(estado: EstadoCampana): TonoEstado {
    const tonos: Partial<Record<EstadoCampana, TonoEstado>> = {
      ENVIANDO: 'marca',
      PROGRAMADA: 'marca',
      LISTA: 'marca',
      ENVIADA: 'bien',
      PAUSADA: 'alerta',
      PENDIENTE_PLANTILLA: 'alerta',
      FALLIDA: 'mal',
    };
    return tonos[estado] ?? 'neutro';
  }

  pausar(c: Campana): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.pausarCampana(idNegocio, c.id_campana, 'Pausada por el negocio').subscribe({
      next: () => {
        this.ui.success('Pausada. Lo que ya salió no se puede deshacer.');
        this.cargarHistorial();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo pausar.'),
    });
  }

  async cancelar(c: Campana): Promise<void> {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    const seguir = await this.ui.confirm({
      title: 'Cancelar la promoción',
      message:
        `Lo que quede por mandar de «${c.nombre}» ya no saldrá, y no se puede reanudar. `
        + 'Lo que ya se envió no se deshace.',
      confirmText: 'Sí, cancelar',
      cancelText: 'Volver',
      tone: 'warning',
    });
    if (!seguir) return;

    this.promociones.cancelarCampana(idNegocio, c.id_campana).subscribe({
      next: () => {
        this.ui.success('Cancelada. Lo que quedaba por mandar ya no sale.');
        this.cargarHistorial();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo cancelar.'),
    });
  }

  /** Para el historial: en qué estado está, dicho como lo diría una persona. */
  estadoLegible(estado: EstadoCampana): string {
    return {
      BORRADOR: 'Sin terminar',
      PENDIENTE_PLANTILLA: 'Esperando a WhatsApp',
      LISTA: 'Lista para enviar',
      PROGRAMADA: 'Programada',
      ENVIANDO: 'Enviando',
      PAUSADA: 'Pausada',
      ENVIADA: 'Enviada',
      CANCELADA: 'Cancelada',
      FALLIDA: 'Falló',
    }[estado] ?? estado;
  }

  /** El motivo de una omisión, en palabras. */
  motivoOmision(codigo: string): string {
    return {
      se_dio_de_baja: 'Pidió no recibir promociones',
      bloqueo_whatsapp: 'Bloqueó el WhatsApp del negocio',
      campana_cancelada: 'Se canceló la promoción antes de llegarle',
    }[codigo] ?? codigo;
  }

  /** Lo que significa un código de error de Meta, que es lo que dice si hay que hacer algo. */
  errorDeMeta(codigo: string | null): string {
    if (!codigo) return 'No se pudo entregar';
    return {
      '131049': 'WhatsApp limitó la publicidad que recibe esa persona (no es culpa del negocio)',
      '131042': 'La cuenta de WhatsApp del negocio no tiene método de pago',
      '131026': 'Ese número no tiene WhatsApp',
      '132001': 'La plantilla no existe en la cuenta de WhatsApp',
    }[codigo] ?? `Error ${codigo}`;
  }
}
