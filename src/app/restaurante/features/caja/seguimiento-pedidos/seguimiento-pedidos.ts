import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import {
  CajaService, EstadoSeguimiento, PedidoSeguimiento, ResumenSeguimiento, TipoEventoSeguimiento,
} from '../../../../core/services/caja.service';

const PAGINA = 30;

/** Etiqueta y color de cada estado, para el badge de la tabla. */
const ESTADOS: Record<EstadoSeguimiento, { etiqueta: string; clase: string }> = {
  ABIERTA:   { etiqueta: 'En curso',  clase: 'badge--abierta' },
  CERRADA:   { etiqueta: 'Cobrada',   clase: 'badge--cobrada' },
  CANCELADA: { etiqueta: 'Cancelada', clase: 'badge--cancelada' },
  ANULADA:   { etiqueta: 'Anulada',   clase: 'badge--anulada' },
};

/** Icono y texto de cada paso de la línea de tiempo. */
const EVENTOS: Record<TipoEventoSeguimiento, { icono: string; texto: string }> = {
  tomado:    { icono: 'notebook-pen', texto: 'Tomó el pedido' },
  cobrado:   { icono: 'dollar-sign',  texto: 'Cobró' },
  cancelado: { icono: 'x-circle',     texto: 'Canceló sin cobrar' },
  anulado:   { icono: 'rotate-ccw',   texto: 'Anuló el cobro' },
};

/**
 * Sección «Movimientos» de Caja: el flujo completo de cada pedido —quién lo
 * tomó, quién lo cobró o lo canceló, y con qué—, para que cancelar un pedido
 * nunca sea algo que solo vea quien lo canceló.
 *
 * Modal hijo de `CajaComponent`; solo se monta si `puedeVerMovimientos()`, y el
 * backend vuelve a exigir el permiso por su cuenta (`caja_ver_movimientos`).
 */
@Component({
  selector: 'app-seguimiento-pedidos',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe],
  templateUrl: './seguimiento-pedidos.html',
  styleUrl: './seguimiento-pedidos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeguimientoPedidosComponent implements OnInit {
  @Input({ required: true }) idNegocio!: number;
  @Output() cerrar = new EventEmitter<void>();

  private readonly cajaSvc = inject(CajaService);

  private hoyISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  readonly desde = signal(this.hoyISO());
  readonly hasta = signal(this.hoyISO());
  readonly estado = signal<EstadoSeguimiento | null>(null);
  readonly q = signal('');

  readonly cargando = signal(false);
  readonly error = signal('');
  readonly filas = signal<PedidoSeguimiento[]>([]);
  readonly total = signal(0);
  readonly resumen = signal<ResumenSeguimiento | null>(null);
  readonly filaAbierta = signal<number | null>(null);

  readonly hayMas = computed(() => this.filas().length < this.total());

  readonly filtros: { clave: EstadoSeguimiento | null; etiqueta: string }[] = [
    { clave: null, etiqueta: 'Todos' },
    { clave: 'ABIERTA', etiqueta: 'En curso' },
    { clave: 'CERRADA', etiqueta: 'Cobradas' },
    { clave: 'CANCELADA', etiqueta: 'Canceladas' },
    { clave: 'ANULADA', etiqueta: 'Anuladas' },
  ];

  ngOnInit(): void {
    this.buscar(true);
  }

  cambiarFiltro(estado: EstadoSeguimiento | null): void {
    this.estado.set(estado);
    this.buscar(true);
  }

  /** `reiniciar` vuelve a la primera página; si no, añade la siguiente. */
  buscar(reiniciar = false): void {
    if (this.cargando()) return;
    const offset = reiniciar ? 0 : this.filas().length;
    this.cargando.set(true);

    this.cajaSvc.getSeguimiento(this.idNegocio, {
      desde: this.desde() || null,
      hasta: this.hasta() || null,
      estado: this.estado(),
      q: this.q().trim() || null,
      limite: PAGINA,
      offset,
    }).subscribe({
      next: (res) => {
        const data = res?.data;
        this.filas.set(reiniciar ? (data?.rows ?? []) : [...this.filas(), ...(data?.rows ?? [])]);
        this.total.set(data?.total ?? 0);
        this.resumen.set(data?.resumen ?? null);
        this.error.set('');
        this.cargando.set(false);
      },
      error: (err: HttpErrorResponse) => {
        if (reiniciar) { this.filas.set([]); this.total.set(0); this.resumen.set(null); }
        this.error.set(
          err.status === 403
            ? 'Tu rol no tiene permiso para ver el seguimiento de pedidos.'
            : (err?.error?.message || 'No se pudo cargar el seguimiento de pedidos.'),
        );
        this.cargando.set(false);
      },
    });
  }

  toggleFila(idOrden: number): void {
    this.filaAbierta.set(this.filaAbierta() === idOrden ? null : idOrden);
  }

  etiquetaEstado(estado: EstadoSeguimiento): { etiqueta: string; clase: string } {
    return ESTADOS[estado];
  }

  eventoInfo(tipo: TipoEventoSeguimiento): { icono: string; texto: string } {
    return EVENTOS[tipo];
  }
}
