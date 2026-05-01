import { Component, ChangeDetectionStrategy, computed, effect, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
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
  nota?: string | null;
}

@Component({
  selector: 'app-mesas',
  imports: [LucideAngularModule, FormsModule],
  templateUrl: './mesas.html',
  styleUrl: './mesas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MesasComponent {
  private readonly auth = inject(AuthService);
  private readonly mesasApi = inject(MesasService);
  private readonly uiFeedback = inject(UiFeedbackService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly paidItemsStorageKey = 'pedidos_items_pagados_mesa_v1';

  readonly mesas = signal<MesaDashboard[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly filtro = signal<FiltroEstado>('all');
  readonly mesaActivaId = signal<number | null>(null);

  readonly modalNuevaMesa = signal(false);
  readonly editandoMesaId = signal<number | null>(null);
  readonly formNombre = signal('');
  readonly efectivoRecibidoInput = signal('');
  readonly cobroError = signal('');
  readonly itemsPagadosPorMesa = signal<Record<number, ItemPagadoMesa[]>>({});
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string }>>([]);
  readonly metodoPagoId = signal<number | null>(null);
  readonly metodoPagoError = signal(false);


  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly canCrearMesa = computed(() => this.auth.canAccessSubnivel('mesas_nueva_mesa'));
  readonly canAccionesPedido = computed(() => this.auth.canAccessSubnivel('mesas_acciones_pedido'));
  readonly canImprimirPedido = computed(() => this.auth.canAccessSubnivel('pedidos_imprimir'));
  readonly canAdministracionMesa = computed(() => this.auth.canAccessSubnivel('mesas_administracion'));

  readonly maxMesas = 24;
  private readonly moneyFormatter = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  });

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
    if (id) {
      this.loadMesas();
      this.loadMetodosPago(id);
    }
  });

  private loadMetodosPago(idNegocio: number): void {
    this.mesasApi.listarMetodosPago(idNegocio).subscribe({
      next: (res) => this.metodosPago.set(res?.data ?? []),
      error: () => this.metodosPago.set([]),
    });
  }

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
    this.metodoPagoId.set(mesa.order.id_metodo_pago ?? null);
    this.metodoPagoError.set(false);
  }

  closeMesa(): void {
    this.mesaActivaId.set(null);
    this.efectivoRecibidoInput.set('');
    this.cobroError.set('');
    this.metodoPagoId.set(null);
    this.metodoPagoError.set(false);
  }

  seleccionarMetodoPago(rawValue: string): void {
    this.metodoPagoId.set(rawValue ? Number(rawValue) : null);
    this.metodoPagoError.set(false);
  }

  setEfectivoRecibido(rawValue: string): void {
    this.efectivoRecibidoInput.set(rawValue);
    this.cobroError.set('');
  }

  openNuevaMesa(): void {
    if (!this.canCrearMesa()) return;

    this.editandoMesaId.set(null);
    this.formNombre.set('');
    this.modalNuevaMesa.set(true);
  }

  openEditarMesa(mesa: MesaDashboard): void {
    if (!this.canAdministracionMesa()) return;

    this.editandoMesaId.set(mesa.id_mesa);
    this.formNombre.set(mesa.nombre);
    this.modalNuevaMesa.set(true);
  }

  closeNuevaMesa(): void {
    this.modalNuevaMesa.set(false);
  }

  saveMesa(): void {
    const idNegocio = this.negocioId();
    const nombre = this.formNombre().trim();
    const editingId = this.editandoMesaId();

    if (!nombre) return;
    if (!editingId && !idNegocio) return;

    this.guardando.set(true);

    const req = editingId
      ? this.mesasApi.editarMesa(editingId, { nombre })
      : this.mesasApi.crearMesa({
          id_negocio: idNegocio!,
          nombre,
          numero: this.nextNumero(),
        });

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

  async confirmarCobro(): Promise<void> {
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
      this.cobroError.set(`Faltan ${this.formatMoney(faltante)} para completar el pago.`);
      return;
    }

    if (!this.metodoPagoId()) {
      this.metodoPagoError.set(true);
      this.cobroError.set('Debes seleccionar una forma de pago para completar el cobro.');
      return;
    }

    // Pregunta si imprimir tiquete antes de cerrar
    const deseaImprimir = await this.uiFeedback.confirm({
      title: 'Cobro confirmado',
      message: '¿Deseas imprimir el tiquete?',
      confirmText: 'Imprimir',
      cancelText: 'Omitir',
      tone: 'info',
    });

    if (deseaImprimir) {
      this.imprimirResumenMesa();
    }

    this.guardando.set(true);
    this.mesasApi.cerrarOrden(idOrden, this.metodoPagoId()).subscribe({
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
      error: (err: { error?: { message?: string } }) => {
        this.guardando.set(false);
        this.uiFeedback.error(err?.error?.message || 'No fue posible confirmar el cobro de la mesa.');
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
      if (!this.canAccionesPedido()) return [];
      return [{ key: 'abrir', label: 'Reservar mesa', style: 'primary', icon: 'circle-plus' }];
    }

    if (status === 'occupied') {
      const actions: Array<{ key: string; label: string; style: 'primary' | 'warning' | 'ghost'; icon: string }> = [];
      if (this.canAccionesPedido()) {
        actions.push({ key: 'cuenta', label: 'Marcar por cobrar', style: 'warning', icon: 'receipt' });
      }
      if (this.canImprimirPedido()) {
        actions.push({ key: 'imprimir', label: 'Imprimir', style: 'ghost', icon: 'printer' });
      }
      if (this.canAccionesPedido()) {
        actions.push({ key: 'liberar', label: 'Liberar mesa', style: 'ghost', icon: 'door-open' });
      }
      return actions;
    }

    if (status === 'payment') {
      const actions: Array<{ key: string; label: string; style: 'primary' | 'warning' | 'ghost'; icon: string }> = [];
      if (this.canAccionesPedido()) {
        actions.push({ key: 'cobrar', label: 'Cobro', style: 'ghost', icon: 'credit-card' });
      }
      if (this.canImprimirPedido()) {
        actions.push({ key: 'imprimir', label: 'Imprimir', style: 'ghost', icon: 'printer' });
      }
      if (this.canAccionesPedido()) {
        actions.push({ key: 'liberar', label: 'Liberar mesa', style: 'ghost', icon: 'door-open' });
      }
      return actions;
    }

    return [];
  }

  runAction(action: string): void {
    if (action === 'imprimir') {
      if (!this.canImprimirPedido()) return;
      this.imprimirResumenMesa();
      return;
    }

    if (!this.canAccionesPedido()) return;

    if (action === 'abrir') this.abrirMesa();
    if (action === 'cuenta') this.pedirCuenta();
    if (action === 'cobrar') this.confirmarCobro();
    if (action === 'liberar') this.liberarMesaActual();
  }

  formatMoney(value: number): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return '$ 0';
    }
    return `$ ${this.moneyFormatter.format(numericValue)}`;
  }

  getMesaTimeLabel(mesa: MesaDashboard): string {
    if (mesa.time) return mesa.time;
    if (mesa.status === 'occupied' || mesa.status === 'payment') return '0 min';
    return 'Sin uso';
  }

  puedeVerBloquesAccionMesa(mesa: MesaDashboard): boolean {
    return this.modalActions(mesa.status).length > 0 || (this.canAdministracionMesa() && mesa.status === 'available');
  }

  imprimirResumenMesa(): void {
    const mesa = this.mesaActiva();
    if (!mesa || !this.isBrowser) return;

    const itemsPendientes = mesa.order.items ?? [];
    const itemsPagados = this.itemsPagadosMesaActiva();

    if (itemsPendientes.length === 0 && itemsPagados.length === 0) {
      void this.uiFeedback.alert({
        title: 'No hay items para imprimir',
        message: 'La mesa no tiene productos para generar el comprobante.',
        tone: 'warning',
      });
      return;
    }

    const ticketHtml = this.buildTicketHtml(mesa, itemsPendientes, itemsPagados, new Date());

    // Estrategia preferida: iframe oculto en la misma pestaña (no requiere popup permission).
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);

    const frameDoc = frame.contentDocument;
    if (!frameDoc) {
      frame.remove();
      this.imprimirTicketFallback(ticketHtml);
      return;
    }

    frameDoc.open();
    frameDoc.write(ticketHtml);
    frameDoc.close();

    let printed = false;
    const runPrint = () => {
      if (printed) return;
      const frameWindow = frame.contentWindow;
      if (!frameWindow) return;
      printed = true;
      frameWindow.focus();
      frameWindow.print();
      setTimeout(() => frame.remove(), 500);
    };

    setTimeout(runPrint, 280);
  }

  private buildTicketHtml(
    mesa: MesaDashboard,
    itemsPendientes: ItemPagadoMesa[],
    itemsPagados: ItemPagadoMesa[],
    fecha: Date,
  ): string {
    const negocioNombre = this.escapeHtml(this.auth.negocio()?.nombre ?? 'Negocio');
    const usuarioNombre = this.escapeHtml(this.auth.usuario()?.nombre_completo ?? 'Usuario');
    const fechaTexto = this.escapeHtml(this.formatDateTime(fecha));
    const tipoPedido = 'En mesa';
    const mesaTexto = this.escapeHtml(mesa.nombre);
    const itemsTicket = itemsPendientes.length > 0 ? itemsPendientes : itemsPagados;
    const notaOrden = this.escapeHtml(mesa.order.nota?.trim() || '');
    const notaHtml = notaOrden
      ? `<div class="ticket-note"><strong>Nota:</strong> ${notaOrden}</div>`
      : '';

    const filasItems = itemsTicket
      .map((item) => {
        const totalLinea = item.cantidad * item.price;
        const notaItem = item.nota ? this.escapeHtml(String(item.nota)) : '';
        const notaItemHtml = notaItem
          ? `<tr><td></td><td colspan="3" class="item-meta">Nota: ${notaItem}</td></tr>`
          : '';

        return `
          <tr>
            <td>${item.cantidad}</td>
            <td>${this.escapeHtml(item.name)}</td>
            <td>${this.formatCurrency(item.price)}</td>
            <td class="text-right">${this.formatCurrency(totalLinea)}</td>
          </tr>
          ${notaItemHtml}
        `;
      })
      .join('');

    return `
      <!doctype html>
      <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Ticket pedido</title>
        <style>
          @page {
            size: 80mm auto;
            margin: 6mm;
          }

          * {
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, sans-serif;
          }

          body {
            margin: 0;
            color: #111;
            background: #fff;
          }

          .ticket {
            max-width: 280px;
            margin: 0 auto;
            font-size: 12px;
          }

          .center {
            text-align: center;
          }

          .title {
            margin: 0;
            font-size: 16px;
            font-weight: 700;
          }

          .meta {
            margin-top: 2px;
            color: #555;
          }

          hr {
            border: 0;
            border-top: 1px dashed #aaa;
            margin: 10px 0;
          }

          table {
            width: 100%;
            border-collapse: collapse;
          }

          th,
          td {
            padding: 4px 0;
            vertical-align: top;
          }

          th {
            font-size: 10px;
            text-transform: uppercase;
            color: #666;
            letter-spacing: 0.04em;
          }

          .text-right {
            text-align: right;
          }

          .item-meta {
            font-size: 10px;
            color: #666;
            padding-top: 0;
          }

          .ticket-note {
            margin-top: 6px;
            font-size: 11px;
            color: #333;
          }

          .totals {
            margin-top: 8px;
          }

          .totals-row {
            display: flex;
            justify-content: space-between;
            margin-top: 3px;
          }

          .totals-row.total {
            margin-top: 7px;
            padding-top: 5px;
            border-top: 1px dashed #aaa;
            font-weight: 700;
            font-size: 14px;
          }

          .footer {
            margin-top: 12px;
            text-align: center;
            font-size: 11px;
            color: #666;
          }

          @media print {
            * {
              color: #000 !important;
              font-weight: 700 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .title,
            .totals-row.total {
              font-weight: 900 !important;
            }
            h1, h2, th {
              font-weight: 900 !important;
            }
            hr {
              border-top-color: #000 !important;
              border-top-style: solid !important;
            }
            .meta,
            .footer {
              color: #000 !important;
              font-weight: 700 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="center">
            <h1 class="title">${negocioNombre}</h1>
            <div class="meta">${fechaTexto}</div>
            <div class="meta">Atiende: ${usuarioNombre}</div>
            <div class="meta">Tipo: ${tipoPedido}</div>
            <div class="meta">Mesa: ${mesaTexto}</div>
          </div>

          <hr />

          <table>
            <thead>
              <tr>
                <th>Cant</th>
                <th>Producto</th>
                <th>Unit</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${filasItems}
            </tbody>
          </table>

          ${notaHtml}

          <hr />

          <div class="totals">
            <div class="totals-row total">
              <span>TOTAL</span>
              <span>${this.formatCurrency(mesa.order.total)}</span>
            </div>
          </div>

          <div class="footer">
            Gracias por tu compra
          </div>
        </div>
      </body>
      </html>
    `;
  }

  private imprimirTicketFallback(ticketHtml: string): void {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=700');
    if (!popup) {
      void this.uiFeedback.alert({
        title: 'No se pudo abrir la impresion',
        message: 'Habilita ventanas emergentes para continuar con la impresion.',
        tone: 'error',
      });
      return;
    }
    popup.document.open();
    popup.document.write(ticketHtml);
    popup.document.close();
    let printed = false;
    const printPopup = () => {
      if (printed) return;
      printed = true;
      popup.focus();
      popup.print();
      setTimeout(() => popup.close(), 600);
    };
    popup.addEventListener('load', printPopup, { once: true });
    setTimeout(printPopup, 500);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(value);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
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

  private persistirItemsPagadosMesaCache(idMesa: number, items: Array<{ name: string; price: number; cantidad: number; nota?: string | null }>): void {
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
        nota: item.nota ?? '',
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
