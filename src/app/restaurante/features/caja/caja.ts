import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
  PLATFORM_ID,
} from '@angular/core';
import {
  CurrencyPipe, DatePipe, DecimalPipe, NgTemplateOutlet, isPlatformBrowser,
} from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { Observable } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import {
  ApiResponse, Caja, CajaHistorial, CajaService, DomiciliarioResumen, DomiciliariosResumen,
  MovimientoCaja, OrdenItems,
} from '../../../core/services/caja.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { RealtimeService } from '../../../core/services/realtime.service';

type ModalActivo = null | 'apertura' | 'cierre' | 'movimiento' | 'domiciliarios' | 'historial';

/** Un filtro de la barra de formas de pago, con lo que trae el turno por esa vía. */
interface FiltroMetodo {
  /** Id del método, o `sin` para las filas que no tienen forma de pago. */
  clave: string;
  nombre: string;
  movimientos: number;
  activo: boolean;
}

/** Clave del filtro para las filas sin forma de pago atribuida. */
const SIN_METODO = 'sin';

@Component({
  selector: 'app-caja',
  standalone: true,
  imports: [
    FormsModule, LucideAngularModule, NgTemplateOutlet, CurrencyPipe, DatePipe, DecimalPipe,
  ],
  templateUrl: './caja.html',
  styleUrl: './caja.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CajaComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly cajaSvc = inject(CajaService);
  private readonly realtime = inject(RealtimeService);
  private dejarDeEscuchar: (() => void) | null = null;
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly ui = inject(UiFeedbackService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly caja = this.cajaSvc.cajaAbierta;
  readonly cargando = this.cajaSvc.cargando;
  readonly movimientos = signal<MovimientoCaja[]>([]);
  readonly cargandoMovimientos = signal(false);
  readonly domiciliariosResumen = signal<DomiciliarioResumen[]>([]);
  readonly resumenDomiciliarios = signal<DomiciliariosResumen['resumen'] | null>(null);
  readonly cargandoDomiciliarios = signal(false);
  readonly errorDomiciliarios = signal('');
  readonly transferiendoDomiciliarioId = signal<number | null>(null);

  readonly modal = signal<ModalActivo>(null);
  readonly enviando = signal(false);

  // ── Acordeón de productos por fila ──
  // Qué filas están abiertas se guarda por `id_movimiento` (es la fila), y lo que
  // se trae del servidor se cachea por `id_orden` (es el pedido): el cobro y el
  // egreso del domicilio del mismo pedido comparten productos y una sola consulta.
  readonly filasAbiertas = signal<ReadonlySet<number>>(new Set());
  readonly itemsPorOrden = signal<ReadonlyMap<number, OrdenItems>>(new Map());
  readonly ordenesCargando = signal<ReadonlySet<number>>(new Set());
  readonly erroresPorOrden = signal<ReadonlyMap<number, string>>(new Map());

  // ── Filtro por forma de pago ──
  // Se guardan las DESMARCADAS, no las marcadas: así todo arranca visible y una
  // forma de pago que aparece a mitad del turno (el primer cobro por transferencia
  // del día) entra ya marcada, en vez de quedarse escondida sin que nadie entienda
  // por qué le falta un pedido al listado.
  private readonly metodosOcultos = signal<ReadonlySet<string>>(new Set<string>());

  /**
   * Los filtros que se pintan, sacados de los movimientos del turno y no de las
   * formas de pago configuradas: una que el negocio tiene pero no usó hoy sería un
   * botón que no hace nada, y una que ya desactivó pero cobró esta mañana tiene que
   * poder filtrarse igual.
   */
  readonly filtrosMetodo = computed<FiltroMetodo[]>(() => {
    const ocultos = this.metodosOcultos();
    const mapa = new Map<string, FiltroMetodo>();

    for (const m of this.movimientos()) {
      for (const clave of this.clavesMetodo(m)) {
        const existente = mapa.get(clave);
        if (existente) {
          existente.movimientos += 1;
          continue;
        }
        mapa.set(clave, {
          clave,
          nombre: this.nombreClave(clave, m),
          movimientos: 1,
          activo: !ocultos.has(clave),
        });
      }
    }

    // «Sin forma de pago» al final: es el cajón de sastre, no una forma de pago más.
    return [...mapa.values()].sort((a, b) => {
      if (a.clave === SIN_METODO) return 1;
      if (b.clave === SIN_METODO) return -1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  });

  /**
   * Los movimientos que se listan.
   *
   * Un pedido cobrado con dos formas de pago pertenece a las dos, así que basta que
   * UNA siga marcada para que siga a la vista: esconderlo por desmarcar la otra haría
   * desaparecer parte del cobro sin avisar.
   */
  readonly movimientosFiltrados = computed(() => {
    const ocultos = this.metodosOcultos();
    if (ocultos.size === 0) return this.movimientos();
    return this.movimientos().filter(
      (m) => this.clavesMetodo(m).some((clave) => !ocultos.has(clave)),
    );
  });

  readonly hayFiltroMetodo = computed(() => this.metodosOcultos().size > 0);

  /** Las formas de pago de un movimiento, como claves de filtro. */
  private clavesMetodo(m: MovimientoCaja): string[] {
    const formas = m.formas_pago || [];
    if (formas.length === 0) return [SIN_METODO];
    return formas.map((f) => String(f.id_metodo_pago));
  }

  private nombreClave(clave: string, m: MovimientoCaja): string {
    if (clave === SIN_METODO) return 'Sin forma de pago';
    return (m.formas_pago || []).find((f) => String(f.id_metodo_pago) === clave)?.nombre
      ?? 'Forma de pago';
  }

  /** Marca o desmarca una forma de pago del filtro. */
  alternarMetodo(clave: string): void {
    const siguiente = new Set(this.metodosOcultos());
    if (siguiente.has(clave)) siguiente.delete(clave);
    else siguiente.add(clave);
    this.metodosOcultos.set(siguiente);
  }

  limpiarFiltroMetodo(): void {
    this.metodosOcultos.set(new Set<string>());
  }

  /** Etiqueta de la columna: «Efectivo», «Efectivo + Transferencia» o un guion. */
  formasPagoTexto(m: MovimientoCaja): string {
    const formas = m.formas_pago || [];
    if (formas.length === 0) return '—';
    return formas.map((f) => f.nombre).join(' + ');
  }

  // ── Historial de turnos cerrados ──
  // El modal tiene dos vistas: la lista de turnos y, al elegir uno, su detalle.
  // `cajaHistSel` es lo que decide cuál se ve.
  private readonly HIST_PAGINA = 20;
  readonly historial = signal<CajaHistorial[]>([]);
  readonly historialTotal = signal(0);
  readonly cargandoHistorial = signal(false);
  readonly errorHistorial = signal('');
  readonly histDesde = signal('');
  readonly histHasta = signal('');

  readonly cajaHistSel = signal<Caja | null>(null);
  readonly movimientosHist = signal<MovimientoCaja[]>([]);
  readonly exportandoCaja = signal(false);
  readonly cargandoDetalleHist = signal(false);

  readonly hayMasHistorial = computed(() => this.historial().length < this.historialTotal());

  /**
   * Ancho de la fila desplegada, que tiene que cubrir la tabla entera: la columna
   * del chevron más las seis fijas (fecha, tipo, tipo de pedido, concepto, forma
   * de pago y usuario), y las dos que dependen de permisos.
   */
  readonly colspanMovimientos = computed(
    () => 7 + (this.puedeVerIngresos() ? 1 : 0) + (this.puedeEliminarPedido() ? 1 : 0),
  );
  /**
   * La del historial es la misma tabla sin la columna de eliminar y sin la de forma
   * de pago: los filtros viven en el turno en curso, que es donde el cajero cuadra.
   */
  readonly colspanMovimientosHist = computed(() => 6 + (this.puedeVerIngresos() ? 1 : 0));

  // ── Apertura ──
  // Arranca vacío (no en 0) para que el cajero escriba directo sin borrar nada.
  // Si lo deja así, al guardar se envía 0.
  readonly montoApertura = signal<number | null>(null);
  readonly obsApertura = signal('');

  // ── Cierre ──
  readonly montoReportado = signal<number | null>(null);
  readonly obsCierre = signal('');

  // ── Movimiento manual ──
  readonly movTipo = signal<'INGRESO' | 'EGRESO'>('INGRESO');
  readonly movMonto = signal<number | null>(null);
  readonly movConcepto = signal('');
  /**
   * Con qué entra o sale la plata. Sin esto, un retiro en efectivo y una
   * transferencia salían iguales del arqueo y el desglose por forma de pago no
   * cuadraba con lo que había en el cajón.
   */
  readonly movMetodoPago = signal<number | null>(null);

  /**
   * Formas de pago del negocio, para el movimiento manual.
   *
   * «Cuenta / Tiquetera» queda fuera: ese dinero no está en el cajón, y un
   * movimiento manual ahí descuadraría la cuenta del cliente sin tocar su saldo.
   * El backend también la rechaza; esto solo evita ofrecerla.
   */
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string }>>([]);

  readonly negocio = computed(() => this.auth.negocio());
  readonly idNegocio = computed(() => this.negocio()?.id_negocio ?? null);

  readonly puedeAbrir = computed(() => this.auth.canAccessSubnivel('caja_abrir'));
  readonly puedeCerrar = computed(() => this.auth.canAccessSubnivel('caja_cerrar'));
  readonly puedeMovimiento = computed(() => this.auth.canAccessSubnivel('caja_movimiento'));
  /** El resumen de domiciliarios sobra en un negocio que no hace domicilios. */
  readonly puedeVerDomiciliarios = computed(() => this.auth.canAccessSubnivel('pedidos_domicilio'));
  /**
   * Eliminar un pedido ya cobrado. Nace denegado para todos los roles de todos
   * los negocios; se habilita a mano en Usuarios → Roles y permisos.
   */
  readonly puedeEliminarPedido = computed(() => this.auth.canAccessSubnivel('caja_eliminar_pedido'));
  readonly anulandoOrdenId = signal<number | null>(null);

  /**
   * Ver el dinero del turno: ingresos, egresos, esperado, desglose por forma de
   * pago y el monto de cada movimiento.
   *
   * Sin el permiso, Caja se abre igual y los movimientos se siguen listando —fecha,
   * tipo, concepto, usuario— pero sin cifras. Sirve para que un cajero opere y
   * cuente a ciegas sin ver el acumulado del turno. El backend además vacía los
   * importes en la respuesta, así que esto no es solo cosmético.
   */
  readonly puedeVerIngresos = computed(() => this.auth.canAccessSubnivel('caja_ver_ingresos'));

  /**
   * Con los importes ocultos no hay contra qué comparar: el cierre se hace a ciegas
   * y es el backend quien calcula la diferencia contra el esperado real.
   */
  readonly puedeVerDiferenciaCierre = computed(() => this.puedeVerIngresos());

  readonly diferenciaCierre = computed(() => {
    if (!this.puedeVerIngresos()) return null;
    const reportado = this.montoReportado();
    const esperado = this.caja()?.monto_esperado ?? 0;
    if (reportado === null || Number.isNaN(Number(reportado))) return null;
    return Number(reportado) - Number(esperado);
  });

  ngOnInit(): void {
    this.refrescarCaja();
    this.cargarMetodosPago();

    // El turno lo mueven varias personas a la vez: un mesero cobra en el POS y ese ingreso
    // tiene que aparecer aquí sin que el cajero recargue. También `pedidos`, porque el
    // listado del turno se arma con los pedidos cobrados.
    this.dejarDeEscuchar = this.realtime.alCambiar(
      ['caja', 'pedidos'],
      () => this.refrescarCaja(),
    );
  }

  private cargarMetodosPago(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.catalogo.metodosPago(id).subscribe({
      next: (data) => {
        this.metodosPago.set((data ?? []).filter((m) => !m.es_cuenta));
        // Si la lista llegó con el modal ya abierto, se preselecciona ahora.
        if (this.modal() === 'movimiento' && this.movMetodoPago() == null) {
          this.movMetodoPago.set(this.metodosPago()[0]?.id_metodo_pago ?? null);
        }
      },
      error: () => this.metodosPago.set([]),
    });
  }

  refrescarCaja(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.cajaSvc.refrescar(id).subscribe({
      next: () => {
        const caja = this.caja();
        if (caja) this.cargarMovimientos(caja.id_caja);
        else this.movimientos.set([]);
      },
    });
  }

  private cargarMovimientos(idCaja: number): void {
    this.cargandoMovimientos.set(true);
    this.cajaSvc.getMovimientos(idCaja).subscribe({
      next: (res) => {
        this.movimientos.set(res?.data ?? []);
        this.cargandoMovimientos.set(false);
      },
      error: () => {
        this.movimientos.set([]);
        this.cargandoMovimientos.set(false);
      },
    });
  }

  // ===================== Acordeón de productos =====================

  /** Solo las filas que cuelgan de un pedido tienen productos que desplegar. */
  tieneDetalle(m: MovimientoCaja): boolean {
    return !!m.orden?.id_orden;
  }

  estaAbierta(m: MovimientoCaja): boolean {
    return this.filasAbiertas().has(m.id_movimiento);
  }

  itemsDe(m: MovimientoCaja): OrdenItems | null {
    const id = m.orden?.id_orden;
    return id ? this.itemsPorOrden().get(id) ?? null : null;
  }

  cargandoItemsDe(m: MovimientoCaja): boolean {
    const id = m.orden?.id_orden;
    return !!id && this.ordenesCargando().has(id);
  }

  errorItemsDe(m: MovimientoCaja): string {
    const id = m.orden?.id_orden;
    return id ? this.erroresPorOrden().get(id) ?? '' : '';
  }

  /**
   * Abre o cierra la fila. Los productos se piden la primera vez que se abre y se
   * quedan cacheados: volver a plegarla y desplegarla no repite la consulta.
   */
  alternarDetalle(m: MovimientoCaja): void {
    if (!this.tieneDetalle(m)) return;

    const abiertas = new Set(this.filasAbiertas());
    if (abiertas.delete(m.id_movimiento)) {
      this.filasAbiertas.set(abiertas);
      return;
    }
    abiertas.add(m.id_movimiento);
    this.filasAbiertas.set(abiertas);

    const idOrden = m.orden!.id_orden;
    if (this.itemsPorOrden().has(idOrden)) return;
    this.cargarItems(idOrden);
  }

  private cargarItems(idOrden: number): void {
    const idNegocio = this.idNegocio();
    if (!idNegocio || this.ordenesCargando().has(idOrden)) return;

    this.ordenesCargando.set(new Set(this.ordenesCargando()).add(idOrden));
    this.borrarErrorOrden(idOrden);

    this.cajaSvc.getItemsOrden(idOrden, idNegocio).subscribe({
      next: (res) => {
        if (res?.data) {
          this.itemsPorOrden.set(new Map(this.itemsPorOrden()).set(idOrden, res.data));
        }
        this.terminarCarga(idOrden);
      },
      error: (err: HttpErrorResponse) => {
        this.erroresPorOrden.set(
          new Map(this.erroresPorOrden()).set(
            idOrden,
            err?.error?.message || 'No se pudieron cargar los productos del pedido.',
          ),
        );
        this.terminarCarga(idOrden);
      },
    });
  }

  /** Reintento manual: se borra lo que falló y se vuelve a pedir. */
  reintentarItems(m: MovimientoCaja): void {
    const idOrden = m.orden?.id_orden;
    if (idOrden) this.cargarItems(idOrden);
  }

  private terminarCarga(idOrden: number): void {
    const cargando = new Set(this.ordenesCargando());
    cargando.delete(idOrden);
    this.ordenesCargando.set(cargando);
  }

  private borrarErrorOrden(idOrden: number): void {
    if (!this.erroresPorOrden().has(idOrden)) return;
    const errores = new Map(this.erroresPorOrden());
    errores.delete(idOrden);
    this.erroresPorOrden.set(errores);
  }

  /** Al cambiar de listado, ninguna fila del anterior sigue abierta. */
  private cerrarTodasLasFilas(): void {
    this.filasAbiertas.set(new Set());
  }

  // ── Modales ──
  abrirModal(modal: Exclude<ModalActivo, null>): void {
    if (modal === 'apertura') {
      this.montoApertura.set(null);
      this.obsApertura.set('');
    }
    if (modal === 'cierre') {
      this.montoReportado.set(null);
      this.obsCierre.set('');
    }
    if (modal === 'movimiento') {
      this.movTipo.set('INGRESO');
      this.movMonto.set(null);
      this.movConcepto.set('');
      // Preseleccionada la primera (Efectivo, en la práctica): es el caso de casi
      // todos los movimientos manuales y ahorra un clic en el que más se repite.
      this.movMetodoPago.set(this.metodosPago()[0]?.id_metodo_pago ?? null);
      if (this.metodosPago().length === 0) this.cargarMetodosPago();
    }
    if (modal === 'domiciliarios') {
      this.errorDomiciliarios.set('');
      this.cargarResumenDomiciliarios();
    }
    if (modal === 'historial') {
      this.cajaHistSel.set(null);
      this.movimientosHist.set([]);
      this.errorHistorial.set('');
      this.cerrarTodasLasFilas();
      this.cargarHistorial(true);
    }
    this.modal.set(modal);
    this.toggleBodyScroll(true);
  }

  cerrarModal(): void {
    if (this.enviando()) return;
    this.modal.set(null);
    this.toggleBodyScroll(false);
  }

  ngOnDestroy(): void {
    this.toggleBodyScroll(false);
    this.dejarDeEscuchar?.();
  }

  private toggleBodyScroll(lock: boolean): void {
    if (!this.isBrowser) return;
    document.body.style.overflow = lock ? 'hidden' : '';
  }

  // ===================== Historial =====================

  /** `reiniciar` vuelve a la primera página; si no, añade la siguiente. */
  cargarHistorial(reiniciar = false): void {
    const id = this.idNegocio();
    if (!id || this.cargandoHistorial()) return;

    const offset = reiniciar ? 0 : this.historial().length;
    this.cargandoHistorial.set(true);

    this.cajaSvc.getHistorial(id, {
      desde: this.histDesde() || null,
      hasta: this.histHasta() || null,
      limite: this.HIST_PAGINA,
      offset,
    }).subscribe({
      next: (res) => {
        const rows = res?.data?.rows ?? [];
        this.historial.set(reiniciar ? rows : [...this.historial(), ...rows]);
        this.historialTotal.set(res?.data?.total ?? 0);
        this.errorHistorial.set('');
        this.cargandoHistorial.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (reiniciar) {
          this.historial.set([]);
          this.historialTotal.set(0);
        }
        this.errorHistorial.set(
          err?.error?.message || 'No se pudo cargar el historial de cajas.',
        );
        this.cargandoHistorial.set(false);
      },
    });
  }

  /** Al cambiar el rango de fechas se relee desde la primera página. */
  aplicarFiltroHistorial(): void {
    this.cajaHistSel.set(null);
    this.movimientosHist.set([]);
    this.cargarHistorial(true);
  }

  limpiarFiltroHistorial(): void {
    this.histDesde.set('');
    this.histHasta.set('');
    this.aplicarFiltroHistorial();
  }

  /** Abre el detalle de un turno: sus totales y sus movimientos. */
  verDetalleHistorial(item: CajaHistorial): void {
    const id = this.idNegocio();
    if (!id || this.cargandoDetalleHist()) return;

    this.cargandoDetalleHist.set(true);
    this.movimientosHist.set([]);
    this.cerrarTodasLasFilas();

    this.cajaSvc.getDetalleCaja(item.id_caja, id).subscribe({
      next: (res) => {
        this.cajaHistSel.set(res?.data ?? null);
        this.cargandoDetalleHist.set(false);
        if (res?.data) this.cargarMovimientosHistorial(item.id_caja);
      },
      error: (err: HttpErrorResponse) => {
        this.cargandoDetalleHist.set(false);
        this.ui.error(err?.error?.message || 'No se pudo cargar el detalle de la caja.');
      },
    });
  }

  private cargarMovimientosHistorial(idCaja: number): void {
    this.cajaSvc.getMovimientos(idCaja).subscribe({
      next: (res) => this.movimientosHist.set(res?.data ?? []),
      error: () => this.movimientosHist.set([]),
    });
  }

  /**
   * Baja el turno abierto en el detalle como archivo de Excel.
   *
   * El error llega como Blob, no como JSON, porque la petición pidió `responseType:
   * 'blob'` y eso vale también para las respuestas de error: hay que leerlo como texto
   * antes de poder sacarle el mensaje, o el usuario solo vería "[object Blob]".
   */
  exportarCajaHistorial(): void {
    const sel = this.cajaHistSel();
    const idNegocio = this.idNegocio();
    if (!sel || !idNegocio || this.exportandoCaja()) return;

    this.exportandoCaja.set(true);
    this.cajaSvc.exportarCaja(sel.id_caja, idNegocio).subscribe({
      next: (res) => {
        this.exportandoCaja.set(false);
        if (!res.body) {
          this.ui.error('El servidor no devolvió ningún archivo.');
          return;
        }
        this.descargarArchivo(res.body, this.nombreArchivo(res, sel.id_caja));
      },
      error: async (err: HttpErrorResponse) => {
        this.exportandoCaja.set(false);
        this.ui.error(await this.mensajeErrorBlob(err));
      },
    });
  }

  /** El nombre lo manda el servidor en `Content-Disposition`; si no llega, uno propio. */
  private nombreArchivo(res: HttpResponse<Blob>, idCaja: number): string {
    const cabecera = res.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cabecera);
    if (match?.[1]) return decodeURIComponent(match[1]);
    return `caja_${idCaja}.xlsx`;
  }

  private async mensajeErrorBlob(err: HttpErrorResponse): Promise<string> {
    const generico = 'No se pudo exportar el reporte de caja.';
    if (!(err.error instanceof Blob)) return err?.error?.message || generico;
    try {
      return JSON.parse(await err.error.text())?.message || generico;
    } catch {
      return generico;
    }
  }

  private descargarArchivo(blob: Blob, nombre: string): void {
    if (!this.isBrowser) return;
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombre;
    enlace.click();
    URL.revokeObjectURL(url);
  }

  /** Vuelve de la vista de detalle a la lista, sin recargarla. */
  volverAListaHistorial(): void {
    this.cajaHistSel.set(null);
    this.movimientosHist.set([]);
    this.cerrarTodasLasFilas();
  }

  private cargarResumenDomiciliarios(): void {
    const id = this.idNegocio();
    if (!id) return;

    this.cargandoDomiciliarios.set(true);
    this.cajaSvc.getDomiciliariosResumen(id).subscribe({
      next: (res) => {
        this.resumenDomiciliarios.set(res?.data?.resumen ?? null);
        this.domiciliariosResumen.set(res?.data?.rows ?? []);
        this.errorDomiciliarios.set('');
        this.cargandoDomiciliarios.set(false);
      },
      error: () => {
        this.resumenDomiciliarios.set(null);
        this.domiciliariosResumen.set([]);
        this.errorDomiciliarios.set('No se pudo cargar el resumen de domiciliarios.');
        this.cargandoDomiciliarios.set(false);
      },
    });
  }

  transferirDomiciliario(item: DomiciliarioResumen): void {
    const idNegocio = this.idNegocio();
    if (!idNegocio || !item.id_domiciliario) return;
    if (this.transferiendoDomiciliarioId() !== null) return;

    this.transferiendoDomiciliarioId.set(item.id_domiciliario);
    this.cajaSvc.transferirDomiciliario(idNegocio, item.id_domiciliario).subscribe({
      next: (res) => {
        const total = res?.data?.total_pedidos ?? 0;
        const monto = res?.data?.total_monto ?? 0;
        // Sin permiso para ver importes, el aviso confirma la acción sin decir cuánto:
        // esconder las cifras en pantalla y soltarlas en el toast sería inútil.
        const detalle = this.puedeVerIngresos()
          ? ` por ${monto.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}`
          : '';
        this.ui.success(
          total > 0
            ? `Se transfirieron ${total} pedido(s)${detalle}.`
            : 'No hay pedidos en posesion para transferir.',
          'Transferencia a caja',
        );
        this.transferiendoDomiciliarioId.set(null);
        // Auto-refrescar toda la información de caja después de la transferencia
        this.refrescarCaja();
      },
      error: (err) => {
        this.ui.error(err?.error?.message || 'No se pudo transferir los pedidos.');
        this.transferiendoDomiciliarioId.set(null);
      },
    });
  }

  // ── Acciones ──
  abrirCaja(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.enviando.set(true);
    this.cajaSvc.abrirCaja({
      id_negocio: id,
      monto_apertura: Number(this.montoApertura()) || 0,
      observaciones: this.obsApertura().trim() || null,
    }).subscribe({
      next: (res) => {
        this.enviando.set(false);
        this.modal.set(null);
        if (res?.success) {
          this.ui.success('Caja abierta correctamente.', 'Caja abierta');
          this.refrescarCaja();
        }
      },
      error: (err) => {
        this.enviando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo abrir la caja.');
      },
    });
  }

  cerrarCaja(): void {
    const caja = this.caja();
    const id = this.idNegocio();
    if (!caja || !id) return;
    this.enviando.set(true);
    this.cajaSvc.cerrarCaja(caja.id_caja, {
      id_negocio: id,
      monto_reportado: this.montoReportado(),
      observaciones: this.obsCierre().trim() || null,
    }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.modal.set(null);
        this.movimientos.set([]);
        this.ui.success('La caja fue cerrada y el turno quedó registrado.', 'Caja cerrada');
      },
      error: (err: HttpErrorResponse) => {
        this.enviando.set(false);
        const code = err?.error?.errors?.code;
        if (code === 'PENDIENTES_ACTIVOS') {
          const p = err?.error?.errors?.pendientes as { mesas: number; domicilios: number; llevar: number } | undefined;
          const partes: string[] = [];
          if (p?.mesas)      partes.push(`${p.mesas} mesa(s) sin cobrar`);
          if (p?.domicilios) partes.push(`${p.domicilios} domicilio(s) sin finalizar`);
          if (p?.llevar)     partes.push(`${p.llevar} pedido(s) para llevar sin finalizar`);
          void this.ui.alert({
            title: 'Operaciones pendientes',
            message: `No se puede cerrar la caja. Resuelve los pendientes antes de continuar:\n• ${partes.join('\n• ')}`,
            tone: 'warning',
          });
        } else {
          this.ui.error(err?.error?.message || 'No se pudo cerrar la caja.');
        }
      },
    });
  }

  registrarMovimiento(): void {
    const caja = this.caja();
    if (!caja) return;
    const monto = Number(this.movMonto());
    if (!(monto > 0)) {
      this.ui.error('El monto debe ser mayor a cero.');
      return;
    }
    // Solo se exige cuando el negocio tiene formas de pago que ofrecer: un negocio
    // sin ninguna configurada debe poder seguir registrando movimientos.
    if (this.metodosPago().length > 0 && !this.movMetodoPago()) {
      this.ui.error('Elige la forma de pago del movimiento.');
      return;
    }
    this.enviando.set(true);
    this.cajaSvc.registrarMovimiento({
      id_caja: caja.id_caja,
      tipo: this.movTipo(),
      monto,
      concepto: this.movConcepto().trim() || null,
      id_metodo_pago: this.movMetodoPago(),
    }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.modal.set(null);
        this.ui.success('Movimiento registrado.');
        this.refrescarCaja();
      },
      error: (err) => {
        this.enviando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo registrar el movimiento.');
      },
    });
  }

  formatTipoPedido(tipo?: string | null): string {
    const value = (tipo || '').toUpperCase();
    if (value === 'MESA') return 'Mesa';
    if (value === 'LLEVAR') return 'Para llevar';
    if (value === 'DOMICILIO') return 'Domicilio';
    return 'No aplica';
  }

  /**
   * Concepto corto: cuando el movimiento viene de un pedido basta el número de
   * orden. El texto largo repetía "Orden ORD-0031 · ORD-0031".
   */
  conceptoCorto(m: MovimientoCaja): string {
    if (m.orden?.numero_orden) return m.orden.numero_orden;
    return m.concepto || '—';
  }

  /** Etiqueta de la columna Tipo, que además distingue las anulaciones. */
  etiquetaTipo(m: MovimientoCaja): string {
    if (m.es_anulacion) return 'ELIMINADO';
    if (m.anulado) return `${m.tipo} · ANULADO`;
    return m.tipo;
  }

  /**
   * En la columna "Tipo pedido": el egreso del domiciliario se etiqueta como
   * Domicilio aunque el pedido sea Para llevar, para saber de qué es ese egreso.
   */
  tipoPedidoMovimiento(m: MovimientoCaja): string {
    if (m.es_pago_domicilio) return 'Domicilio';
    return this.formatTipoPedido(m.orden?.tipo_pedido);
  }

  /** Se elimina cualquier movimiento de este turno que aún no se haya reversado. */
  puedeAnular(m: MovimientoCaja): boolean {
    if (!this.puedeEliminarPedido() || m.es_anulacion || m.anulado) return false;
    // El cobro de un pedido se elimina completo (con su egreso de domicilio).
    if (m.tipo === 'INGRESO') return !!m.orden?.id_orden;
    // Cualquier egreso vuelve a caja por su cuenta.
    return true;
  }

  /**
   * Elimina de la caja un pedido ya cobrado. No borra nada: el backend registra
   * movimientos compensatorios, así que el original sigue listado como anulado y
   * queda constancia de quién lo hizo.
   */
  async anularPedido(m: MovimientoCaja): Promise<void> {
    const idNegocio = this.idNegocio();
    if (!idNegocio || this.anulandoOrdenId() !== null || !this.puedeAnular(m)) return;

    // El cobro de un pedido se reversa completo (incluido su egreso de domicilio);
    // un egreso suelto se reversa por sí mismo y su monto vuelve a la caja.
    const esPedido = m.tipo === 'INGRESO' && !!m.orden?.id_orden;
    const etiqueta = esPedido
      ? `el pedido ${m.orden!.numero_orden || '#' + m.orden!.id_orden}`
      : `el egreso "${m.concepto || 'sin concepto'}"`;

    const confirmar = await this.ui.confirm({
      title: esPedido ? 'Eliminar pedido' : 'Eliminar egreso',
      // Sin permiso para ver importes el monto llega en null: la pregunta se hace
      // igual, solo sin la cifra.
      message: `¿Está seguro que desea eliminar ${etiqueta}${this.sufijoMonto(m.monto)}? `
        + (esPedido
          ? 'Esta acción no se puede revertir. '
          : 'El monto volverá a la caja y esta acción no se puede revertir. ')
        + 'No se borra: queda listado como eliminado, con su nombre y la fecha.',
      confirmText: esPedido ? 'Eliminar pedido' : 'Eliminar egreso',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmar) return;

    // Se anota el tipo porque las dos ramas devuelven ApiResponse de payloads
    // distintos y su unión no es invocable con .subscribe().
    const peticion$: Observable<ApiResponse<unknown>> = esPedido
      ? this.cajaSvc.anularPedido(m.orden!.id_orden, idNegocio)
      : this.cajaSvc.anularMovimiento(m.id_movimiento, idNegocio);

    this.anulandoOrdenId.set(m.id_movimiento);
    peticion$.subscribe({
      next: (res) => {
        this.anulandoOrdenId.set(null);
        if (res?.success) {
          this.ui.success(
            esPedido ? 'El pedido se eliminó de la caja.' : 'El egreso volvió a la caja.',
            'Eliminado'
          );
          this.refrescarCaja();
        }
      },
      error: (err) => {
        this.anulandoOrdenId.set(null);
        this.ui.error(err?.error?.message || 'No se pudo eliminar el movimiento de la caja.');
      },
    });
  }

  private formatMonto(valor: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0,
    }).format(Number(valor) || 0);
  }

  /** " por $12.000", o cadena vacía si el rol no puede ver importes. */
  private sufijoMonto(valor: number | null | undefined): string {
    if (valor === null || valor === undefined) return '';
    return ` por ${this.formatMonto(valor)}`;
  }
}
