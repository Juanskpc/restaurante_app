import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { environment } from '../../../../environments/environment';

interface InventarioKpis {
  total_insumos: number;
  stock_bajo: number;
  agotados: number;
}

interface InventarioInsumo {
  id_ingrediente: number;
  nombre: string;
  categoria: string;
  unidad_medida: string;
  stock_actual: number;
  stock_minimo: number;
  stock_maximo: number;
  porcentaje_stock: number;
  status: 'ok' | 'bajo' | 'agotado';
}

interface RecetaItem {
  id_ingrediente: number;
  nombre: string;
  porcion: number;
  unidad_medida: string;
  stock_actual: number;
  alcanza_para: number | null;
}

interface InventarioProducto {
  id_producto: number;
  nombre: string;
  icono: string;
  precio: number;
  disponible: boolean;
  receta: RecetaItem[];
}

interface InventarioResumen {
  kpis: InventarioKpis;
  insumos: InventarioInsumo[];
  productos: InventarioProducto[];
}

type InventarioStockFilter = 'all' | 'agotado' | 'normal';

@Component({
  selector: 'app-inventario',
  imports: [LucideAngularModule, FormsModule],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly uiFeedback = inject(UiFeedbackService);

  readonly cargando = signal(false);
  readonly guardando = signal<number | null>(null);
  readonly error = signal('');

  readonly kpis = signal<InventarioKpis>({
    total_insumos: 0,
    stock_bajo: 0,
    agotados: 0,
  });

  readonly insumos = signal<InventarioInsumo[]>([]);
  readonly productos = signal<InventarioProducto[]>([]);

  readonly searchTerm = signal('');
  readonly stockFilter = signal<InventarioStockFilter>('all');
  readonly productoActivoId = signal<number | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = signal(15);
  readonly cantidadesAjuste = signal<Record<number, number>>({});

  readonly nuevoInsumoNombre = signal('');
  readonly nuevaUnidadInsumo = signal('g');
  readonly creandoInsumo = signal(false);

  readonly unidades = ['g', 'kg', 'ml', 'l', 'und', 'oz', 'taza', 'cdta', 'cda'];

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly canAgregarInsumo = computed(() => this.auth.canAccessSubnivel('inventario_agregar_insumo'));
  readonly canAjusteRapido = computed(() => this.auth.canAccessSubnivel('inventario_ajuste_rapido'));
  readonly canGestionarInsumo = computed(() => this.auth.canAccessSubnivel('inventario_gestionar_insumo'));
  readonly tableColspan = computed(() => {
    let base = 5;
    if (this.canAjusteRapido()) base += 1;
    if (this.canGestionarInsumo()) base += 1;
    return base;
  });

  // Edit modal state
  readonly editandoInsumo = signal<InventarioInsumo | null>(null);
  readonly editNombre = signal('');
  readonly editUnidad = signal('g');
  readonly guardandoEdicion = signal(false);
  private readonly moneyFormatter = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  });

  readonly insumosFiltrados = computed(() => {
    let list = this.insumos();
    const stockFilter = this.stockFilter();

    if (stockFilter === 'agotado') {
      list = list.filter((i) => i.status === 'agotado');
    } else if (stockFilter === 'normal') {
      list = list.filter((i) => i.status === 'ok');
    }

    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return list;

    return list.filter((i) =>
      i.nombre.toLowerCase().includes(term) ||
      i.categoria.toLowerCase().includes(term)
    );
  });

  readonly totalPaginas = computed(() => {
    const total = this.insumosFiltrados().length;
    return Math.max(1, Math.ceil(total / this.pageSize()));
  });

  readonly insumosPaginados = computed(() => {
    const page = this.currentPage();
    const size = this.pageSize();
    const start = (page - 1) * size;
    return this.insumosFiltrados().slice(start, start + size);
  });

  readonly inicioPagina = computed(() => {
    if (this.insumosFiltrados().length === 0) return 0;
    return (this.currentPage() - 1) * this.pageSize() + 1;
  });

  readonly finPagina = computed(() => {
    const total = this.insumosFiltrados().length;
    return Math.min(this.currentPage() * this.pageSize(), total);
  });

  readonly productoActivo = computed(() => {
    const activeId = this.productoActivoId();
    if (!activeId) return this.productos()[0] ?? null;
    return this.productos().find((p) => p.id_producto === activeId) ?? this.productos()[0] ?? null;
  });

  private readonly negocioEffect = effect(() => {
    const id = this.negocioId();
    if (id) this.loadInventario(id);
  });

  private readonly paginationClampEffect = effect(() => {
    const total = this.totalPaginas();
    const page = this.currentPage();

    if (page > total) {
      this.currentPage.set(total);
      return;
    }

    if (page < 1) {
      this.currentPage.set(1);
    }
  });

  private loadInventario(idNegocio: number): void {
    this.cargando.set(true);
    this.error.set('');

    this.http.get<{ success: boolean; data: InventarioResumen }>(
      `${environment.apiUrl}/inventario/resumen?id_negocio=${idNegocio}`
    ).subscribe({
      next: (res) => {
        const data = res?.data;
        this.kpis.set(data?.kpis ?? { total_insumos: 0, stock_bajo: 0, agotados: 0 });
        this.insumos.set(data?.insumos ?? []);
        this.productos.set(data?.productos ?? []);
        if (!this.productoActivoId() && (data?.productos?.length ?? 0) > 0) {
          this.productoActivoId.set(data!.productos[0].id_producto);
        }
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar el inventario.');
        this.cargando.set(false);
      },
    });
  }

  selectProducto(idProducto: number): void {
    this.productoActivoId.set(idProducto);
  }

  setStockFilter(filter: InventarioStockFilter): void {
    this.stockFilter.update((current) => current === filter ? 'all' : filter);
    this.currentPage.set(1);
  }

  setPageSize(value: number): void {
    const next = Number.isFinite(value) ? Math.max(5, Math.floor(value)) : 15;
    this.pageSize.set(next);
    this.currentPage.set(1);
  }

  prevPage(): void {
    if (this.currentPage() <= 1) return;
    this.currentPage.update((page) => page - 1);
  }

  nextPage(): void {
    if (this.currentPage() >= this.totalPaginas()) return;
    this.currentPage.update((page) => page + 1);
  }

  getCantidadAjuste(idIngrediente: number): number {
    return this.cantidadesAjuste()[idIngrediente] ?? 1;
  }

  setCantidadAjuste(idIngrediente: number, value: number | null): void {
    const cantidad = Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : 1;
    this.cantidadesAjuste.update((mapa) => ({
      ...mapa,
      [idIngrediente]: cantidad,
    }));
  }

  ajustarStock(insumo: InventarioInsumo, direction: 1 | -1): void {
    if (!this.canAjusteRapido()) return;

    const idNegocio = this.negocioId();
    if (!idNegocio || this.guardando()) return;

    const cantidad = this.getCantidadAjuste(insumo.id_ingrediente);
    const delta = direction * cantidad;

    this.guardando.set(insumo.id_ingrediente);
    this.http.patch(
      `${environment.apiUrl}/inventario/ingredientes/${insumo.id_ingrediente}/ajuste`,
      {
        id_negocio: idNegocio,
        delta,
      }
    ).subscribe({
      next: () => {
        this.guardando.set(null);
        this.uiFeedback.updated('El stock fue ajustado correctamente.');
        this.loadInventario(idNegocio);
      },
      error: () => {
        this.guardando.set(null);
        this.uiFeedback.error('No fue posible ajustar el stock del insumo.');
      },
    });
  }

  abrirEditarInsumo(insumo: InventarioInsumo): void {
    if (!this.canGestionarInsumo()) return;
    this.editandoInsumo.set(insumo);
    this.editNombre.set(insumo.nombre);
    this.editUnidad.set(insumo.unidad_medida || 'g');
  }

  cerrarEditarInsumo(): void {
    if (this.guardandoEdicion()) return;
    this.editandoInsumo.set(null);
  }

  guardarEdicionInsumo(): void {
    if (!this.canGestionarInsumo()) return;
    const insumo = this.editandoInsumo();
    const idNegocio = this.negocioId();
    if (!insumo || !idNegocio) return;

    const nombre = this.editNombre().trim();
    const unidad = this.editUnidad().trim();
    if (!nombre) {
      this.uiFeedback.error('El nombre es obligatorio.');
      return;
    }

    this.guardandoEdicion.set(true);
    this.http.put(
      `${environment.apiUrl}/carta/admin/ingredientes/${insumo.id_ingrediente}`,
      { nombre, unidad_medida: unidad }
    ).subscribe({
      next: () => {
        this.guardandoEdicion.set(false);
        this.editandoInsumo.set(null);
        this.uiFeedback.updated('El insumo fue actualizado correctamente.');
        this.loadInventario(idNegocio);
      },
      error: (err: HttpErrorResponse) => {
        this.guardandoEdicion.set(false);
        const msg = this.getHttpErrorMessage(err) || 'No se pudo actualizar el insumo.';
        this.uiFeedback.error(msg);
      },
    });
  }

  async eliminarInsumo(insumo: InventarioInsumo): Promise<void> {
    if (!this.canGestionarInsumo()) return;
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    const confirmado = await this.uiFeedback.confirm({
      title: 'Eliminar insumo',
      message: `Se eliminará "${insumo.nombre}". Las recetas que lo usen dejarán de consumirlo. ¿Deseas continuar?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmado) return;

    this.http.delete(
      `${environment.apiUrl}/carta/admin/ingredientes/${insumo.id_ingrediente}`
    ).subscribe({
      next: () => {
        this.uiFeedback.deleted('El insumo fue eliminado correctamente.');
        this.loadInventario(idNegocio);
      },
      error: (err: HttpErrorResponse) => {
        const msg = this.getHttpErrorMessage(err) || 'No se pudo eliminar el insumo.';
        this.uiFeedback.error(msg);
      },
    });
  }

  crearInsumo(): void {
    if (!this.canAgregarInsumo()) return;

    const idNegocio = this.negocioId();
    const nombre = this.nuevoInsumoNombre().trim();
    if (!idNegocio || !nombre || this.creandoInsumo()) return;

    this.creandoInsumo.set(true);

    this.http.post(
      `${environment.apiUrl}/carta/admin/ingredientes`,
      {
        id_negocio: idNegocio,
        nombre,
        unidad_medida: this.nuevaUnidadInsumo(),
      }
    ).subscribe({
      next: () => {
        this.creandoInsumo.set(false);
        this.nuevoInsumoNombre.set('');
        this.uiFeedback.created('El insumo fue creado correctamente.');
        this.loadInventario(idNegocio);
      },
      error: (err: HttpErrorResponse) => {
        this.creandoInsumo.set(false);
        const message = this.getHttpErrorMessage(err) || 'No se pudo crear el insumo.';
        this.uiFeedback.error(message);
      },
    });
  }

  private getHttpErrorMessage(err: HttpErrorResponse): string {
    const message = err?.error?.message;
    if (typeof message === 'string') {
      return message.trim();
    }
    return '';
  }

  statusLabel(status: InventarioInsumo['status']): string {
    if (status === 'agotado') return 'Agotado';
    if (status === 'bajo') return 'Stock bajo';
    return 'Normal';
  }

  statusClass(status: InventarioInsumo['status']): string {
    if (status === 'agotado') return 'status-crit';
    if (status === 'bajo') return 'status-warn';
    return 'status-ok';
  }

  formatMoney(value: number): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return '$ 0';
    }
    return `$ ${this.moneyFormatter.format(numericValue)}`;
  }

  trackInsumo(_: number, insumo: InventarioInsumo): number {
    return insumo.id_ingrediente;
  }

  trackProducto(_: number, producto: InventarioProducto): number {
    return producto.id_producto;
  }
}
