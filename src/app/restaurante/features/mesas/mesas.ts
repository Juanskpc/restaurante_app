import { Component, ChangeDetectionStrategy, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { MesasService, MesaDashboard, MesaCardStatus } from '../../../core/services/mesas.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

type FiltroEstado = 'all' | 'available' | 'occupied' | 'payment' | 'disabled';

interface ItemPagadoMesa {
  name: string;
  price: number;
  cantidad: number;
}

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
  private readonly uiFeedback = inject(UiFeedbackService);
  private readonly paidItemsStorageKey = 'pedidos_items_pagados_mesa_v1';

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
  readonly itemsPagadosPorMesa = signal<Record<number, ItemPagadoMesa[]>>({});

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly canCrearMesa = computed(() => this.auth.canAccessSubnivel('mesas_nueva_mesa'));
  readonly canAccionesPedido = computed(() => this.auth.canAccessSubnivel('mesas_acciones_pedido'));
  readonly canAdministracionMesa = computed(() => this.auth.canAccessSubnivel('mesas_administracion'));
  readonly canVerBloquesAccionMesa = computed(() => this.canAccionesPedido() || this.canAdministracionMesa());

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

  readonly itemsPagadosMesaActiva = computed(() => {
    const mesa = this.mesaActiva();
    if (!mesa) return [];
    return this.itemsPagadosPorMesa()[mesa.id_mesa] ?? [];
  });

  readonly totalPagadoMesaActiva = computed(() =>
    this.itemsPagadosMesaActiva().reduce((acc, item) => acc + (item.price * item.cantidad), 0)
  );

  private readonly negocioEffect = effect(() => {
    const id = this.negocioId();
    if (id) this.loadMesas();
  });

  loadMesas(): void {
    const id = this.negocioId();
    if (!id) return;

    this.hidratarItemsPagadosMesaCache();

    this.cargando.set(true);
    this.mesasApi.getMesasDashboard(id).subscribe({
      next: (res) => {
        this.mesas.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  actualizarMesas(): void {
    if (this.cargando()) return;
    this.loadMesas();
  }

  selectFilter(filter: FiltroEstado): void {
    this.filtro.set(filter);
  }

  openMesa(mesa: MesaDashboard): void {
    this.hidratarItemsPagadosMesaCache();
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
    if (!this.canCrearMesa()) return;

    this.editandoMesaId.set(null);
    this.formNombre.set('');
    this.formNumero.set(this.nextNumero());
    this.formCapacidad.set(4);
    this.modalNuevaMesa.set(true);
  }

  openEditarMesa(mesa: MesaDashboard): void {
    if (!this.canAdministracionMesa()) return;

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
        if (editingId) {
          this.uiFeedback.updated('Los datos de la mesa fueron actualizados.');
        } else {
          this.uiFeedback.created('La mesa fue creada correctamente.');
        }
        this.loadMesas();
      },
      error: () => {
        this.guardando.set(false);
        this.uiFeedback.error('No fue posible guardar la mesa.');
      },
    });
  }

  abrirMesa(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    this.guardando.set(true);
    this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'OCUPADA').subscribe({
      next: () => {
        this.guardando.set(false);
        this.uiFeedback.updated('La mesa fue marcada como ocupada.');
        this.loadMesas();
      },
      error: () => {
        this.guardando.set(false);
        this.uiFeedback.error('No fue posible actualizar el estado de la mesa.');
      },
    });
  }

  pedirCuenta(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;

    this.guardando.set(true);
    this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'POR_COBRAR').subscribe({
      next: () => {
        this.guardando.set(false);
        this.uiFeedback.updated('La mesa fue marcada para cobro.');
        this.loadMesas();
      },
      error: () => {
        this.guardando.set(false);
        this.uiFeedback.error('No fue posible marcar la mesa para cobro.');
      },
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
        this.persistirItemsPagadosMesaCache(mesa.id_mesa, mesa.order.items);
        this.mesasApi.cambiarEstadoServicio(mesa.id_mesa, 'OCUPADA').subscribe({
          next: () => {
            this.guardando.set(false);
            this.closeMesa();
            this.uiFeedback.success('El cobro se registro correctamente.', 'Cobro exitoso');
            this.loadMesas();
          },
          error: () => {
            this.guardando.set(false);
            this.loadMesas();
            this.uiFeedback.error('No fue posible actualizar el estado de la mesa despues del cobro.');
          },
        });
      },
      error: () => {
        this.guardando.set(false);
        this.uiFeedback.error('No fue posible confirmar el cobro de la mesa.');
      },
    });
  }

  liberarMesaDesdeCard(mesa: MesaDashboard, event: Event): void {
    event.stopPropagation();
    void this.liberarMesa(mesa);
  }

  liberarMesaActual(): void {
    const mesa = this.mesaActiva();
    if (!mesa) return;
    void this.liberarMesa(mesa);
  }

  puedeLiberarMesa(mesa: MesaDashboard | null): boolean {
    if (!mesa) return false;
    return !mesa.order.id_orden;
  }

  private async liberarMesa(mesa: MesaDashboard): Promise<void> {
    if (!this.puedeLiberarMesa(mesa)) {
      await this.uiFeedback.alert({
        title: 'No se puede liberar la mesa',
        message: 'No se puede liberar la mesa porque tiene una cuenta pendiente de cobro.',
        tone: 'warning',
      });
      return;
    }

    const confirmar = await this.uiFeedback.confirm({
      title: 'Liberar mesa',
      message: `¿Deseas liberar ${mesa.nombre}?`,
      confirmText: 'Liberar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmar) return;

    this.guardando.set(true);
    this.mesasApi.liberarMesa(mesa.id_mesa).subscribe({
      next: () => {
        this.guardando.set(false);
        this.limpiarItemsPagadosMesaCache(mesa.id_mesa);
        if (this.mesaActivaId() === mesa.id_mesa) {
          this.closeMesa();
        }
        this.uiFeedback.success('La mesa fue liberada correctamente.', 'Mesa liberada');
        this.loadMesas();
      },
      error: (err: unknown) => {
        const apiMessage = (err as { error?: { message?: string } })?.error?.message;
        this.uiFeedback.error(apiMessage || 'No se pudo liberar la mesa.');
        this.guardando.set(false);
      },
    });
  }

  toggleHabilitar(): void {
    if (!this.canAdministracionMesa()) return;

    const mesa = this.mesaActiva();
    if (!mesa) return;

    const nextEstado = mesa.estado === 'A' ? 'I' : 'A';
    this.guardando.set(true);
    this.mesasApi.cambiarEstado(mesa.id_mesa, nextEstado).subscribe({
      next: () => {
        this.guardando.set(false);
        this.closeMesa();
        if (nextEstado === 'I') {
          this.uiFeedback.inactivated('La mesa fue inactivada correctamente.');
        } else {
          this.uiFeedback.activated('La mesa fue activada correctamente.');
        }
        this.loadMesas();
      },
      error: () => {
        this.guardando.set(false);
        this.uiFeedback.error('No fue posible actualizar el estado de la mesa.');
      },
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
      return [{ key: 'abrir', label: 'Reservar mesa', style: 'primary', icon: 'circle-plus' }];
    }
    if (status === 'occupied') {
      return [
        { key: 'cuenta', label: 'Marcar por cobrar', style: 'warning', icon: 'receipt' },
        { key: 'liberar', label: 'Liberar mesa', style: 'ghost', icon: 'door-open' },
      ];
    }
    if (status === 'payment') {
      return [
        { key: 'cobrar', label: 'Confirmar Cobro', style: 'primary', icon: 'credit-card' },
        { key: 'liberar', label: 'Liberar mesa', style: 'ghost', icon: 'door-open' },
      ];
    }
    return [];
  }

  runAction(action: string): void {
    if (!this.canAccionesPedido()) return;

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

  private persistirItemsPagadosMesaCache(idMesa: number, items: Array<{ name: string; price: number; cantidad: number }>): void {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(this.paidItemsStorageKey);
      const cache = raw ? JSON.parse(raw) as Record<string, unknown> : {};

      cache[String(idMesa)] = items.map((item, idx) => ({
        id_producto: -(idx + 1),
        nombre: item.name,
        icono: '✅',
        precio_unitario: Number(item.price ?? 0),
        cantidad: Math.max(1, Number(item.cantidad ?? 1)),
        exclusiones: [],
        exclusionesNombres: [],
        nota: '',
      }));

      window.localStorage.setItem(this.paidItemsStorageKey, JSON.stringify(cache));
      this.hidratarItemsPagadosMesaCache();
    } catch {
      // El cache compartido es auxiliar; fallar aquí no debe romper el cobro.
    }
  }

  private limpiarItemsPagadosMesaCache(idMesa: number): void {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(this.paidItemsStorageKey);
      if (!raw) return;

      const cache = JSON.parse(raw) as Record<string, unknown>;
      delete cache[String(idMesa)];
      window.localStorage.setItem(this.paidItemsStorageKey, JSON.stringify(cache));
      this.hidratarItemsPagadosMesaCache();
    } catch {
      // El cache compartido es auxiliar; fallar aquí no debe bloquear la liberación.
    }
  }

  private hidratarItemsPagadosMesaCache(): void {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(this.paidItemsStorageKey);
      if (!raw) {
        this.itemsPagadosPorMesa.set({});
        return;
      }

      const parsed = JSON.parse(raw) as Record<string, Array<{
        nombre?: string;
        precio_unitario?: number;
        cantidad?: number;
      }>>;

      const hydrated: Record<number, ItemPagadoMesa[]> = {};

      for (const [mesaKey, items] of Object.entries(parsed)) {
        const idMesa = Number(mesaKey);
        if (!Number.isInteger(idMesa) || idMesa <= 0 || !Array.isArray(items)) {
          continue;
        }

        hydrated[idMesa] = items.map((item) => ({
          name: item?.nombre ?? 'Producto',
          price: Number(item?.precio_unitario ?? 0),
          cantidad: Math.max(1, Number(item?.cantidad ?? 1)),
        }));
      }

      this.itemsPagadosPorMesa.set(hydrated);
    } catch {
      this.itemsPagadosPorMesa.set({});
    }
  }
}
