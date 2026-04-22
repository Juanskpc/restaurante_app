import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { CajaService, MovimientoCaja } from '../../../core/services/caja.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

type ModalActivo = null | 'apertura' | 'cierre' | 'movimiento';

@Component({
  selector: 'app-caja',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './caja.html',
  styleUrl: './caja.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CajaComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly cajaSvc = inject(CajaService);
  private readonly ui = inject(UiFeedbackService);

  readonly caja = this.cajaSvc.cajaAbierta;
  readonly cargando = this.cajaSvc.cargando;
  readonly movimientos = signal<MovimientoCaja[]>([]);
  readonly cargandoMovimientos = signal(false);

  readonly modal = signal<ModalActivo>(null);
  readonly enviando = signal(false);

  // ── Apertura ──
  readonly montoApertura = signal(0);
  readonly obsApertura = signal('');

  // ── Cierre ──
  readonly montoReportado = signal<number | null>(null);
  readonly obsCierre = signal('');

  // ── Movimiento manual ──
  readonly movTipo = signal<'INGRESO' | 'EGRESO'>('INGRESO');
  readonly movMonto = signal(0);
  readonly movConcepto = signal('');

  readonly negocio = computed(() => this.auth.negocio());
  readonly idNegocio = computed(() => this.negocio()?.id_negocio ?? null);

  readonly puedeAbrir = computed(() => this.auth.canAccessSubnivel('caja_abrir'));
  readonly puedeCerrar = computed(() => this.auth.canAccessSubnivel('caja_cerrar'));
  readonly puedeMovimiento = computed(() => this.auth.canAccessSubnivel('caja_movimiento'));

  readonly diferenciaCierre = computed(() => {
    const reportado = this.montoReportado();
    const esperado = this.caja()?.monto_esperado ?? 0;
    if (reportado === null || Number.isNaN(Number(reportado))) return null;
    return Number(reportado) - Number(esperado);
  });

  ngOnInit(): void {
    this.cargar();
  }

  private cargar(): void {
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
      this.montoApertura.set(0);
      this.obsApertura.set('');
    }
    if (modal === 'cierre') {
      this.montoReportado.set(null);
      this.obsCierre.set('');
    }
    if (modal === 'movimiento') {
      this.movTipo.set('INGRESO');
      this.movMonto.set(0);
      this.movConcepto.set('');
    }
    this.modal.set(modal);
  }

  cerrarModal(): void {
    if (this.enviando()) return;
    this.modal.set(null);
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
          this.cargar();
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
      error: (err) => {
        this.enviando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo cerrar la caja.');
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
        this.cargar();
      },
      error: (err) => {
        this.enviando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo registrar el movimiento.');
      },
    });
  }
}
