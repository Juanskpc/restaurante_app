import { Component, ChangeDetectionStrategy, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { MesasService, MesaDashboard, MesaCardStatus } from '../../../core/services/mesas.service';

type FiltroEstado = 'all' | 'available' | 'occupied' | 'payment' | 'disabled';

@Component({
  selector: 'app-mesas',
  imports: [LucideAngularModule, CurrencyPipe, FormsModule],
  templateUrl: './mesas.html',
  styleUrl: './mesas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MesasComponent {
  private readonly auth = inject(AuthService);
  private readonly mesasApi = inject(MesasService);

  readonly mesas = signal<MesaDashboard[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly filtro = signal<FiltroEstado>('all');
  readonly mesaActivaId = signal<number | null>(null);

  readonly modalNuevaMesa = signal(false);
  readonly editandoMesaId = signal<number | null>(null);
  readonly formNombre = signal('');
  readonly formNumero = signal<number | null>(null);
  readonly formCapacidad = signal<number>(4);
  readonly efectivoRecibidoInput = signal('');
  readonly cobroError = signal('');

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly maxMesas = 24;

  readonly mesasFiltradas = computed(() => {
    const f = this.filtro();
    if (f === 'all') return this.mesas();
    return this.mesas().filter((m) => m.status === f);
  });

  readonly mesaActiva = computed(() => {
    const id = this.mesaActivaId();
    if (!id) return null;
    return this.mesas().find((m) => m.id_mesa === id) ?? null;
  });

  readonly countAvailable = computed(() => this.mesas().filter((m) => m.status === 'available').length);
  readonly countOccupied = computed(() => this.mesas().filter((m) => m.status === 'occupied').length);
  readonly countPayment = computed(() => this.mesas().filter((m) => m.status === 'payment').length);
  readonly efectivoRecibido = computed(() => this.parseMonto(this.efectivoRecibidoInput()));
  readonly faltanteCobro = computed(() => {
    const mesa = this.mesaActiva();
    const recibido = this.efectivoRecibido();
    if (!mesa || recibido === null) return null;
    return Math.max(mesa.order.total - recibido, 0);
  });
  readonly vueltaCobro = computed(() => {
    const mesa = this.mesaActiva();
    const recibido = this.efectivoRecibido();
    if (!mesa || recibido === null) return null;
    return Math.max(recibido - mesa.order.total, 0);
  });

  private readonly negocioEffect = effect(() => {
    const id = this.negocioId();
    if (id) this.loadMesas();
  });

  loadMesas(): void {
    const id = this.negocioId();
    if (!id) return;

    this.cargando.set(true);
    this.mesasApi.getMesasDashboard(id).subscribe({
      next: (res) => {
        this.mesas.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  selectFilter(filter: FiltroEstado): void {
    this.filtro.set(filter);
  }

  openMesa(mesa: MesaDashboard): void {
    this.mesaActivaId.set(mesa.id_mesa);
    this.efectivoRecibidoInput.set('');
    this.cobroError.set('');
  }

  closeMesa(): void {
    this.mesaActivaId.set(null);
    this.efectivoRecibidoInput.set('');
    this.cobroError.set('');
  }

  setEfectivoRecibido(rawValue: string): void {
    this.efectivoRecibidoInput.set(rawValue);
    this.cobroError.set('');
  }

  openNuevaMesa(): void {
    this.editandoMesaId.set(null);
    this.formNombre.set('');
    this.formNumero.set(this.nextNumero());
    this.formCapacidad.set(4);
    this.modalNuevaMesa.set(true);
  }

  openEditarMesa(mesa: MesaDashboard): void {
    this.editandoMesaId.set(mesa.id_mesa);
    this.formNombre.set(mesa.nombre);
    this.formNumero.set(mesa.numero);
    this.formCapacidad.set(mesa.capacidad);
    this.modalNuevaMesa.set(true);
  }

  closeNuevaMesa(): void {
    this.modalNuevaMesa.set(false);
  }

  saveMesa(): void {
    const idNegocio = this.negocioId();
    const nombre = this.formNombre().trim();
    const numero = this.formNumero();
    const capacidad = this.formCapacidad();

    if (!idNegocio || !nombre || !numero || capacidad < 1) return;

    this.guardando.set(true);

    const editingId = this.editandoMesaId();
    const req = editingId
      ? this.mesasApi.editarMesa(editingId, { nombre, numero, capacidad })
      : this.mesasApi.crearMesa({ id_negocio: idNegocio, nombre, numero, capacidad });

    req.subscribe({
      next: () => {
        this.guardando.set(false);
        this.closeNuevaMesa();
        this.loadMesas();
      },
      error: () => this.guardando.set(false),
    });
  }

  abrirMesa(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    this.guardando.set(true);
    this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'OCUPADA').subscribe({
      next: () => {
        this.guardando.set(false);
        this.loadMesas();
      },
      error: () => this.guardando.set(false),
    });
  }

  pedirCuenta(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    this.guardando.set(true);
    this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'POR_COBRAR').subscribe({
      next: () => {
        this.guardando.set(false);
        this.loadMesas();
      },
      error: () => this.guardando.set(false),
    });
  }

  confirmarCobro(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    const idOrden = mesa.order.id_orden;
    if (!idOrden) {
      this.cobroError.set('No hay una cuenta abierta para cobrar en esta mesa.');
      return;
    }

    const recibido = this.efectivoRecibido();
    if (recibido !== null && recibido < mesa.order.total) {
      const faltante = mesa.order.total - recibido;
      this.cobroError.set(`Faltan ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(faltante)} para completar el pago.`);
      return;
    }

    this.guardando.set(true);
    this.mesasApi.cerrarOrden(idOrden).subscribe({
      next: () => {
        this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'OCUPADA').subscribe({
          next: () => {
            this.guardando.set(false);
            this.closeMesa();
            this.loadMesas();
          },
          error: () => {
            this.guardando.set(false);
            this.loadMesas();
          },
        });
      },
      error: () => this.guardando.set(false),
    });
  }

  liberarMesaDesdeCard(mesa: MesaDashboard, event: Event): void {
    event.stopPropagation();
    this.liberarMesa(mesa);
  }

  liberarMesaActual(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;
    this.liberarMesa(mesa);
  }

  puedeLiberarMesa(mesa: MesaDashboard | null): boolean {
    if (!mesa) return false;
    return !mesa.order.id_orden;
  }

  private liberarMesa(mesa: MesaDashboard): void {
    if (!this.puedeLiberarMesa(mesa)) {
      if (typeof window !== 'undefined') {
        window.alert('No se puede liberar la mesa porque tiene una cuenta pendiente de cobro.');
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmar = window.confirm(
        `¿Deseas liberar ${mesa.nombre}?`
      );
      if (!confirmar) return;
    }

    this.guardando.set(true);
    this.mesasApi.liberarMesa(mesa.id_mesa).subscribe({
      next: () => {
        this.guardando.set(false);
        if (this.mesaActivaId() === mesa.id_mesa) {
          this.closeMesa();
        }
        this.loadMesas();
      },
      error: (err: unknown) => {
        if (typeof window !== 'undefined') {
          const apiMessage = (err as { error?: { message?: string } })?.error?.message;
          window.alert(apiMessage || 'No se pudo liberar la mesa.');
        }
        this.guardando.set(false);
      },
    });
  }

  toggleHabilitar(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    const nextEstado = mesa.estado === 'A' ? 'I' : 'A';
    this.guardando.set(true);
    this.mesasApi.cambiarEstado(mesa.id_mesa, nextEstado).subscribe({
      next: () => {
        this.guardando.set(false);
        this.closeMesa();
        this.loadMesas();
      },
      error: () => this.guardando.set(false),
    });
  }

  statusLabel(status: MesaCardStatus): string {
    if (status === 'available') return 'Disponible';
    if (status === 'occupied') return 'Ocupada';
    if (status === 'payment') return 'Por cobrar';
    return 'Deshabilitada';
  }

  statusIcon(status: MesaCardStatus): string {
    if (status === 'available') return 'check-circle';
    if (status === 'occupied') return 'clipboard-list';
    if (status === 'payment') return 'receipt';
    return 'x-circle';
  }

  modalActions(status: MesaCardStatus): Array<{ key: string; label: string; style: 'primary' | 'warning' | 'ghost'; icon: string }> {
    if (status === 'available') {
      return [{ key: 'abrir', label: 'Reservar Mesa', style: 'primary', icon: 'circle-plus' }];
    }
    if (status === 'occupied') {
      return [
        { key: 'cuenta', label: 'Pedir Cuenta', style: 'warning', icon: 'receipt' },
        { key: 'liberar', label: 'Liberar Mesa', style: 'ghost', icon: 'door-open' },
      ];
    }
    if (status === 'payment') {
      return [
        { key: 'cobrar', label: 'Confirmar Cobro', style: 'primary', icon: 'credit-card' },
        { key: 'liberar', label: 'Liberar Mesa', style: 'ghost', icon: 'door-open' },
      ];
    }
    return [];
  }

  runAction(action: string): void {
    if (action === 'abrir') this.abrirMesa();
    if (action === 'cuenta') this.pedirCuenta();
    if (action === 'cobrar') this.confirmarCobro();
    if (action === 'liberar') this.liberarMesaActual();
  }

  private nextNumero(): number {
    if (this.mesas().length === 0) return 1;
    return Math.max(...this.mesas().map((m) => m.numero)) + 1;
  }

  private parseMonto(rawValue: string): number | null {
    const digits = rawValue.replace(/\D/g, '');
    if (!digits) return null;
    return Number(digits);
  }
}
