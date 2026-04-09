import {
  Component, inject, signal, computed, effect,
  ChangeDetectionStrategy, OnInit, OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe } from '@angular/common';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

// ============================================================
// Interfaces
// ============================================================

export interface CategoriaAdmin {
  id_categoria: number;
  nombre: string;
  descripcion: string;
  icono: string;
  orden: number;
  total_productos: number;
}

export interface IngredienteBase {
  id_ingrediente: number;
  nombre: string;
  unidad_medida?: string;
}

export interface ProductoIngrediente {
  id_producto_ingred?: number;
  id_ingrediente: number;
  nombre: string;
  porcion: number;
  unidad_medida: string;
  es_removible: boolean;
}

export interface ProductoAdmin {
  id_producto: number;
  id_categoria: number;
  nombre: string;
  descripcion: string;
  precio: number;
  imagen_url: string;
  icono: string;
  es_popular: boolean;
  disponible: boolean;
  ingredientes: ProductoIngrediente[];
}

type FiltroDisponibilidad = 'todos' | 'disponibles' | 'no_disponibles';

interface CatFormData {
  nombre: string;
  descripcion: string;
  icono: string;
  orden: number;
}

export interface IngredienteForm {
  id_producto_ingred?: number;
  id_ingrediente: number | null;
  nombre: string;
  porcion: number | null;
  unidad_medida: string;
  es_removible: boolean;
}

interface ProdFormData {
  nombre: string;
  descripcion: string;
  precio: number | null;
  icono: string;
  imagen_url: string;
  es_popular: boolean;
  disponible: boolean;
  id_categoria: number | null;
  ingredientes: IngredienteForm[];
}

// ============================================================
// Component
// ============================================================

