import {
  Component, inject, signal, computed, PLATFORM_ID, viewChild, ElementRef,
  ChangeDetectionStrategy, OnInit, OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

import { RealtimeService } from '../../../core/services/realtime.service';
import { SonidoAlertaService } from '../../../core/services/sonido-alerta.service';
import { VistaTarjetasService } from '../../../core/services/vista-tarjetas.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { aplicarLista } from '../../../core/utils/refresco-vivo';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

// ============================================================
// Interfaces
// ============================================================

export type EstadoCocina = 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';

interface Exclusion {
  ingrediente?: { id_ingrediente: number; nombre: string } | null;
}

interface DetalleItem {
  id_detalle: number;
  /** Es una adición (topping, extra…) de otra línea: la cocina la ve dentro de su plato. */
  id_detalle_padre?: number | null;
  cantidad: number;
  nota: string | null;
  estado: string;
  fecha_creacion: string;
  producto: { id_producto: number; nombre: string; icono: string };
  exclusiones: Exclusion[];
}

interface OrdenCocina {
  id_orden: number;
  numero_orden: string;
  mesaRef: { id_mesa: number; nombre: string; numero: number } | null;
  mesa: string | null;
  fecha_creacion: string;
  nota: string | null;
  /** Pedido por WhatsApp para comer en el local: el cliente viene en camino (mesa asignada). */
  para_servir?: boolean;
  contacto_nombre?: string | null;
  /** MESA | LLEVAR | DOMICILIO */
  tipo_pedido?: string | null;
  estado_cocina: EstadoCocina;
  usuario: { id_usuario: number; primer_nombre: string; primer_apellido: string } | null;
  detalles: DetalleItem[];
}

/** Lo que cambia de una columna a otra del tablero: textos y a dónde avanza la comanda. */
interface ColumnaKds {
  estado: EstadoCocina;
  clase: 'pendiente' | 'preparando' | 'listo';
  titulo: string;
  vacioTitulo: string;
  vacioTexto: string;
  /**
   * Lo que dice la cabecera con comandas («12 min la más antigua»). En «Listo» va sin
   * tiempo: solo se sabe cuándo entró la comanda, no cuándo quedó lista.
   */
  detalle: string;
  siguiente: EstadoCocina;
  accionTexto: string;
  /** Para deshacer un toque por error. La primera columna no tiene a dónde volver. */
  atras: EstadoCocina | null;
  atrasTexto: string;
}

const COLUMNAS: readonly ColumnaKds[] = [
  {
    estado: 'PENDIENTE', clase: 'pendiente', titulo: 'Pendiente',
    vacioTitulo: 'Sin comandas nuevas',
    vacioTexto: 'Aparecen aquí apenas se envían a cocina.',
    detalle: 'la más antigua',
    siguiente: 'EN_PREPARACION', accionTexto: 'Iniciar preparación',
    atras: null, atrasTexto: '',
  },
  {
    estado: 'EN_PREPARACION', clase: 'preparando', titulo: 'En preparación',
    vacioTitulo: 'Nada en el fogón',
    vacioTexto: 'Inicia una comanda pendiente para verla aquí.',
    detalle: 'la más antigua',
    siguiente: 'LISTO', accionTexto: 'Marcar como listo',
    atras: 'PENDIENTE', atrasTexto: 'Devolver a Pendiente',
  },
  {
    estado: 'LISTO', clase: 'listo', titulo: 'Listo',
    vacioTitulo: 'Nada por recoger',
    vacioTexto: 'Lo que marques como listo espera aquí.',
    detalle: 'esperan a que las recojan',
    siguiente: 'ENTREGADO', accionTexto: 'Entregar',
    atras: 'EN_PREPARACION', atrasTexto: 'Devolver a En preparación',
  },
];

/**
 * CocinaComponent — Kitchen Display System (KDS).
 * 
 * Kanban de 3 columnas: PENDIENTE → EN_PREPARACION → LISTO.
 * Se refresca solo cuando el servidor avisa (SSE); el reloj de cada tarjeta avanza cada 30 s.
 * Suena al entrar una comanda nueva y, como confirmación, al marcar una como lista.
 */
@Component({
  selector: 'app-cocina',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './cocina.html',
  styleUrl: './cocina.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CocinaComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly realtime = inject(RealtimeService);
  private readonly sonido = inject(SonidoAlertaService);
  private readonly vista = inject(VistaTarjetasService);
  private readonly ui = inject(UiFeedbackService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly ordenes    = signal<OrdenCocina[]>([]);
  /** Solo la primera carga (nace en true: el primer dibujo no puede decir «sin comandas»). */
  readonly cargando   = signal(true);
  /** Preferencia de este equipo (la cocina silencia una tablet y no otra): vive en el navegador. */
  readonly audioActivo = signal(this.leerPreferenciaSonido());
  /** El último intento de traer las comandas falló: lo que se ve puede estar viejo. */
  readonly sinConexion = signal(false);

  // ── Tamaño de las tarjetas (el mismo botón y la misma preferencia por equipo que Mesas y
  // Despacho). Grande para leer de lejos; pequeño para ver muchas comandas a la vez. ──
  readonly densidad = this.vista.densidad('cocina');
  readonly densidadIcono = computed(() => {
    const d = this.densidad();
    if (d === 'normal') return 'layout-grid';
    return d === 'compacta' ? 'grid-3x3' : 'list';
  });
  readonly densidadTitulo = computed(() => {
    const d = this.densidad();
    if (d === 'normal') return 'Tarjetas grandes — clic para achicar';
    if (d === 'compacta') return 'Tarjetas medianas — clic para achicar más';
    return 'Tarjetas pequeñas — clic para volver al tamaño grande';
  });

  // ── Respuesta visual al mover una comanda ──
  /**
   * Comandas movidas en pantalla cuyo cambio aún no confirma el servidor, con el estado al que
   * van. Mientras están aquí su tarjeta dice «Guardando…», no acepta otro toque y una recarga que
   * llegue en medio no las devuelve a donde estaban.
   */
  readonly enCurso = signal<ReadonlyMap<number, EstadoCocina>>(new Map());
  /** Recién llegadas a su columna (o recién entradas a cocina): se iluminan un momento. */
  readonly recien = signal<ReadonlySet<number>>(new Set());
  /** Comandas que no se pudieron mover, con el aviso que se muestra en la propia tarjeta. */
  readonly fallo = signal<ReadonlyMap<number, string>>(new Map());

  /**
   * Cuándo y de qué columna salió la última tarjeta. Al irse, la de abajo sube justo bajo el
   * dedo: un segundo toque rápido avanzaría OTRA comanda. Esa columna ignora toques ~400 ms.
   */
  private ultimoMovimiento = { estado: null as EstadoCocina | null, en: 0 };
  /** Ids ya vistos, para sonar solo con las comandas que de verdad son nuevas. Null = primera carga. */
  private vistas: Set<number> | null = null;

  /** Tick signal — actualizado cada 30 s para refrescar timers reactivamente. */
  readonly now = signal(Date.now());

  // ── Columnas del kanban (computed + ordenadas por tiempo) ──────────────────
  readonly ordenesPendientes = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'PENDIENTE')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  readonly ordenesPreparando = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'EN_PREPARACION')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  readonly ordenesListas = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'LISTO')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  readonly columnas = COLUMNAS;

  // ── Pestañas del celular: allí cabe una sola columna y hay que saber en cuál se está ──
  private readonly tablero = viewChild<ElementRef<HTMLElement>>('tablero');
  readonly columnaVisible = signal(0);

  irAColumna(i: number): void {
    const col = this.tablero()?.nativeElement.children.item(i) as HTMLElement | null;
    col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  }

  alDesplazarTablero(): void {
    const el = this.tablero()?.nativeElement;
    const primera = el?.children.item(0) as HTMLElement | null;
    if (!el || !primera) return;
    const paso = primera.offsetWidth + parseFloat(getComputedStyle(el).columnGap || '0');
    this.columnaVisible.set(Math.min(2, Math.max(0, Math.round(el.scrollLeft / paso))));
  }

  ordenesDe(estado: EstadoCocina): OrdenCocina[] {
    if (estado === 'PENDIENTE') return this.ordenesPendientes();
    if (estado === 'EN_PREPARACION') return this.ordenesPreparando();
    return this.ordenesListas();
  }

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private dejarDeEscuchar: (() => void) | null = null;

  private get negocioId(): number | null {
    return this.auth.negocio()?.id_negocio ?? null;
  }

  ngOnInit(): void {
    this.loadOrdenes();

    // Antes esto recargaba cada 30 segundos. Ahora el servidor avisa en cuanto entra una
    // comanda o alguien la mueve, así que la espera es de un segundo en vez de medio minuto —
    // y mientras no pasa nada, no se consulta. Si el canal se cae, el propio servicio vuelve
    // solo al refresco por reloj: esta pantalla no se entera.
    this.dejarDeEscuchar = this.realtime.alCambiar(['cocina'], () => this.loadOrdenes());

    // El reloj de «hace X minutos» sigue siendo suyo: no depende de que cambie nada.
    this.tickInterval = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.dejarDeEscuchar?.();
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  /**
   * Trae las comandas.
   *
   * La cocina mira esta pantalla de lejos y con las manos ocupadas: que el tablero desaparezca
   * medio segundo cada vez que llega un aviso es justo lo que no puede pasar. Así que
   * «Cargando» solo se ve la primera vez, y las comandas se fusionan con las que ya están —la
   * que no cambió no se vuelve a dibujar.
   */
  loadOrdenes(): void {
    const id = this.negocioId;
    if (!id) return;

    if (this.ordenes().length === 0) this.cargando.set(true);

    this.http.get<{ success: boolean; data: OrdenCocina[] }>(
      `${environment.apiUrl}/cocina?id_negocio=${id}`
    ).subscribe({
      next: res => {
        // Lo que se movió en pantalla y el servidor aún no confirma manda sobre lo que llega.
        const enCurso = this.enCurso();
        const datos = (res?.data ?? [])
          .filter((o) => enCurso.get(o.id_orden) !== 'ENTREGADO')
          .map((o) => {
            const destino = enCurso.get(o.id_orden);
            return destino ? { ...o, estado_cocina: destino } : o;
          });
        this.avisarNuevas(datos);
        aplicarLista(this.ordenes, datos, (o) => o.id_orden);
        this.cargando.set(false);
        this.sinConexion.set(false);
      },
      // Se conserva lo que haya: un corte de red no puede vaciar el tablero de la cocina. Pero
      // se dice, porque un tablero congelado que parece al día es peor que uno vacío.
      error: () => {
        this.cargando.set(false);
        this.sinConexion.set(true);
      },
    });
  }

  // ── Transiciones de estado KDS ──────────────────────────────────────────────

  rotarDensidad(): void {
    this.vista.rotarDensidad('cocina');
  }

  /**
   * Mueve la comanda de etapa.
   *
   * La tarjeta salta a su nueva columna en el mismo instante del toque —quien no ve respuesta
   * vuelve a tocar— y allí dice «Guardando…» hasta que el servidor confirma. Si falla, vuelve a
   * donde estaba y lo dice en la propia tarjeta. La campana de «listo» suena con la
   * confirmación, no antes: si sonara y el cambio fallara, mentiría.
   */
  cambiarEstado(orden: OrdenCocina, nuevoEstado: EstadoCocina): void {
    const id = orden.id_orden;
    const previo = orden.estado_cocina;
    if (this.enCurso().has(id)) return;
    const { estado, en } = this.ultimoMovimiento;
    if (estado === previo && Date.now() - en < 400) return;
    this.ultimoMovimiento = { estado: previo, en: Date.now() };

    this.quitarFallo(id);
    this.enCurso.update((m) => new Map(m).set(id, nuevoEstado));
    this.ponerEstado(orden, nuevoEstado);
    if (nuevoEstado !== 'ENTREGADO') this.iluminar(id);

    this.http.patch(
      `${environment.apiUrl}/pedidos/${id}/estado-cocina`,
      { estado: nuevoEstado }
    ).subscribe({
      next: () => {
        this.quitarEnCurso(id);
        if (nuevoEstado === 'LISTO') this.playSound();
        if (nuevoEstado === 'ENTREGADO') this.avisarEntregada(orden);
        this.loadOrdenes();
      },
      error: () => {
        this.quitarEnCurso(id);
        this.ponerEstado(orden, previo);
        this.fallo.update((m) =>
          new Map(m).set(id, 'No se pudo mover. Revisa la conexión e inténtalo otra vez.'),
        );
        setTimeout(() => this.quitarFallo(id), 6000);
      },
    });
  }

  /** Pone la comanda en un estado en pantalla (la añade si había salido, la quita si se entrega). */
  private ponerEstado(orden: OrdenCocina, estado: EstadoCocina): void {
    this.ordenes.update((l) => {
      const sin = l.filter((o) => o.id_orden !== orden.id_orden);
      if (estado === 'ENTREGADO') return sin;
      const actual = l.find((o) => o.id_orden === orden.id_orden) ?? orden;
      return [...sin, { ...actual, estado_cocina: estado }];
    });
  }

  /** «Entregar» saca la comanda del tablero: unos segundos para deshacer un toque por error. */
  private avisarEntregada(orden: OrdenCocina): void {
    this.ui.toast({
      tone: 'success',
      title: 'Comanda entregada',
      message: `${this.numeroCorto(orden)} salió del tablero.`,
      durationMs: 7000,
      accion: {
        texto: 'Deshacer',
        ejecutar: () => this.cambiarEstado({ ...orden, estado_cocina: 'ENTREGADO' }, 'LISTO'),
      },
    });
  }

  /** Suena e ilumina las comandas que entraron a «Pendiente» desde la última carga. */
  private avisarNuevas(datos: OrdenCocina[]): void {
    const primera = this.vistas === null;
    const vistas = this.vistas ?? new Set<number>();
    const nuevas = datos.filter((o) => o.estado_cocina === 'PENDIENTE' && !vistas.has(o.id_orden));
    this.vistas = new Set(datos.map((o) => o.id_orden));
    if (primera || nuevas.length === 0) return;
    for (const o of nuevas) this.iluminar(o.id_orden);
    if (this.audioActivo()) this.sonido.sonarNuevoPedido();
  }

  private iluminar(id: number): void {
    this.recien.update((s) => new Set(s).add(id));
    setTimeout(() => this.recien.update((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  private quitarEnCurso(id: number): void {
    this.enCurso.update((m) => { const n = new Map(m); n.delete(id); return n; });
  }

  private quitarFallo(id: number): void {
    this.fallo.update((m) => { const n = new Map(m); n.delete(id); return n; });
  }

  // ── Detalles de la comanda ──────────────────────────────────────────────────

  /**
   * Un plato que se añadió a la comanda después de que entró (el cliente pidió algo más). Si no
   * se distingue, la cocina no sabe qué de la tarjeta le falta preparar.
   */
  esAgregadoDespues(detalle: DetalleItem, orden: OrdenCocina): boolean {
    return +new Date(detalle.fecha_creacion) - +new Date(orden.fecha_creacion) > 2 * 60_000;
  }

  /** Una nota que habla de alergias o intolerancias: va en rojo, no en el amarillo de siempre. */
  esAlerta(texto: string | null | undefined): boolean {
    return !!texto && /al[eé]rg|cel[ií]ac|gluten|lactosa|man[ií]\b|marisco|intoleran/i.test(texto);
  }

  // ── Timer y prioridad ───────────────────────────────────────────────────────

  /**
   * Calcula minutos transcurridos. Lee `this.now()` para que Angular 17+
   * re-evalúe el template cuando el tick cambia (OnPush reactivo).
   */
  getMinutos(fecha: string): number {
    this.now(); // dependency tracking
    return Math.floor((Date.now() - new Date(fecha).getTime()) / 60_000);
  }

  tiempoLabel(fecha: string): string {
    const m = this.getMinutos(fecha);
    if (m < 1) return '< 1 min';
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m} min`;
  }

  /**
   * Tres niveles y no cuatro: una comanda a tiempo no necesita color (gris), la que se va
   * demorando avisa en ámbar, y solo la atrasada pinta la tarjeta de rojo. Con verde, dorado,
   * naranja y rojo a la vez el tablero era un semáforo y nada destacaba.
   */
  timerClass(fecha: string): 'normal' | 'warning' | 'critical' {
    const m = this.getMinutos(fecha);
    if (m < 8)  return 'normal';
    if (m < 15) return 'warning';
    return 'critical';
  }

  // ── Helpers de display ──────────────────────────────────────────────────────

  /** «ORD-0056» → «#0056»: en la cocina se grita el número, no el prefijo. */
  numeroCorto(orden: OrdenCocina): string {
    const num = (orden.numero_orden ?? '').replace(/^ORD-/i, '');
    return `#${num || orden.id_orden}`;
  }

  /** De dónde viene la comanda: a qué mesa va, o si sale del local. */
  origenDe(orden: OrdenCocina): { texto: string; icono: string; clase: string } {
    const tipo = (orden.tipo_pedido ?? 'MESA').toUpperCase();
    if (tipo === 'DOMICILIO') return { texto: 'Domicilio', icono: 'bike', clase: 'domicilio' };
    if (tipo === 'LLEVAR') return { texto: 'Para llevar', icono: 'shopping-bag', clase: 'llevar' };
    const nombre = orden.mesaRef?.nombre ?? orden.mesa;
    const texto = nombre
      ? (/^mesa\b/i.test(nombre) ? nombre : `Mesa ${nombre}`)
      : 'Mesa';
    return { texto, icono: 'mesa', clase: 'mesa' };
  }

  /** Solo el primer nombre, en tipo oración («LAURA» → «Laura»): es un dato de apoyo, no un título. */
  meseroCorto(orden: OrdenCocina): string {
    const nombre = (orden.usuario?.primer_nombre ?? '').trim().toLocaleLowerCase('es');
    return nombre ? nombre.charAt(0).toLocaleUpperCase('es') + nombre.slice(1) : '';
  }

  /**
   * Los platos de la orden con sus adiciones dentro: una adición no es un plato aparte que la
   * cocina prepare y marque, es algo que lleva el plato. Si su plato no viniera (no debería),
   * se muestra como una línea más para no perderla.
   */
  platosDe(orden: OrdenCocina): Array<{ detalle: DetalleItem; adiciones: DetalleItem[] }> {
    const ids = new Set(orden.detalles.map((d) => d.id_detalle));
    const hijos = new Map<number, DetalleItem[]>();
    for (const d of orden.detalles) {
      if (d.id_detalle_padre != null && ids.has(d.id_detalle_padre)) {
        hijos.set(d.id_detalle_padre, [...(hijos.get(d.id_detalle_padre) ?? []), d]);
      }
    }
    return orden.detalles
      .filter((d) => !(d.id_detalle_padre != null && ids.has(d.id_detalle_padre)))
      .map((d) => ({ detalle: d, adiciones: hijos.get(d.id_detalle) ?? [] }));
  }

  getExclusiones(detalle: DetalleItem): string[] {
    return (detalle.exclusiones ?? [])
      .map(e => e.ingrediente?.nombre)
      .filter((nombre): nombre is string => Boolean(nombre));
  }

  // ── Audio ───────────────────────────────────────────────────────────────────

  toggleAudio(): void {
    this.audioActivo.update(v => !v);
    try {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('cocina_sonido', this.audioActivo() ? '1' : '0');
      }
    } catch { /* sin almacenamiento: la preferencia dura lo que la pestaña */ }
    // Al encenderlo suena una vez: quien cocina oye cómo es, y el navegador ya queda autorizado.
    this.playSound();
  }

  private leerPreferenciaSonido(): boolean {
    try {
      if (isPlatformBrowser(this.platformId)) return localStorage.getItem('cocina_sonido') !== '0';
    } catch { /* ídem */ }
    return true;
  }

  private playSound(): void {
    if (this.audioActivo()) this.sonido.sonarPedidoListo();
  }

}


