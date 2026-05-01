import {
  Component, ChangeDetectionStrategy, OnInit, inject, signal, computed, PLATFORM_ID,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { environment } from '../../../../environments/environment';

type TipoPedido = 'MESA' | 'LLEVAR' | 'DOMICILIO';
type FiltroTipo = 'TODOS' | 'LLEVAR' | 'DOMICILIO';

interface DetalleDespacho {
  id_producto: number;
  cantidad: number;
  precio_unitario: number;
  nota?: string | null;
  producto?: { nombre: string };
}

export interface PedidoDespacho {
  id_orden: number;
  numero_orden: string;
  id_metodo_pago?: number | null;
  tipo_pedido: TipoPedido;
  total: number;
  fecha_creacion: string;
  estado: string;
  estado_cocina: string | null;
  estado_pago: string;
  nota?: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  direccion_domicilio: string | null;
  nota_domicilio: string | null;
  id_domiciliario: number | null;
  domiciliario?: {
    id_usuario: number;
    primer_nombre: string;
    primer_apellido: string;
  } | null;
  usuario?: {
    id_usuario: number;
    primer_nombre: string;
    primer_apellido: string;
  };
  detalles?: DetalleDespacho[];
}

@Component({
  selector: 'app-despacho',
  imports: [LucideAngularModule, CurrencyPipe, DatePipe],
  templateUrl: './despacho.html',
  styleUrl: './despacho.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DespachoComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly uiFeedback = inject(UiFeedbackService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly pedidos = signal<PedidoDespacho[]>([]);
  readonly cargando = signal(false);
  readonly filtro = signal<FiltroTipo>('TODOS');
  readonly pedidoActivo = signal<PedidoDespacho | null>(null);
  readonly cobrandoId = signal<number | null>(null);
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string }>>([]);
  readonly metodoPagoSeleccionado = signal<number | null>(null);

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly puedeVerTodos = computed(() => this.auth.canAccessSubnivel('despacho_ver_todos'));
  readonly puedeCancelarNoPagados = computed(() => this.auth.canAccessSubnivel('despacho_cancelar_no_pagado'));

  readonly pedidosFiltrados = computed(() => {
    const f = this.filtro();
    const lista = this.pedidos();
    if (f === 'TODOS') return lista;
    return lista.filter((p) => p.tipo_pedido === f);
  });

  readonly countLlevar = computed(() =>
    this.pedidos().filter((p) => p.tipo_pedido === 'LLEVAR').length,
  );
  readonly countDomicilio = computed(() =>
    this.pedidos().filter((p) => p.tipo_pedido === 'DOMICILIO').length,
  );

  ngOnInit(): void {
    this.cargar();
    this.loadMetodosPago();
  }

  private loadMetodosPago(): void {
    const id = this.negocioId();
    if (!id) return;
    this.http.get<{ success: boolean; data: Array<{ id_metodo_pago: number; nombre: string }> }>(
      `${environment.apiUrl}/metodos-pago?id_negocio=${id}`
    ).subscribe({
      next: (res) => this.metodosPago.set(res?.data ?? []),
      error: () => this.metodosPago.set([]),
    });
  }

  cargar(): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);

    const url = `${environment.apiUrl}/despacho?id_negocio=${id}`;

    this.http.get<{ success: boolean; data: PedidoDespacho[] }>(url).subscribe({
      next: (res) => {
        this.pedidos.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => {
        this.pedidos.set([]);
        this.cargando.set(false);
        this.uiFeedback.error('No se pudieron cargar los pedidos de despacho.');
      },
    });
  }

  seleccionarFiltro(f: FiltroTipo): void {
    this.filtro.set(f);
  }

  abrirPedido(p: PedidoDespacho): void {
    this.pedidoActivo.set(p);
    this.metodoPagoSeleccionado.set(p.id_metodo_pago ?? null);
  }

  cerrarPedido(): void {
    this.pedidoActivo.set(null);
    this.metodoPagoSeleccionado.set(null);
  }

  seleccionarMetodoPago(rawValue: string): void {
    this.metodoPagoSeleccionado.set(rawValue ? Number(rawValue) : null);
  }

  /** Devuelve un href tel: limpio (solo dígitos y +). */
  telHref(numero: string | null | undefined): string | null {
    if (!numero) return null;
    const limpio = String(numero).replace(/[^\d+]/g, '');
    return limpio ? `tel:${limpio}` : null;
  }

  tipoLabel(tipo: TipoPedido): string {
    if (tipo === 'DOMICILIO') return 'Domicilio';
    if (tipo === 'LLEVAR') return 'Llevar';
    return 'En mesa';
  }

  domiciliarioNombre(p: PedidoDespacho): string {
    if (!p.domiciliario) return 'Sin asignar';
    return `${p.domiciliario.primer_nombre} ${p.domiciliario.primer_apellido}`.trim();
  }

  itemsResumen(p: PedidoDespacho): string {
    const detalles = p.detalles ?? [];
    const totalItems = detalles.reduce((s, d) => s + Number(d.cantidad ?? 0), 0);
    if (totalItems <= 0) return '—';
    return `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`;
  }

  esPendientePago(p: PedidoDespacho): boolean {
    return (p.estado_pago ?? 'pendiente_pago') === 'pendiente_pago';
  }

  async finalizarTodo(): Promise<void> {
    const lista = this.pedidosFiltrados();
    if (lista.length === 0) {
      await this.uiFeedback.alert({
        title: 'Sin pedidos',
        message: 'No hay pedidos activos para finalizar.',
        tone: 'info',
      });
      return;
    }

    const cobrados   = lista.filter(p => !this.esPendientePago(p));
    const noCobrados = lista.filter(p =>  this.esPendientePago(p));

    let procesarCobrados   = cobrados;
    let procesarNoCobrados: PedidoDespacho[] = [];

    if (noCobrados.length > 0) {
      if (this.puedeCancelarNoPagados()) {
        const confirmar = await this.uiFeedback.confirm({
          title: 'Pedidos sin cobrar',
          message: `Hay ${noCobrados.length} pedido(s) que aún no se han cobrado. ¿Desea limpiar los cobrados y eliminar los no cobrados?`,
          confirmText: 'Sí',
          cancelText: 'No',
          tone: 'warning',
        });
        if (!confirmar) return;
        procesarNoCobrados = noCobrados;
      } else {
        if (cobrados.length === 0) {
          await this.uiFeedback.alert({
            title: 'Sin pedidos cobrados',
            message: 'No hay pedidos cobrados para finalizar y no tienes permiso para eliminar los no cobrados.',
            tone: 'warning',
          });
          return;
        }
        const confirmar = await this.uiFeedback.confirm({
          title: 'Finalizar cobrados',
          message: `Hay ${noCobrados.length} pedido(s) no cobrado(s) que no puedes eliminar. ¿Finalizar solo los ${cobrados.length} pedido(s) cobrado(s)?`,
          confirmText: 'Finalizar cobrados',
          cancelText: 'Cancelar',
          tone: 'warning',
        });
        if (!confirmar) return;
      }
    } else {
      const confirmar = await this.uiFeedback.confirm({
        title: 'Finalizar todo',
        message: `¿Finalizar los ${cobrados.length} pedido(s) cobrado(s)?`,
        confirmText: 'Finalizar todo',
        cancelText: 'Cancelar',
        tone: 'info',
      });
      if (!confirmar) return;
    }

    const requests$ = [
      ...procesarCobrados.map(p =>
        this.http.patch(`${environment.apiUrl}/pedidos/${p.id_orden}/cerrar`, {}).pipe(catchError(() => of(null)))
      ),
      ...procesarNoCobrados.map(p =>
        this.http.patch(`${environment.apiUrl}/pedidos/${p.id_orden}/cancelar`, {}).pipe(catchError(() => of(null)))
      ),
    ];

    if (requests$.length === 0) return;

    forkJoin(requests$).subscribe({
      next: () => {
        const ids = new Set([...procesarCobrados, ...procesarNoCobrados].map(p => p.id_orden));
        this.pedidos.update(l => l.filter(p => !ids.has(p.id_orden)));
        if (this.pedidoActivo() && ids.has(this.pedidoActivo()!.id_orden)) {
          this.pedidoActivo.set(null);
        }
        this.uiFeedback.success('Pedidos procesados correctamente.', 'Finalizar todo');
      },
      error: () => {
        this.cargar();
        this.uiFeedback.error('Error al procesar algunos pedidos. Se recargó la lista.');
      },
    });
  }

  async limpiarPedido(p: PedidoDespacho, event: Event): Promise<void> {
    event.stopPropagation();

    const confirmar = await this.uiFeedback.confirm({
      title: 'Marcar como entregado',
      message: `El pedido ${p.numero_orden} quedará finalizado y se removerá del módulo de despacho.`,
      confirmText: 'Finalizar',
      cancelText: 'Cancelar',
      tone: 'info',
    });
    if (!confirmar) return;

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/cerrar`, {}
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          this.pedidos.update(lista => lista.filter(ord => ord.id_orden !== p.id_orden));
          if (this.pedidoActivo()?.id_orden === p.id_orden) this.pedidoActivo.set(null);
          this.uiFeedback.success('Pedido finalizado correctamente.', 'Entregado');
        }
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.uiFeedback.error(msg || 'No se pudo finalizar el pedido.');
      },
    });
  }

  async eliminarPedido(p: PedidoDespacho, event: Event): Promise<void> {
    event.stopPropagation();

    if (!this.puedeCancelarNoPagados()) {
      await this.uiFeedback.alert({
        title: 'Acceso restringido',
        message: 'Tu rol no tiene permiso para eliminar pedidos pendientes de pago.',
        tone: 'warning',
      });
      return;
    }

    const confirmar = await this.uiFeedback.confirm({
      title: 'Eliminar pedido',
      message: `Se cancelará el pedido ${p.numero_orden}. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmar) return;

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/cancelar`, {}
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          this.pedidos.update(lista => lista.filter(ord => ord.id_orden !== p.id_orden));
          if (this.pedidoActivo()?.id_orden === p.id_orden) this.pedidoActivo.set(null);
          this.uiFeedback.success('Pedido eliminado correctamente.', 'Eliminado');
        }
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.uiFeedback.error(msg || 'No se pudo eliminar el pedido.');
      },
    });
  }

  cobrar(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    if (this.cobrandoId() !== null) return;

    const idMetodoPago = this.metodoPagoSeleccionado() ?? p.id_metodo_pago ?? null;
    if (!idMetodoPago) {
      void this.uiFeedback.alert({
        title: 'Forma de pago requerida',
        message: 'Selecciona una forma de pago antes de registrar el cobro.',
        tone: 'warning',
      });
      return;
    }

    this.cobrandoId.set(p.id_orden);

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/marcar-pagado`,
      { id_metodo_pago: idMetodoPago, origen_cobro: 'DOMICILIARIO' }
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          const apply = (ord: PedidoDespacho) =>
            ord.id_orden === p.id_orden
              ? { ...ord, estado_pago: 'pagado', id_metodo_pago: idMetodoPago }
              : ord;

          this.pedidos.update(lista => lista.map(apply));
          const activo = this.pedidoActivo();
          if (activo?.id_orden === p.id_orden) {
            this.pedidoActivo.set(apply(activo));
          }
          this.uiFeedback.success('Pago registrado correctamente.', 'Cobro exitoso');
        }
        this.cobrandoId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        const codigo = err?.error?.errors?.code || err?.error?.code;
        if (codigo === 'CAJA_CERRADA') {
          void this.uiFeedback.alert({
            title: 'Caja cerrada',
            message: err?.error?.message || 'La caja está cerrada. Ábrela antes de registrar cobros.',
            tone: 'warning',
          });
        } else {
          this.uiFeedback.error(err?.error?.message || 'No se pudo registrar el pago.');
        }
        this.cobrandoId.set(null);
      },
    });
  }

  // ── Impresión ──

  imprimirTicket(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    if (!this.isBrowser) return;

    const html = this.buildTicketHtml(p, new Date());
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);

    const frameDoc = frame.contentDocument;
    if (!frameDoc) {
      frame.remove();
      this.imprimirTicketFallback(html);
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
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

  private imprimirTicketFallback(html: string): void {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=700');
    if (!popup) {
      void this.uiFeedback.alert({
        title: 'No se pudo abrir la impresión',
        message: 'Habilita ventanas emergentes para continuar con la impresión.',
        tone: 'error',
      });
      return;
    }
    popup.document.open();
    popup.document.write(html);
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

  private buildTicketHtml(p: PedidoDespacho, fecha: Date): string {
    const negocio = this.escapeHtml(this.auth.negocio()?.nombre ?? 'Negocio');
    const usuario = this.escapeHtml(this.auth.usuario()?.nombre_completo ?? 'Usuario');
    const fechaTexto = this.escapeHtml(this.formatDateTime(fecha));
    const tipoTexto = p.tipo_pedido === 'DOMICILIO' ? 'Domicilio' : 'Para llevar';
    const contacto = this.escapeHtml(p.contacto_nombre ?? '');
    const telefono = this.escapeHtml(p.contacto_telefono ?? '');
    const direccion = p.tipo_pedido === 'DOMICILIO' ? this.escapeHtml(p.direccion_domicilio ?? '') : '';
    const notaDomicilio = this.escapeHtml(p.nota_domicilio?.trim() ?? '');
    const notaOrden = this.escapeHtml(p.nota?.trim() ?? '');
    const domiciliario = p.domiciliario
      ? this.escapeHtml(`${p.domiciliario.primer_nombre} ${p.domiciliario.primer_apellido}`.trim())
      : '';

    const infoRows = [
      contacto ? `<div class="meta">Cliente: ${contacto}</div>` : '',
      telefono ? `<div class="meta">Tel: ${telefono}</div>` : '',
      direccion ? `<div class="meta">Dir: ${direccion}</div>` : '',
      domiciliario ? `<div class="meta">Domiciliario: ${domiciliario}</div>` : '',
    ].join('');

    const notas = [
      notaOrden ? `<div class="ticket-note"><strong>Nota:</strong> ${notaOrden}</div>` : '',
      notaDomicilio ? `<div class="ticket-note"><strong>Nota domicilio:</strong> ${notaDomicilio}</div>` : '',
    ].filter(Boolean).join('');

    const filasItems = (p.detalles ?? []).map(d => {
      const nombre = this.escapeHtml(d.producto?.nombre ?? '(Producto)');
      const lineTotal = d.cantidad * d.precio_unitario;
      const notaItem = d.nota ? this.escapeHtml(String(d.nota)) : '';
      const notaItemHtml = notaItem
        ? `<tr><td></td><td colspan="3" class="item-meta">Nota: ${notaItem}</td></tr>`
        : '';
      return `
        <tr>
          <td>${d.cantidad}</td>
          <td>${nombre}</td>
          <td>${this.formatCurrency(d.precio_unitario)}</td>
          <td class="text-right">${this.formatCurrency(lineTotal)}</td>
        </tr>
        ${notaItemHtml}`;
    }).join('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Ticket ${this.escapeHtml(p.numero_orden)}</title>
  <style>
    @page { size: 80mm auto; margin: 6mm; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
    body { margin: 0; color: #111; background: #fff; }
    .ticket { max-width: 280px; margin: 0 auto; font-size: 12px; }
    .center { text-align: center; }
    .title { margin: 0; font-size: 16px; font-weight: 700; }
    .meta { margin-top: 2px; color: #555; }
    hr { border: 0; border-top: 1px dashed #aaa; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px 0; vertical-align: top; }
    th { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: .04em; }
    .text-right { text-align: right; }
    .item-meta { font-size: 10px; color: #666; padding-top: 0; }
    .ticket-note { margin-top: 6px; font-size: 11px; color: #333; }
    .totals { margin-top: 8px; }
    .totals-row { display: flex; justify-content: space-between; margin-top: 3px; }
    .totals-row.total { margin-top: 7px; padding-top: 5px; border-top: 1px dashed #aaa; font-weight: 700; font-size: 14px; }
    .footer { margin-top: 12px; text-align: center; font-size: 11px; color: #666; }
    @media print {
      * { color: #000 !important; font-weight: 700 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .title, .totals-row.total { font-weight: 900 !important; }
      h1, h2, th { font-weight: 900 !important; }
      hr { border-top-color: #000 !important; border-top-style: solid !important; }
      .meta, .ticket-note, .footer { color: #000 !important; font-weight: 700 !important; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <h1 class="title">${negocio}</h1>
      <div class="meta">${fechaTexto}</div>
      <div class="meta">Atiende: ${usuario}</div>
      <div class="meta">${tipoTexto} · ${this.escapeHtml(p.numero_orden)}</div>
      ${infoRows}
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
      <tbody>${filasItems}</tbody>
    </table>
    ${notas}
    <hr />
    <div class="totals">
      <div class="totals-row total">
        <span>TOTAL</span>
        <span>${this.formatCurrency(p.total)}</span>
      </div>
    </div>
    <div class="footer">Gracias por tu compra</div>
  </div>
</body>
</html>`;
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(value);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0,
    }).format(value);
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
