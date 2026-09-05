import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
  PLATFORM_ID,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { Observable } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import {
  ApiResponse, Caja, CajaHistorial, CajaService, DomiciliarioResumen, DomiciliariosResumen,
  MovimientoCaja,
} from '../../../core/services/caja.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

type ModalActivo = null | 'apertura' | 'cierre' | 'movimiento' | 'domiciliarios' | 'historial';

@Component({
  selector: 'app-caja',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './caja.html',
  styleUrl: './caja.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CajaComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly cajaSvc = inject(CajaService);
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
  readonly cargandoDetalleHist = signal(false);

  readonly hayMasHistorial = computed(() => this.historial().length < this.historialTotal());

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
    }
    if (modal === 'domiciliarios') {
      this.errorDomiciliarios.set('');
      this.cargarResumenDomiciliarios();
    }
    if (modal === 'historial') {
      this.cajaHistSel.set(null);
      this.movimientosHist.set([]);
      this.errorHistorial.set('');
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

  /** Vuelve de la vista de detalle a la lista, sin recargarla. */
  volverAListaHistorial(): void {
    this.cajaHistSel.set(null);
    this.movimientosHist.set([]);
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
    this.enviando.set(true);
    this.cajaSvc.registrarMovimiento({
      id_caja: caja.id_caja,
      tipo: this.movTipo(),
      monto,
      concepto: this.movConcepto().trim() || null,
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
