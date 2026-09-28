import {
  ChangeDetectionStrategy, Component, DestroyRef, EventEmitter, Input, OnInit, Output, computed,
  inject, signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { Subject, Subscription, debounceTime } from 'rxjs';

import {
  Caja, CajaService, EstadoSeguimiento, PedidoSeguimiento, ResumenSeguimiento, TipoEventoSeguimiento,
} from '../../../../core/services/caja.service';

const PAGINA = 30;

/** Espera tras la última tecla antes de buscar: lo justo para no pedir una consulta por letra. */
const ESPERA_BUSQUEDA_MS = 300;

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
 * ## Va ligada a UNA caja, no a un rango de fechas (2026-09-29)
 *
 * Muestra los pedidos del turno en curso, así que no hay fechas que elegir: se entra y ya hay
 * resultados. Sin caja abierta no hay nada que mostrar y se dice así. El buscador filtra solo al
 * escribir (con una pequeña espera), sin botón.
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
  /** El turno abierto. `null` = no hay caja abierta y no hay pedidos de turno que enseñar. */
  @Input() caja: Caja | null = null;
  @Output() cerrar = new EventEmitter<void>();

  private readonly cajaSvc = inject(CajaService);
  private readonly destroyRef = inject(DestroyRef);

  /** Lo que se escribe en el buscador; cada cambio programa una búsqueda. */
  private readonly escritura$ = new Subject<void>();
  /** La petición en vuelo: una búsqueda nueva reemplaza a la anterior, no espera a que termine. */
  private peticion: Subscription | null = null;

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
    this.escritura$
      .pipe(debounceTime(ESPERA_BUSQUEDA_MS), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.buscar(true));

    this.buscar(true);
  }

  /** Cada tecla programa la búsqueda; el `debounceTime` espera a que pare de escribir. */
  alEscribir(valor: string): void {
    this.q.set(valor);
    this.escritura$.next();
  }

  cambiarFiltro(estado: EstadoSeguimiento | null): void {
    this.estado.set(estado);
    this.buscar(true);
  }

  /** `reiniciar` vuelve a la primera página; si no, añade la siguiente. */
  buscar(reiniciar = false): void {
    // Sin caja abierta no hay turno del que traer pedidos.
    if (!this.caja) return;
    // «Cargar más» no se apila; una búsqueda nueva SÍ reemplaza a la que estuviera en vuelo —si
    // no, lo escrito mientras carga se perdería y quedaría en pantalla el resultado viejo.
    if (!reiniciar && this.cargando()) return;
    this.peticion?.unsubscribe();

    const offset = reiniciar ? 0 : this.filas().length;
    this.cargando.set(true);

    this.peticion = this.cajaSvc.getSeguimiento(this.idNegocio, {
      idCaja: this.caja.id_caja,
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
