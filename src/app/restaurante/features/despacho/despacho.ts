import {
  Component, ChangeDetectionStrategy, OnInit, inject, signal, computed,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
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
  producto?: { nombre: string };
}

export interface PedidoDespacho {
  id_orden: number;
  numero_orden: string;
  tipo_pedido: TipoPedido;
  total: number;
  fecha_creacion: string;
  estado: string;
  estado_cocina: string | null;
  estado_pago: string;
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

  readonly pedidos = signal<PedidoDespacho[]>([]);
  readonly cargando = signal(false);
  readonly filtro = signal<FiltroTipo>('TODOS');
  readonly pedidoActivo = signal<PedidoDespacho | null>(null);
  readonly cobrandoId = signal<number | null>(null);

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly puedeVerTodos = computed(() => this.auth.canAccessSubnivel('despacho_ver_todos'));

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
  }

  cargar(): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);

    const verTodos = this.puedeVerTodos();
    const url = `${environment.apiUrl}/despacho?id_negocio=${id}&ver_todos=${verTodos}`;

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
  }

  cerrarPedido(): void {
    this.pedidoActivo.set(null);
  }

  /** Devuelve un href tel: limpio (solo dígitos y +). */
  telHref(numero: string | null | undefined): string | null {
    if (!numero) return null;
    const limpio = String(numero).replace(/[^\d+]/g, '');
    return limpio ? `tel:${limpio}` : null;
  }

  tipoLabel(tipo: TipoPedido): string {
    if (tipo === 'DOMICILIO') return 'Domicilio';
    if (tipo === 'LLEVAR') return 'Para llevar';
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

  cobrar(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    if (this.cobrandoId() !== null) return;
    this.cobrandoId.set(p.id_orden);

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/marcar-pagado`, {}
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          const apply = (ord: PedidoDespacho) =>
            ord.id_orden === p.id_orden ? { ...ord, estado_pago: 'pagado' } : ord;

          this.pedidos.update(lista => lista.map(apply));
          const activo = this.pedidoActivo();
          if (activo?.id_orden === p.id_orden) {
            this.pedidoActivo.set(apply(activo));
          }
          this.uiFeedback.success('Pago registrado correctamente.', 'Cobro exitoso');
        }
        this.cobrandoId.set(null);
      },
      error: () => {
        this.uiFeedback.error('No se pudo registrar el pago.');
        this.cobrandoId.set(null);
      },
    });
  }
}
