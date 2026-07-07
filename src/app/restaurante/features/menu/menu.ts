import {
  Component, inject, signal, computed, effect,
  ChangeDetectionStrategy, OnInit, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { environment } from '../../../../environments/environment';
import { ImageCropperComponent } from './image-cropper/image-cropper';

// ============================================================
// Interfaces
// ============================================================

export interface CategoriaAdmin {
  id_categoria: number;
  nombre: string;
  descripcion: string;
  icono: string;
  imagen_url: string | null;
  orden: number;
  visible: boolean;
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
  visible: boolean;
  ingredientes: ProductoIngrediente[];
}

type FiltroDisponibilidad = 'todos' | 'disponibles' | 'no_disponibles';

interface CatFormData {
  nombre: string;
  descripcion: string;
  icono: string;
  imagen_url: string;
  orden: number;
  visible: boolean;
}

export interface IngredienteForm {
  id_producto_ingred?: number;
  id_ingrediente: number | null;
  nombre: string;
  porcion: number | null;
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
  visible: boolean;
  id_categoria: number | null;
  ingredientes: IngredienteForm[];
}

function normalizeSearchValue(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ============================================================
// Component
// ============================================================

@Component({
  selector: 'app-menu',
  imports: [LucideAngularModule, FormsModule, ImageCropperComponent],
  templateUrl: './menu.html',
  styleUrl: './menu.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly uiFeedback = inject(UiFeedbackService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

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
  readonly catForm          = signal<CatFormData>({ nombre: '', descripcion: '', icono: '🍽️', imagen_url: '', orden: 0, visible: true });

  // ── Modal: Producto ───────────────────────────────────────
  readonly modalProdOpen    = signal(false);
  readonly editandoProdId   = signal<number | null>(null);
  readonly ingredientesModificados = signal(false);
  readonly prodForm         = signal<ProdFormData>({
    nombre: '', descripcion: '', precio: null, icono: '🍔',
    imagen_url: '', es_popular: false, disponible: true,
    visible: true, id_categoria: null, ingredientes: [],
  });

  // ── Imágenes pendientes (opcional, conviven con los íconos) ─
  // Se guardan en memoria tras recortar y se suben al guardar, ya que el
  // archivo se nombra con el ID de la entidad (que un producto nuevo aún no tiene).
  private readonly prodImagenBlob = signal<Blob | null>(null);
  private readonly catImagenBlob  = signal<Blob | null>(null);
  readonly prodImagenPreview = signal('');
  readonly catImagenPreview  = signal('');

  readonly prodPreviewSrc = computed(() =>
    this.prodImagenPreview() || this.resolveImg(this.prodForm().imagen_url));
  readonly catPreviewSrc = computed(() =>
    this.catImagenPreview() || this.resolveImg(this.catForm().imagen_url));

  // ── Cropper (encuadre + compresión WebP antes de subir) ───
  readonly cropperOpen        = signal(false);
  readonly cropperFile        = signal<File | null>(null);
  readonly cropperAspect      = signal(1);
  readonly cropperOutputWidth = signal(512);
  readonly cropperTitulo      = signal('Ajustar imagen');
  private readonly cropperTarget = signal<'prod' | 'cat'>('prod');

  /** Origen del API sin el prefijo /restaurante, para resolver rutas /uploads. */
  private readonly apiOrigin = environment.apiUrl.replace(/\/restaurante\/?$/, '');

  // ── Nuevo ingrediente base (inline creation) ──────────────
  readonly nuevoIngredNombre = signal('');
  readonly nuevaUnidadIngred = signal('g');
  readonly creandoIngred     = signal(false);

  // ── Copiar receta desde otro producto ────────────────────
  readonly copiarRecetaOpen    = signal(false);
  readonly copiarDesdeId       = signal<number | null>(null);
  readonly factorEscala        = signal<number>(1);
  readonly productosParaCopiar = signal<ProductoAdmin[]>([]);
  readonly cargandoParaCopiar  = signal(false);
  readonly factoresPreset      = [0.5, 0.75, 1, 1.5, 2];

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

  readonly productoOrigenSeleccionado = computed(() => {
    const id = this.copiarDesdeId();
    if (!id) return null;
    return this.productosParaCopiar().find(p => p.id_producto === id) ?? null;
  });

  private readonly priceFormatter = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
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

  abrirMenuDigital(): void {
    const id = this.negocioId();
    if (!id || !this.isBrowser) return;
    const baseUrl = (environment.menuPublicoUrl || '').replace(/\/$/, '');
    window.open(`${baseUrl}/carta/${id}`, '_blank', 'noopener');
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
      `${environment.apiUrl}/carta/buscar?id_negocio=${id}&include_disabled=1&q=${encodeURIComponent(term)}`
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
        { id_ingrediente: null, nombre: '', porcion: null, es_removible: true },
      ],
    }));
    this.ingredientesModificados.set(true);
  }

  eliminarIngredienteForm(index: number): void {
    this.prodForm.update(f => ({
      ...f,
      ingredientes: f.ingredientes.filter((_, i) => i !== index),
    }));
    this.ingredientesModificados.set(true);
  }

  actualizarIngredienteField(index: number, campo: keyof IngredienteForm, valor: unknown): void {
    this.prodForm.update(f => {
      const ingredientes = f.ingredientes.map((ing, i) => {
        if (i !== index) return ing;
        return { ...ing, [campo]: valor };
      });
      return { ...f, ingredientes };
    });
    this.ingredientesModificados.set(true);
  }

  actualizarIngredienteSeleccion(index: number, nombreIngresado: string): void {
    const nombreNormalizado = normalizeSearchValue(nombreIngresado);
    const ingredienteBase = nombreNormalizado
      ? this.ingredientesBase().find(base => normalizeSearchValue(base.nombre) === nombreNormalizado)
      : null;

    this.prodForm.update(f => {
      const ingredientes = f.ingredientes.map((ing, i) => {
        if (i !== index) return ing;
        if (!nombreNormalizado) return { ...ing, id_ingrediente: null, nombre: '' };
        if (ingredienteBase) {
          return {
            ...ing,
            id_ingrediente: ingredienteBase.id_ingrediente,
            nombre: ingredienteBase.nombre,
          };
        }
        return { ...ing, id_ingrediente: null, nombre: nombreIngresado };
      });
      return { ...f, ingredientes };
    });
    this.ingredientesModificados.set(true);
  }

  mostrarOpcionesIngrediente(event: FocusEvent): void {
    const input = event.target as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.showPicker?.();
  }

  // ── Copiar receta desde otro producto ─────────────────────

  abrirPanelCopiar(): void {
    if (this.productosParaCopiar().length === 0 && !this.cargandoParaCopiar()) {
      this.cargarProductosParaCopiar();
    }
    this.copiarRecetaOpen.set(true);
  }

  cerrarPanelCopiar(): void {
    this.copiarRecetaOpen.set(false);
    this.copiarDesdeId.set(null);
    this.factorEscala.set(1);
  }

  aplicarRecetaBase(): void {
    const origen = this.productoOrigenSeleccionado();
    if (!origen?.ingredientes.length) return;

    const factor = this.factorEscala() || 1;
    const ingredientes: IngredienteForm[] = origen.ingredientes.map(pi => ({
      id_producto_ingred: undefined,
      id_ingrediente:     pi.id_ingrediente,
      nombre:             pi.nombre
                          || this.ingredientesBase().find(b => b.id_ingrediente === pi.id_ingrediente)?.nombre
                          || '',
      porcion:            pi.porcion > 0
                          ? Math.round(pi.porcion * factor * 1000) / 1000
                          : null,
      es_removible:       pi.es_removible,
    }));

    this.prodForm.update(f => ({ ...f, ingredientes }));
    this.ingredientesModificados.set(true);
    this.cerrarPanelCopiar();
  }

  private cargarProductosParaCopiar(): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargandoParaCopiar.set(true);
    this.http.get<{ success: boolean; data: ProductoAdmin[] }>(
      `${environment.apiUrl}/carta/admin/productos?id_negocio=${id}`
    ).subscribe({
      next: res => {
        this.productosParaCopiar.set(
          (res?.data ?? []).filter(p => p.ingredientes.length > 0)
        );
        this.cargandoParaCopiar.set(false);
      },
      error: () => this.cargandoParaCopiar.set(false),
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
        this.uiFeedback.created('El insumo base fue creado correctamente.');
      },
      error: (err: HttpErrorResponse) => {
        this.creandoIngred.set(false);
        const message = this.getHttpErrorMessage(err) || 'No se pudo crear el insumo.';
        this.uiFeedback.error(message);
      },
    });
  }

  // ============================================================
  // Modal Categoría — CRUD
  // ============================================================

  abrirModalCat(cat?: CategoriaAdmin): void {
    this.limpiarImagenCatPend();
    if (cat) {
      this.editandoCatId.set(cat.id_categoria);
      this.catForm.set({
        nombre: cat.nombre,
        descripcion: cat.descripcion ?? '',
        icono: cat.icono ?? '🍽️',
        imagen_url: cat.imagen_url ?? '',
        orden: cat.orden ?? 0,
        visible: cat.visible !== false,
      });
    } else {
      this.editandoCatId.set(null);
      this.catForm.set({ nombre: '', descripcion: '', icono: '🍽️', imagen_url: '', orden: 0, visible: true });
    }
    this.modalCatOpen.set(true);
  }

  cerrarModalCat(): void {
    this.modalCatOpen.set(false);
    this.limpiarImagenCatPend();
  }

  async guardarCategoria(): Promise<void> {
    const id   = this.negocioId();
    const form = this.catForm();
    if (!id || !form.nombre.trim()) return;

    this.guardando.set(true);
    const editId = this.editandoCatId();
    const blob = this.catImagenBlob();
    const base = `${environment.apiUrl}/carta/admin/categorias`;

    try {
      if (editId) {
        // Sube la imagen (si hay una nueva) nombrada con el ID, luego guarda.
        const imagen_url = blob ? await this.uploadImagen('categoria', editId, blob) : form.imagen_url;
        await firstValueFrom(this.http.put(`${base}/${editId}`, { ...form, imagen_url }));
      } else {
        // Crea primero para obtener el ID, luego sube la imagen con ese nombre.
        const res = await firstValueFrom(
          this.http.post<{ data: { id_categoria: number } }>(base, { id_negocio: id, ...form, imagen_url: form.imagen_url || '' }),
        );
        const newId = res?.data?.id_categoria;
        if (blob && newId) {
          const imagen_url = await this.uploadImagen('categoria', newId, blob);
          await firstValueFrom(this.http.put(`${base}/${newId}`, { imagen_url }));
        }
      }

      this.guardando.set(false);
      this.cerrarModalCat();
      if (editId) {
        this.uiFeedback.updated('Los datos de la categoria fueron actualizados.');
      } else {
        this.uiFeedback.created('La categoria fue creada correctamente.');
      }
      this.loadCategorias();
    } catch {
      this.guardando.set(false);
      this.uiFeedback.error('No fue posible guardar la categoria.');
    }
  }

  async eliminarCategoria(cat: CategoriaAdmin, event: Event): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.uiFeedback.confirm({
      title: 'Eliminar categoria',
      message: `¿Eliminar la categoria "${cat.nombre}"? Todos sus productos seran desactivados.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'error',
    });
    if (!confirmed) return;

    this.http.delete(`${environment.apiUrl}/carta/admin/categorias/${cat.id_categoria}`)
      .subscribe({
        next: () => {
          if (this.categoriaActiva() === cat.id_categoria) {
            this.categoriaActiva.set(null);
            this.productos.set([]);
          }
          this.uiFeedback.deleted('La categoria fue eliminada correctamente.');
          this.loadCategorias();
        },
        error: () => this.uiFeedback.error('No fue posible eliminar la categoria.'),
      });
  }

  // ============================================================
  // Modal Producto — CRUD
  // ============================================================

  abrirModalProd(prod?: ProductoAdmin): void {
    this.limpiarImagenProdPend();
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
        visible:      prod.visible !== false,
        id_categoria: prod.id_categoria,
        ingredientes: prod.ingredientes.map(pi => ({
          id_producto_ingred: pi.id_producto_ingred,
          id_ingrediente:     pi.id_ingrediente,
          nombre:             pi.nombre || this.ingredientesBase().find(base => base.id_ingrediente === pi.id_ingrediente)?.nombre || '',
          porcion:            pi.porcion,
          es_removible:       pi.es_removible,
        })),
      });
      this.ingredientesModificados.set(false);
    } else {
      this.editandoProdId.set(null);
      this.prodForm.set({
        nombre: '', descripcion: '', precio: null, icono: '🍔',
        imagen_url: '', es_popular: false, disponible: true,
        visible: true, id_categoria: this.categoriaActiva(), ingredientes: [],
      });
      this.ingredientesModificados.set(false);
    }
    this.modalProdOpen.set(true);
  }

  cerrarModalProd(): void {
    this.modalProdOpen.set(false);
    this.cerrarPanelCopiar();
    this.limpiarImagenProdPend();
  }

  async guardarProducto(): Promise<void> {
    const id   = this.negocioId();
    const form = this.prodForm();
    if (!id || !form.nombre.trim() || !form.precio || !form.id_categoria) return;

    const ingredientesInvalidos = form.ingredientes.filter(i => i.nombre.trim() && i.id_ingrediente == null);
    if (ingredientesInvalidos.length > 0) {
      void this.uiFeedback.alert({
        title: 'Ingredientes invalidos',
        message: 'Selecciona un ingrediente valido de la lista para cada fila.',
        tone: 'warning',
      });
      return;
    }

    this.guardando.set(true);
    const editId = this.editandoProdId();
    const blob = this.prodImagenBlob();
    const base = `${environment.apiUrl}/carta/admin/productos`;
    const ingredientesPayload = form.ingredientes
      .filter(i => i.id_ingrediente != null)
      .map(i => ({
        id_ingrediente: Number(i.id_ingrediente),
        porcion:        i.porcion ?? 0,
        es_removible:   i.es_removible,
      }));

    const baseBody = {
      id_negocio:   id,
      id_categoria: form.id_categoria,
      nombre:       form.nombre.trim(),
      descripcion:  form.descripcion,
      precio:       form.precio,
      icono:        form.icono,
      es_popular:   form.es_popular,
      disponible:   form.disponible,
      visible:      form.visible,
    };

    try {
      if (editId) {
        // Sube la imagen (si hay una nueva) nombrada con el ID, luego guarda.
        const imagen_url = blob ? await this.uploadImagen('producto', editId, blob) : form.imagen_url;
        const body = {
          ...baseBody,
          imagen_url,
          ...(this.ingredientesModificados() ? { ingredientes: ingredientesPayload } : {}),
        };
        await firstValueFrom(this.http.put(`${base}/${editId}`, body));
      } else {
        // Crea primero para obtener el ID, luego sube la imagen con ese nombre.
        const res = await firstValueFrom(
          this.http.post<{ data: { id_producto: number } }>(base, {
            ...baseBody,
            imagen_url: form.imagen_url || '',
            ingredientes: ingredientesPayload,
          }),
        );
        const newId = res?.data?.id_producto;
        if (blob && newId) {
          const imagen_url = await this.uploadImagen('producto', newId, blob);
          await firstValueFrom(this.http.put(`${base}/${newId}`, { imagen_url }));
        }
      }

      this.guardando.set(false);
      this.ingredientesModificados.set(false);
      this.cerrarModalProd();
      if (editId) {
        this.uiFeedback.updated('Los datos del producto fueron actualizados.');
      } else {
        this.uiFeedback.created('El producto fue creado correctamente.');
      }
      this.recargarVista();
    } catch {
      this.guardando.set(false);
      this.uiFeedback.error('No fue posible guardar el producto.');
    }
  }

  private getHttpErrorMessage(err: HttpErrorResponse): string {
    const message = err?.error?.message;
    if (typeof message === 'string') {
      return message.trim();
    }
    return '';
  }

  async eliminarProducto(prod: ProductoAdmin): Promise<void> {
    const confirmed = await this.uiFeedback.confirm({
      title: 'Eliminar producto',
      message: `¿Eliminar el producto "${prod.nombre}"?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'error',
    });
    if (!confirmed) return;

    this.http.delete(`${environment.apiUrl}/carta/admin/productos/${prod.id_producto}`)
      .subscribe({
        next: () => {
          this.uiFeedback.deleted('El producto fue eliminado correctamente.');
          this.recargarVista();
        },
        error: () => this.uiFeedback.error('No fue posible eliminar el producto.'),
      });
  }

  toggleDisponible(prod: ProductoAdmin): void {
    this.http.put(
      `${environment.apiUrl}/carta/admin/productos/${prod.id_producto}`,
      { disponible: !prod.disponible }
    ).subscribe({
      next: () => {
        this.productos.update(list =>
          list.map(p => p.id_producto === prod.id_producto ? { ...p, disponible: !p.disponible } : p)
        );
        this.uiFeedback.updated('La disponibilidad del producto fue actualizada.');
      },
      error: () => this.uiFeedback.error('No fue posible actualizar la disponibilidad del producto.'),
    });
  }

  // ============================================================
  // Helpers UI
  // ============================================================

  setFiltro(f: FiltroDisponibilidad): void { this.filtro.set(f); }

  // ── Imágenes de carta ─────────────────────────────────────

  /** Resuelve una imagen_url relativa (/uploads/...) contra el origen del API. */
  resolveImg(url: string | null | undefined): string {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return `${this.apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  onSelectImagenProd(event: Event): void {
    this.abrirCropper(event, 'prod');
  }

  onSelectImagenCat(event: Event): void {
    this.abrirCropper(event, 'cat');
  }

  quitarImagenProd(): void {
    this.revokePreview(this.prodImagenPreview());
    this.prodImagenPreview.set('');
    this.prodImagenBlob.set(null);
    this.updateProdField('imagen_url', '');
  }

  quitarImagenCat(): void {
    this.revokePreview(this.catImagenPreview());
    this.catImagenPreview.set('');
    this.catImagenBlob.set(null);
    this.updateCatField('imagen_url', '');
  }

  /** Valida el archivo elegido y abre el cropper con el aspecto de la tarjeta. */
  private abrirCropper(event: Event, target: 'prod' | 'cat'): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      this.uiFeedback.error('Selecciona un archivo de imagen (JPG, PNG o WEBP).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      this.uiFeedback.error('La imagen es demasiado grande (máx 25 MB).');
      return;
    }

    if (target === 'prod') {
      this.cropperAspect.set(4 / 3);
      this.cropperOutputWidth.set(640);
      this.cropperTitulo.set('Ajustar imagen del producto');
    } else {
      this.cropperAspect.set(1);
      this.cropperOutputWidth.set(256);
      this.cropperTitulo.set('Ajustar imagen de la categoría');
    }
    this.cropperTarget.set(target);
    this.cropperFile.set(file);
    this.cropperOpen.set(true);
  }

  cerrarCropper(): void {
    this.cropperOpen.set(false);
    this.cropperFile.set(null);
  }

  /** Guarda en memoria el recorte WebP; se sube al guardar (nombre = ID). */
  onImagenRecortada(blob: Blob): void {
    const target = this.cropperTarget();
    this.cerrarCropper();
    const preview = this.isBrowser ? URL.createObjectURL(blob) : '';
    if (target === 'prod') {
      this.revokePreview(this.prodImagenPreview());
      this.prodImagenBlob.set(blob);
      this.prodImagenPreview.set(preview);
    } else {
      this.revokePreview(this.catImagenPreview());
      this.catImagenBlob.set(blob);
      this.catImagenPreview.set(preview);
    }
  }

  private revokePreview(url: string): void {
    if (url && this.isBrowser) URL.revokeObjectURL(url);
  }

  private limpiarImagenProdPend(): void {
    this.revokePreview(this.prodImagenPreview());
    this.prodImagenPreview.set('');
    this.prodImagenBlob.set(null);
  }

  private limpiarImagenCatPend(): void {
    this.revokePreview(this.catImagenPreview());
    this.catImagenPreview.set('');
    this.catImagenBlob.set(null);
  }

  /** Sube el recorte comprimido; el backend lo nombra con el ID de la entidad. */
  private async uploadImagen(tipo: 'producto' | 'categoria', idEntidad: number, blob: Blob): Promise<string> {
    const id = this.negocioId();
    if (!id) return '';
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    const formData = new FormData();
    formData.append('imagen', blob, `imagen.${ext}`);
    const res = await firstValueFrom(
      this.http.post<{ success: boolean; data: { imagen_url: string } }>(
        `${environment.apiUrl}/carta/admin/${id}/imagen/${tipo}/${idEntidad}`,
        formData,
      ),
    );
    return res?.data?.imagen_url ?? '';
  }

  getCatNombre(idCat: number): string {
    return this.categorias().find(c => c.id_categoria === idCat)?.nombre ?? '';
  }

  getCatIcono(idCat: number): string {
    return this.categorias().find(c => c.id_categoria === idCat)?.icono ?? '🍽️';
  }

  formatPrice(value: number): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return '$ 0';
    }
    return `$ ${this.priceFormatter.format(numericValue)}`;
  }

  trackByCat(_: number, c: CategoriaAdmin): number { return c.id_categoria; }
  trackByProd(_: number, p: ProductoAdmin): number  { return p.id_producto;  }
  trackByIdx(i: number): number                      { return i;              }
}