@Component({
  selector: 'app-menu',
  imports: [LucideAngularModule, FormsModule, CurrencyPipe],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  // ── Data ──────────────────────────────────────────────────
  readonly categorias       = signal<CategoriaAdmin[]>([]);
  readonly productos         = signal<ProductoAdmin[]>([]);
  readonly ingredientesBase  = signal<IngredienteBase[]>([]);

  // ── UI State ──────────────────────────────────────────────
  readonly categoriaActiva  = signal<number | null>(null);
  readonly searchTerm        = signal('');
  readonly filtro            = signal<FiltroDisponibilidad>('todos');
  readonly cargando          = signal(false);
  readonly guardando         = signal(false);

  // ── Modal: Categoría ──────────────────────────────────────
  readonly modalCatOpen     = signal(false);
  readonly editandoCatId    = signal<number | null>(null);
  readonly catForm          = signal<CatFormData>({ nombre: '', descripcion: '', icono: '🍽️', orden: 0 });

  // ── Modal: Producto ───────────────────────────────────────
  readonly modalProdOpen    = signal(false);
  readonly editandoProdId   = signal<number | null>(null);
  readonly prodForm         = signal<ProdFormData>({
    nombre: '', descripcion: '', precio: null, icono: '🍔',
    imagen_url: '', es_popular: false, disponible: true,
    id_categoria: null, ingredientes: [],
  });

  // ── Nuevo ingrediente base (inline creation) ──────────────
  readonly nuevoIngredNombre = signal('');
  readonly nuevaUnidadIngred = signal('g');
  readonly creandoIngred     = signal(false);

  // ── Computed ──────────────────────────────────────────────
  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly productosFiltrados = computed(() => {
    let list = this.productos();
    const f = this.filtro();
    if (f === 'disponibles')    list = list.filter(p => p.disponible);
    if (f === 'no_disponibles') list = list.filter(p => !p.disponible);
    return list;
  });

  readonly categoriaNombreActivo = computed(() => {
    const id = this.categoriaActiva();
    if (!id) return 'Todos los Productos';
    return this.categorias().find(c => c.id_categoria === id)?.nombre ?? '';
  });

  readonly unidades = ['g', 'kg', 'ml', 'l', 'und', 'oz', 'taza', 'cdta', 'cda'];

  // ── Debounce search ───────────────────────────────────────
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly searchEffect = effect(() => {
    const term = this.searchTerm();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.ejecutarBusqueda(term.trim()), 300);
  });

  // ============================================================
  // Lifecycle
  // ============================================================

  ngOnInit(): void {
    this.loadCategorias();
    this.loadIngredientesBase();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ============================================================
  // Carga de datos
  // ============================================================

  loadCategorias(): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);
    this.http.get<{ success: boolean; data: CategoriaAdmin[] }>(
      `${environment.apiUrl}/carta/admin/categorias?id_negocio=${id}`
    ).subscribe({
      next: res => {
        this.categorias.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  loadIngredientesBase(): void {
    const id = this.negocioId();
    if (!id) return;
    this.http.get<{ success: boolean; data: IngredienteBase[] }>(
      `${environment.apiUrl}/carta/ingredientes?id_negocio=${id}`
    ).subscribe({
      next: res => this.ingredientesBase.set(res?.data ?? []),
    });
  }

  selectCategoria(id: number): void {
    this.categoriaActiva.set(id);
    this.searchTerm.set('');
    this.loadProductos(id);
  }

  showTodos(): void {
    this.categoriaActiva.set(null);
    this.searchTerm.set('');
    this.loadProductosAdmin();
  }

  private loadProductos(idCategoria: number): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);
    this.http.get<{ success: boolean; data: ProductoAdmin[] }>(
      `${environment.apiUrl}/carta/admin/productos?id_negocio=${id}&id_categoria=${idCategoria}`
    ).subscribe({
      next: res => { this.productos.set(res?.data ?? []); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  private loadProductosAdmin(): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);
    this.http.get<{ success: boolean; data: ProductoAdmin[] }>(
      `${environment.apiUrl}/carta/admin/productos?id_negocio=${id}`
    ).subscribe({
      next: res => { this.productos.set(res?.data ?? []); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  private recargarVista(): void {
    const cat = this.categoriaActiva();
    if (cat) this.loadProductos(cat);
    else this.loadProductosAdmin();
    this.loadCategorias();
  }

  private ejecutarBusqueda(term: string): void {
    if (!term) { this.recargarVista(); return; }
    const id = this.negocioId();
    if (!id) return;
    this.cargando.set(true);
    this.http.get<{ success: boolean; data: ProductoAdmin[] }>(
      `${environment.apiUrl}/carta/buscar?id_negocio=${id}&q=${encodeURIComponent(term)}`
    ).subscribe({
      next: res => { this.productos.set(res?.data ?? []); this.cargando.set(false); },
      error: () => this.cargando.set(false),
    });
  }

  // ============================================================
  // Helpers form update (signal-safe con OnPush)
  // ============================================================

  updateCatField<K extends keyof CatFormData>(field: K, value: CatFormData[K]): void {
    this.catForm.update(f => ({ ...f, [field]: value }));
  }

  updateProdField<K extends keyof ProdFormData>(field: K, value: ProdFormData[K]): void {
    this.prodForm.update(f => ({ ...f, [field]: value }));
  }

  // ── Ingredientes dentro del form ──────────────────────────

  agregarIngredienteForm(): void {
    this.prodForm.update(f => ({
      ...f,
      ingredientes: [
        ...f.ingredientes,
        { id_ingrediente: null, nombre: '', porcion: null, unidad_medida: 'g', es_removible: true },
      ],
    }));
  }

  eliminarIngredienteForm(index: number): void {
    this.prodForm.update(f => ({
      ...f,
      ingredientes: f.ingredientes.filter((_, i) => i !== index),
    }));
  }

  actualizarIngredienteField(index: number, campo: keyof IngredienteForm, valor: unknown): void {
    this.prodForm.update(f => {
      const ingredientes = f.ingredientes.map((ing, i) => {
        if (i !== index) return ing;
        const updated = { ...ing, [campo]: valor };
        if (campo === 'id_ingrediente') {
          const base = this.ingredientesBase().find(b => b.id_ingrediente === Number(valor));
          updated['nombre'] = base?.nombre ?? '';
        }
        return updated;
      });
      return { ...f, ingredientes };
    });
  }

  // ── Crear ingrediente base nuevo desde el modal ───────────

  crearIngredienteBase(): void {
    const nombre = this.nuevoIngredNombre().trim();
    const id     = this.negocioId();
    if (!nombre || !id) return;
    this.creandoIngred.set(true);
    this.http.post<{ success: boolean; data: IngredienteBase }>(
      `${environment.apiUrl}/carta/admin/ingredientes`,
      {
        id_negocio: id,
        nombre,
        unidad_medida: this.nuevaUnidadIngred(),
      }
    ).subscribe({
      next: res => {
        const nuevo = res?.data;
        if (nuevo) {
          this.ingredientesBase.update(list => [...list, nuevo]);
        }
        this.nuevoIngredNombre.set('');
        this.creandoIngred.set(false);
      },
      error: () => this.creandoIngred.set(false),
    });
  }

  // ============================================================
  // Modal Categoría — CRUD
  // ============================================================

  abrirModalCat(cat?: CategoriaAdmin): void {
    if (cat) {
      this.editandoCatId.set(cat.id_categoria);
      this.catForm.set({ nombre: cat.nombre, descripcion: cat.descripcion ?? '', icono: cat.icono ?? '🍽️', orden: cat.orden ?? 0 });
    } else {
      this.editandoCatId.set(null);
      this.catForm.set({ nombre: '', descripcion: '', icono: '🍽️', orden: 0 });
    }
    this.modalCatOpen.set(true);
  }

  cerrarModalCat(): void { this.modalCatOpen.set(false); }

  guardarCategoria(): void {
    const id   = this.negocioId();
    const form = this.catForm();
    if (!id || !form.nombre.trim()) return;

    this.guardando.set(true);
    const editId = this.editandoCatId();

    const req = editId
      ? this.http.put(`${environment.apiUrl}/carta/admin/categorias/${editId}`, form)
      : this.http.post(`${environment.apiUrl}/carta/admin/categorias`, { id_negocio: id, ...form });

    req.subscribe({
      next: () => { this.guardando.set(false); this.cerrarModalCat(); this.loadCategorias(); },
      error: () => this.guardando.set(false),
    });
  }

  eliminarCategoria(cat: CategoriaAdmin, event: Event): void {
    event.stopPropagation();
    if (!confirm(`¿Eliminar la categoría "${cat.nombre}"? Todos sus productos serán desactivados.`)) return;
    this.http.delete(`${environment.apiUrl}/carta/admin/categorias/${cat.id_categoria}`)
      .subscribe({
        next: () => {
          if (this.categoriaActiva() === cat.id_categoria) {
            this.categoriaActiva.set(null);
            this.productos.set([]);
          }
          this.loadCategorias();
        },
      });
  }

  // ============================================================
  // Modal Producto — CRUD
  // ============================================================

  abrirModalProd(prod?: ProductoAdmin): void {
    if (prod) {
      this.editandoProdId.set(prod.id_producto);
      this.prodForm.set({
        nombre:       prod.nombre,
        descripcion:  prod.descripcion ?? '',
        precio:       prod.precio,
        icono:        prod.icono ?? '🍔',
        imagen_url:   prod.imagen_url ?? '',
        es_popular:   prod.es_popular,
        disponible:   prod.disponible,
        id_categoria: prod.id_categoria,
        ingredientes: prod.ingredientes.map(pi => ({
          id_producto_ingred: pi.id_producto_ingred,
          id_ingrediente:     pi.id_ingrediente,
          nombre:             pi.nombre,
          porcion:            pi.porcion,
          unidad_medida:      pi.unidad_medida ?? 'g',
          es_removible:       pi.es_removible,
        })),
      });
    } else {
      this.editandoProdId.set(null);
      this.prodForm.set({
        nombre: '', descripcion: '', precio: null, icono: '🍔',
        imagen_url: '', es_popular: false, disponible: true,
        id_categoria: this.categoriaActiva(), ingredientes: [],
      });
    }
    this.modalProdOpen.set(true);
  }

  cerrarModalProd(): void { this.modalProdOpen.set(false); }

  guardarProducto(): void {
    const id   = this.negocioId();
    const form = this.prodForm();
    if (!id || !form.nombre.trim() || !form.precio || !form.id_categoria) return;

    this.guardando.set(true);
    const editId = this.editandoProdId();
    const body = {
      id_negocio:   id,
      id_categoria: form.id_categoria,
      nombre:       form.nombre.trim(),
      descripcion:  form.descripcion,
      precio:       form.precio,
      icono:        form.icono,
      imagen_url:   form.imagen_url,
      es_popular:   form.es_popular,
      disponible:   form.disponible,
      ingredientes: form.ingredientes
        .filter(i => i.id_ingrediente != null)
        .map(i => ({
          id_ingrediente: i.id_ingrediente,
          porcion:        i.porcion ?? 0,
          unidad_medida:  i.unidad_medida,
          es_removible:   i.es_removible,
        })),
    };

    const req = editId
      ? this.http.put(`${environment.apiUrl}/carta/admin/productos/${editId}`, body)
      : this.http.post(`${environment.apiUrl}/carta/admin/productos`, body);

    req.subscribe({
      next: () => { this.guardando.set(false); this.cerrarModalProd(); this.recargarVista(); },
      error: () => this.guardando.set(false),
    });
  }

  eliminarProducto(prod: ProductoAdmin): void {
    if (!confirm(`¿Eliminar el producto "${prod.nombre}"?`)) return;
    this.http.delete(`${environment.apiUrl}/carta/admin/productos/${prod.id_producto}`)
      .subscribe({ next: () => this.recargarVista() });
  }

  toggleDisponible(prod: ProductoAdmin): void {
    this.http.put(
      `${environment.apiUrl}/carta/admin/productos/${prod.id_producto}`,
      { disponible: !prod.disponible }
    ).subscribe({
      next: () => this.productos.update(list =>
        list.map(p => p.id_producto === prod.id_producto ? { ...p, disponible: !p.disponible } : p)
      ),
    });
  }

  // ============================================================
  // Helpers UI
  // ============================================================

  setFiltro(f: FiltroDisponibilidad): void { this.filtro.set(f); }

  getCatNombre(idCat: number): string {
    return this.categorias().find(c => c.id_categoria === idCat)?.nombre ?? '';
  }

  getCatIcono(idCat: number): string {
    return this.categorias().find(c => c.id_categoria === idCat)?.icono ?? '🍽️';
  }

  trackByCat(_: number, c: CategoriaAdmin): number { return c.id_categoria; }
  trackByProd(_: number, p: ProductoAdmin): number  { return p.id_producto;  }
  trackByIdx(i: number): number                      { return i;              }
}
