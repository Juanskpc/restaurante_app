import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
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

@Component({
  selector: 'app-inventario',
  imports: [LucideAngularModule, FormsModule, CurrencyPipe],
  templateUrl: './inventario.html',
  styleUrl: './inventario.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventarioComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

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
  readonly productoActivoId = signal<number | null>(null);
  readonly currentPage = signal(1);
  readonly pageSize = signal(15);
  readonly cantidadesAjuste = signal<Record<number, number>>({});

  readonly nuevoInsumoNombre = signal('');
  readonly nuevaUnidadInsumo = signal('g');
  readonly creandoInsumo = signal(false);

  readonly unidades = ['g', 'kg', 'ml', 'l', 'und', 'oz', 'taza', 'cdta', 'cda'];

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly insumosFiltrados = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.insumos();

    return this.insumos().filter((i) =>
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
        this.loadInventario(idNegocio);
      },
      error: () => {
        this.guardando.set(null);
      },
    });
  }

  crearInsumo(): void {
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
        this.loadInventario(idNegocio);
      },
      error: () => {
        this.creandoInsumo.set(false);
      },
    });
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

  trackInsumo(_: number, insumo: InventarioInsumo): number {
    return insumo.id_ingrediente;
  }

  trackProducto(_: number, producto: InventarioProducto): number {
    return producto.id_producto;
  }
}
