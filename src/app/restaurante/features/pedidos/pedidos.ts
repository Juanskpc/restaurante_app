import {
  Component, inject, signal, computed, effect,
  ChangeDetectionStrategy, OnInit, OnDestroy, PLATFORM_ID,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, isPlatformBrowser } from '@angular/common';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

// ============================================================
// Interfaces
// ============================================================

export interface Ingrediente {
  id_producto_ingred: number;
  id_ingrediente: number;
  nombre: string;
  es_removible: boolean;
}

export interface Producto {
  id_producto: number;
  nombre: string;
  descripcion: string;
  precio: number;
  icono: string;
  es_popular: boolean;
  ingredientes: Ingrediente[];
}

export interface Categoria {
  id_categoria: number;
  nombre: string;
  descripcion: string;
  icono: string;
  orden: number;
  total_productos: number;
}

export interface ItemOrden {
  id_producto: number;
  nombre: string;
  icono: string;
  precio_unitario: number;
  cantidad: number;
  ingredientes: Ingrediente[];
  exclusiones: Set<number>;   // id_ingrediente excluidos
  exclusionesNombres?: string[];
  nota: string;
}

export interface Mesa {
  id_mesa: number;
  nombre: string;
  numero: number;
  capacidad: number;
  estado: string;
  estado_servicio?: 'DISPONIBLE' | 'OCUPADA' | 'POR_COBRAR' | string;
}

interface DetalleExclusionApi {
  id_ingrediente: number;
  ingrediente?: { id_ingrediente: number; nombre: string };
}

interface DetallePedidoApi {
  id_producto: number;
  cantidad: number;
  precio_unitario: number;
  nota?: string | null;
  producto?: {
    id_producto: number;
    nombre: string;
    icono: string;
    precio: number;
  };
  exclusiones?: DetalleExclusionApi[];
}

interface OrdenApi {
  id_orden: number;
  id_mesa: number | null;
  nota?: string | null;
  detalles?: DetallePedidoApi[];
}

type DestinoEnvio = 'COCINA' | 'CAJA' | 'COBRAR';
type TipoPedido = 'MESA' | 'LLEVAR';

/**
 * PedidosComponent — Vista POS (Point of Sale) del restaurante.
 *
 * Estructura responsive:
 *  Desktop: [Categorías | Productos | Orden]
 *  Móvil:   [Productos] + [Orden como panel deslizable]
 */
@Component({
  selector: 'app-pedidos',
  imports: [LucideAngularModule, FormsModule, CurrencyPipe],
  templateUrl: './pedidos.html',
  styleUrl: './pedidos.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PedidosComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // --- Estado ---
  readonly categorias = signal<Categoria[]>([]);
  readonly productos = signal<Producto[]>([]);
  readonly categoriaActiva = signal<number | null>(null);
  readonly items = signal<ItemOrden[]>([]);
  readonly searchTerm = signal('');
  readonly mesas = signal<Mesa[]>([]);
  readonly mesaId = signal<number | null>(null);
  readonly ordenActivaId = signal<number | null>(null);
  readonly itemsBaseOrdenActiva = signal<ItemOrden[]>([]);
  readonly itemsPagadosPorMesa = signal<Record<number, ItemOrden[]>>({});
  readonly tipoPedido = signal<TipoPedido>('MESA');
  readonly mesaRequeridaError = signal(false);
  readonly notaOrden = signal('');
  readonly enviando = signal(false);
  readonly destinoEnvio = signal<DestinoEnvio | null>(null);
  readonly efectivoRecibidoInput = signal('');
  readonly cargandoProductos = signal(false);
  readonly ordenPanelOpen = signal(false);

  // Para modal de personalización de ingredientes
  readonly itemEditando = signal<ItemOrden | null>(null);
  /** Exclusiones temporales mientras el modal está abierto. */
  readonly exclusionesTemp = signal<Set<number>>(new Set());

  // Debounce para búsqueda en vivo
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // --- Computed ---
  readonly totalItems = computed(() =>
    this.items().reduce((sum, i) => sum + i.cantidad, 0)
  );

  readonly total = computed(() =>
    this.items().reduce((sum, i) => sum + i.precio_unitario * i.cantidad, 0)
  );

  readonly itemsPagados = computed(() => {
    const idMesa = this.mesaId();
    if (!idMesa) return [];
    return this.itemsPagadosPorMesa()[idMesa] ?? [];
  });

  readonly totalPagado = computed(() =>
    this.itemsPagados().reduce((sum, i) => sum + i.precio_unitario * i.cantidad, 0)
  );

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly requiereMesa = computed(() => this.tipoPedido() === 'MESA');
  readonly efectivoRecibido = computed(() => this.parseMonto(this.efectivoRecibidoInput()));
  readonly faltanteCobro = computed(() => {
    const recibido = this.efectivoRecibido();
    if (recibido === null) return null;
    return Math.max(this.total() - recibido, 0);
  });
  readonly vueltaCobro = computed(() => {
    const recibido = this.efectivoRecibido();
    if (recibido === null) return null;
    return Math.max(recibido - this.total(), 0);
  });

  // ===================== Lifecycle =====================

  /** Efecto que reacciona al searchTerm con debounce de 300 ms */
  private readonly searchEffect = effect(() => {
    const term = this.searchTerm();
    // Limpiar timer previo
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.ejecutarBusqueda(term.trim()), 300);
  });

  ngOnInit(): void {
    this.loadCategorias();
    this.loadMesas();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  // ===================== Carga de datos =====================

  private loadCategorias(): void {
    const id = this.negocioId();
    if (!id) return;
    this.http.get<{ success: boolean; data: Categoria[] }>(
      `${environment.apiUrl}/carta/categorias?id_negocio=${id}`
    ).subscribe({
      next: res => {
        const cats = res?.data ?? [];
        this.categorias.set(cats);
        if (cats.length > 0) {
          this.selectCategoria(cats[0].id_categoria);
        }
      },
    });
  }

  selectCategoria(id: number): void {
    this.categoriaActiva.set(id);
    this.searchTerm.set('');
    this.loadProductos(id);
  }

  private loadProductos(idCategoria: number): void {
    const id = this.negocioId();
    if (!id) return;
    this.cargandoProductos.set(true);
    this.http.get<{ success: boolean; data: Producto[] }>(
      `${environment.apiUrl}/carta/productos?id_negocio=${id}&id_categoria=${idCategoria}`
    ).subscribe({
      next: res => {
        this.productos.set(res?.data ?? []);
        this.cargandoProductos.set(false);
      },
      error: () => this.cargandoProductos.set(false),
    });
  }

  private loadMesas(): void {
    const id = this.negocioId();
    if (!id) return;
    this.http.get<{ success: boolean; data: Mesa[] }>(
      `${environment.apiUrl}/mesas?id_negocio=${id}`
    ).subscribe({
      next: res => this.mesas.set(res?.data ?? []),
    });
  }

  /**
   * Ejecuta la búsqueda (llamado por el efecto con debounce).
   * Si el término está vacío, recarga los productos de la categoría activa.
   */
  private ejecutarBusqueda(term: string): void {
    if (!term) {
      const cat = this.categoriaActiva();
      if (cat) this.loadProductos(cat);
      return;
    }
    const id = this.negocioId();
    if (!id) return;
    this.cargandoProductos.set(true);
    this.http.get<{ success: boolean; data: Producto[] }>(
      `${environment.apiUrl}/carta/buscar?id_negocio=${id}&q=${encodeURIComponent(term)}`
    ).subscribe({
      next: res => {
        this.productos.set(res?.data ?? []);
        this.cargandoProductos.set(false);
      },
      error: () => this.cargandoProductos.set(false),
    });
  }

  // ===================== Orden (carrito) =====================

  agregarProducto(producto: Producto): void {
    const current = this.items();
    const existing = current.find(i => i.id_producto === producto.id_producto && i.exclusiones.size === 0);
    if (existing) {
      this.items.set(current.map(i =>
        i === existing ? { ...i, cantidad: i.cantidad + 1 } : i
      ));
    } else {
      this.items.set([...current, {
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        icono: producto.icono,
        precio_unitario: producto.precio,
        cantidad: 1,
        ingredientes: producto.ingredientes,
        exclusiones: new Set<number>(),
        nota: '',
      }]);
    }
    // En móvil mostrar badge animado
  }

  incrementar(item: ItemOrden): void {
    this.items.set(this.items().map(i =>
      i === item ? { ...i, cantidad: i.cantidad + 1 } : i
    ));
  }

  decrementar(item: ItemOrden): void {
    if (item.cantidad <= 1) {
      this.items.set(this.items().filter(i => i !== item));
    } else {
      this.items.set(this.items().map(i =>
        i === item ? { ...i, cantidad: i.cantidad - 1 } : i
      ));
    }
  }

  eliminarItem(item: ItemOrden): void {
    this.items.set(this.items().filter(i => i !== item));
  }

  limpiarOrden(confirmarUsuario = true): void {
    if (confirmarUsuario && this.isBrowser) {
      const confirmada = window.confirm('¿Deseas limpiar el pedido actual? Esta acción no se puede deshacer.');
      if (!confirmada) return;
    }

    this.items.set([]);
    this.itemsBaseOrdenActiva.set([]);
    this.ordenActivaId.set(null);
    this.mesaId.set(null);
    this.notaOrden.set('');
    this.mesaRequeridaError.set(false);
    this.efectivoRecibidoInput.set('');
  }

  seleccionarTipoPedido(tipo: TipoPedido): void {
    this.tipoPedido.set(tipo);
    this.mesaRequeridaError.set(false);
    if (tipo === 'LLEVAR') {
      this.ordenActivaId.set(null);
      this.itemsBaseOrdenActiva.set([]);
      this.mesaId.set(null);
    }
  }

  seleccionarMesa(rawValue: string): void {
    const mesaActual = this.mesaId();
    const veniaConOrdenActiva = this.ordenActivaId() !== null;
    const selectedMesa = rawValue ? +rawValue : null;

    if (mesaActual === selectedMesa) return;

    this.mesaId.set(selectedMesa);
    this.mesaRequeridaError.set(false);

    if (selectedMesa) {
      this.cargarOrdenActivaMesa(selectedMesa, mesaActual);
      return;
    }

    this.itemsBaseOrdenActiva.set([]);
    this.ordenActivaId.set(null);

    if (veniaConOrdenActiva) {
      this.items.set([]);
      this.notaOrden.set('');
    }
  }

  setEfectivoRecibido(rawValue: string): void {
    this.efectivoRecibidoInput.set(rawValue);
  }

  private cargarOrdenActivaMesa(idMesa: number, mesaAnterior: number | null): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    const idOrdenAnterior = this.ordenActivaId();
    const itemsPrevios = this.cloneItems(this.items());
    const itemsBasePrevios = this.cloneItems(this.itemsBaseOrdenActiva());
    const notaPrevia = this.notaOrden();
    const conservarPedidoTemporal = idOrdenAnterior === null && itemsPrevios.length > 0;

    const restaurarEstadoPrevio = (restaurarMesa = true): void => {
      if (restaurarMesa) {
        this.mesaId.set(mesaAnterior);
      }
      this.ordenActivaId.set(idOrdenAnterior);
      this.items.set(itemsPrevios);
      this.itemsBaseOrdenActiva.set(itemsBasePrevios);
      this.notaOrden.set(notaPrevia);
    };

    this.http.get<{ success: boolean; data: OrdenApi[] }>(
      `${environment.apiUrl}/pedidos/abiertas?id_negocio=${idNegocio}`
    ).subscribe({
      next: res => {
        const ordenes = res?.data ?? [];
        const ordenMesa = ordenes.find(o => o.id_mesa === idMesa);

        if (!ordenMesa?.id_orden) {
          this.itemsBaseOrdenActiva.set([]);
          this.ordenActivaId.set(null);

          if (this.mesaSeleccionadaEstaDisponible(idMesa)) {
            this.limpiarItemsPagadosMesa(idMesa);
          }

          if (conservarPedidoTemporal) {
            this.items.set(itemsPrevios);
            this.notaOrden.set(notaPrevia);
          } else {
            this.items.set([]);
            this.notaOrden.set('');
          }
          return;
        }

          if (this.isBrowser && itemsPrevios.length > 0) {
            const confirmarReemplazo = window.confirm(
              'La mesa seleccionada ya tiene un pedido abierto. ¿Deseas cargarlo? Se reemplazará el pedido actual en pantalla.'
            );

            if (!confirmarReemplazo) {
              restaurarEstadoPrevio();
              return;
            }
          }

        this.http.get<{ success: boolean; data: OrdenApi }>(
          `${environment.apiUrl}/pedidos/${ordenMesa.id_orden}`
        ).subscribe({
          next: ordenRes => {
            const orden = ordenRes?.data;
            if (!orden) {
              restaurarEstadoPrevio();
              return;
            }

            const mappedItems = this.mapOrdenApiToItems(orden);
            this.ordenActivaId.set(orden.id_orden);
            this.items.set(mappedItems);
            this.itemsBaseOrdenActiva.set(this.cloneItems(mappedItems));
            this.notaOrden.set(orden.nota ?? '');
          },
          error: () => restaurarEstadoPrevio(),
        });
      },
      error: () => restaurarEstadoPrevio(),
    });
  }

  private mapOrdenApiToItems(orden: OrdenApi): ItemOrden[] {
    return (orden.detalles ?? []).map(det => {
      const exclusiones = det.exclusiones ?? [];
      const exclusionesNombres = exclusiones
        .map(excl => excl.ingrediente?.nombre)
        .filter((nombre): nombre is string => Boolean(nombre));

      return {
        id_producto: det.id_producto,
        nombre: det.producto?.nombre ?? `Producto #${det.id_producto}`,
        icono: det.producto?.icono ?? '🍽️',
        precio_unitario: Number(det.precio_unitario ?? det.producto?.precio ?? 0),
        cantidad: Number(det.cantidad ?? 1),
        ingredientes: [],
        exclusiones: new Set<number>(exclusiones.map(excl => excl.id_ingrediente)),
        exclusionesNombres,
        nota: det.nota ?? '',
      };
    });
  }

  private cloneItems(items: ItemOrden[]): ItemOrden[] {
    return items.map(item => ({
      ...item,
      ingredientes: [...item.ingredientes],
      exclusiones: new Set(item.exclusiones),
      exclusionesNombres: item.exclusionesNombres ? [...item.exclusionesNombres] : undefined,
    }));
  }

  // ===================== Ingredientes =====================

  /**
   * Abre el modal de personalización sin modificar el pedido.
   * Inicializa exclusionesTemp con las exclusiones actuales del item.
   * La separación de unidades sólo ocurre al confirmar con cambios reales.
   */
  abrirPersonalizacion(item: ItemOrden): void {
    this.itemEditando.set(item);
    this.exclusionesTemp.set(new Set(item.exclusiones));
  }

  /** Cierra el modal descartando cambios (botón X o clic en overlay). */
  cerrarPersonalizacion(): void {
    this.itemEditando.set(null);
    this.exclusionesTemp.set(new Set());
  }

  /** Alterna un ingrediente en el estado temporal del modal. */
  toggleExclusion(idIngrediente: number): void {
    const cur = new Set(this.exclusionesTemp());
    if (cur.has(idIngrediente)) {
      cur.delete(idIngrediente);
    } else {
      cur.add(idIngrediente);
    }
    this.exclusionesTemp.set(cur);
  }

  /**
   * Confirma la personalización al pulsar "Listo".
   * - Sin cambios → cierra el modal sin tocar el pedido.
   * - Con cambios + cantidad > 1 → separa 1 unidad con las nuevas exclusiones.
   * - Con cambios + cantidad 1 → aplica las exclusiones al item existente.
   */
  confirmarPersonalizacion(): void {
    const item = this.itemEditando();
    if (!item) { this.cerrarPersonalizacion(); return; }

    const newExcl = this.exclusionesTemp();
    const oldExcl = item.exclusiones;
    const cambio =
      newExcl.size !== oldExcl.size ||
      [...newExcl].some(id => !oldExcl.has(id)) ||
      [...oldExcl].some(id => !newExcl.has(id));

    if (!cambio) {
      this.cerrarPersonalizacion();
      return;
    }

    if (item.cantidad > 1) {
      const updatedOriginal = { ...item, cantidad: item.cantidad - 1 };
      const newItem: ItemOrden = {
        ...item,
        cantidad: 1,
        exclusiones: new Set(newExcl),
        exclusionesNombres: undefined,
        nota: '',
      };
      const current = this.items();
      const idx = current.indexOf(item);
      const newItems = [...current];
      newItems[idx] = updatedOriginal;
      newItems.splice(idx + 1, 0, newItem);
      this.items.set(newItems);
    } else {
      this.items.set(this.items().map(i =>
        i === item ? { ...i, exclusiones: new Set(newExcl), exclusionesNombres: undefined } : i
      ));
    }

    this.cerrarPersonalizacion();
  }

  getExclusionNames(item: ItemOrden): string {
    if (item.exclusiones.size === 0) return '';
    if (item.exclusionesNombres && item.exclusionesNombres.length > 0) {
      return item.exclusionesNombres.join(', ');
    }

    return item.ingredientes
      .filter(ing => item.exclusiones.has(ing.id_ingrediente))
      .map(ing => ing.nombre)
      .join(', ');
  }

  // ===================== Enviar orden =====================

  enviarACocina(): void {
    this.enviarPedido('COCINA');
  }

  enviarACaja(): void {
    this.enviarPedido('CAJA');
  }

  cobrarPedido(): void {
    this.enviarPedido('COBRAR');
  }

  private enviarPedido(destino: DestinoEnvio): void {
    if (this.items().length === 0 || this.enviando()) return;

    if (this.requiereMesa() && !this.mesaId()) {
      this.mesaRequeridaError.set(true);
      return;
    }

    this.mesaRequeridaError.set(false);
    this.enviando.set(true);
    this.destinoEnvio.set(destino);

    const idOrdenActiva = this.requiereMesa() ? this.ordenActivaId() : null;
    if (idOrdenActiva) {
      const itemsNuevos = this.obtenerItemsNuevosOrdenActiva();

      if (itemsNuevos.length === 0) {
        this.procesarDestinoEnvio(destino, idOrdenActiva);
        return;
      }

      this.http.patch<{ success: boolean }>(
        `${environment.apiUrl}/pedidos/${idOrdenActiva}/agregar-items`,
        {
          id_negocio: this.negocioId(),
          nota: this.notaOrden() || null,
          porcentaje_impuesto: 0,
          items: this.mapItemsPayload(itemsNuevos),
        }
      ).subscribe({
        next: res => {
          if (!res?.success) {
            this.resetEstadoEnvio();
            return;
          }

          this.itemsBaseOrdenActiva.set(this.cloneItems(this.items()));
          this.procesarDestinoEnvio(destino, idOrdenActiva);
        },
        error: () => this.resetEstadoEnvio(),
      });
      return;
    }

    const body = {
      id_negocio: this.negocioId(),
      id_mesa: this.requiereMesa() ? (this.mesaId() || null) : null,
      nota: this.notaOrden() || null,
      porcentaje_impuesto: 0,
      items: this.mapItemsPayload(this.items()),
    };

    this.http.post<{ success: boolean; data?: { id_orden?: number } }>(
      `${environment.apiUrl}/pedidos`,
      body
    ).subscribe({
      next: res => {
        if (!res?.success) {
          this.resetEstadoEnvio();
          return;
        }

        const idOrden = res.data?.id_orden;
        if (!idOrden) {
          this.resetEstadoEnvio();
          return;
        }

        this.procesarDestinoEnvio(destino, idOrden);
      },
      error: () => this.resetEstadoEnvio(),
    });
  }

  private procesarDestinoEnvio(destino: DestinoEnvio, idOrden: number): void {
    if (destino === 'COCINA') {
      this.http.patch(
        `${environment.apiUrl}/pedidos/${idOrden}/enviar-cocina`, {}
      ).subscribe({
        next: () => {
          this.limpiarOrden(false);
          this.resetEstadoEnvio();
        },
        error: () => this.resetEstadoEnvio(),
      });
      return;
    }

    if (destino === 'CAJA') {
      this.marcarMesaPorCobrarSiAplica();
      return;
    }

    this.completarCobroPedido(idOrden);
  }

  private completarCobroPedido(idOrden: number): void {
    const recibido = this.efectivoRecibido();
    if (recibido !== null && recibido < this.total()) {
      if (this.isBrowser) {
        window.alert(
          `Faltan ${this.formatCurrency(this.total() - recibido)} para completar el pago.`
        );
      }
      this.resetEstadoEnvio();
      return;
    }

    const deseaImprimir = this.isBrowser
      ? window.confirm('Cobro confirmado. ¿Deseas imprimir la factura?')
      : false;

    if (deseaImprimir) {
      this.imprimirTicket();
    }

    this.http.patch(
      `${environment.apiUrl}/pedidos/${idOrden}/cerrar`,
      {}
    ).subscribe({
      next: () => {
        if (this.requiereMesa()) {
          const idMesa = this.mesaId();
          if (!idMesa) {
            this.resetEstadoEnvio();
            return;
          }

          this.registrarItemsPagadosMesa(idMesa, this.items());
          this.items.set([]);
          this.itemsBaseOrdenActiva.set([]);
          this.ordenActivaId.set(null);
          this.notaOrden.set('');
          this.efectivoRecibidoInput.set('');

          this.http.patch(
            `${environment.apiUrl}/mesas/${idMesa}/estado-servicio`,
            { estado_servicio: 'OCUPADA' }
          ).subscribe({
            next: () => {
              this.loadMesas();
              this.resetEstadoEnvio();
            },
            error: () => {
              this.loadMesas();
              this.resetEstadoEnvio();
            },
          });
          return;
        }

        this.limpiarOrden(false);
        this.loadMesas();
        this.resetEstadoEnvio();
      },
      error: () => this.resetEstadoEnvio(),
    });
  }

  private mapItemsPayload(items: ItemOrden[]): Array<{
    id_producto: number;
    cantidad: number;
    precio_unitario: number;
    nota: string | null;
    exclusiones: number[];
  }> {
    return items.map(i => ({
      id_producto: i.id_producto,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
      nota: i.nota || null,
      exclusiones: Array.from(i.exclusiones),
    }));
  }

  private getItemKey(item: ItemOrden): string {
    const excl = Array.from(item.exclusiones).sort((a, b) => a - b).join(',');
    return `${item.id_producto}|${excl}|${item.nota.trim()}`;
  }

  private agruparItems(items: ItemOrden[]): Map<string, ItemOrden> {
    const grouped = new Map<string, ItemOrden>();

    for (const item of items) {
      const key = this.getItemKey(item);
      const existente = grouped.get(key);

      if (existente) {
        existente.cantidad += item.cantidad;
        continue;
      }

      grouped.set(key, {
        ...item,
        ingredientes: [...item.ingredientes],
        exclusiones: new Set(item.exclusiones),
        exclusionesNombres: item.exclusionesNombres ? [...item.exclusionesNombres] : undefined,
      });
    }

    return grouped;
  }

  private obtenerItemsNuevosOrdenActiva(): ItemOrden[] {
    const actuales = this.agruparItems(this.items());
    const base = this.agruparItems(this.itemsBaseOrdenActiva());
    const nuevos: ItemOrden[] = [];

    for (const [key, itemActual] of actuales.entries()) {
      const cantidadBase = base.get(key)?.cantidad ?? 0;
      const cantidadNueva = itemActual.cantidad - cantidadBase;

      if (cantidadNueva <= 0) continue;

      nuevos.push({
        ...itemActual,
        cantidad: cantidadNueva,
        ingredientes: [...itemActual.ingredientes],
        exclusiones: new Set(itemActual.exclusiones),
        exclusionesNombres: itemActual.exclusionesNombres ? [...itemActual.exclusionesNombres] : undefined,
      });
    }

    return nuevos;
  }

  private marcarMesaPorCobrarSiAplica(): void {
    if (!this.requiereMesa()) {
      this.limpiarOrden(false);
      this.resetEstadoEnvio();
      return;
    }

    const idMesa = this.mesaId();
    if (!idMesa) {
      this.limpiarOrden(false);
      this.resetEstadoEnvio();
      return;
    }

    this.http.patch(
      `${environment.apiUrl}/mesas/${idMesa}/estado-servicio`,
      { estado_servicio: 'POR_COBRAR' }
    ).subscribe({
      next: () => {
        this.limpiarOrden(false);
        this.resetEstadoEnvio();
      },
      error: () => this.resetEstadoEnvio(),
    });
  }

  private resetEstadoEnvio(): void {
    this.enviando.set(false);
    this.destinoEnvio.set(null);
  }

  liberarMesaActual(): void {
    if (!this.requiereMesa() || this.enviando()) return;

    const idMesa = this.mesaId();
    if (!idMesa) return;

    if (this.ordenActivaId() !== null) {
      if (this.isBrowser) {
        window.alert('No se puede liberar la mesa porque tiene una cuenta pendiente de cobro.');
      }
      return;
    }

    if (this.isBrowser) {
      const confirmar = window.confirm(
        '¿Deseas liberar esta mesa?'
      );
      if (!confirmar) return;
    }

    this.enviando.set(true);
    this.destinoEnvio.set(null);

    this.http.patch(
      `${environment.apiUrl}/mesas/${idMesa}/liberar`,
      {}
    ).subscribe({
      next: () => {
        this.limpiarItemsPagadosMesa(idMesa);
        this.limpiarOrden(false);
        this.loadMesas();
        this.resetEstadoEnvio();
      },
      error: (err: unknown) => {
        if (this.isBrowser) {
          const apiMessage = (err as { error?: { message?: string } })?.error?.message;
          window.alert(apiMessage || 'No se pudo liberar la mesa.');
        }
        this.resetEstadoEnvio();
      },
    });
  }

  private registrarItemsPagadosMesa(idMesa: number, items: ItemOrden[]): void {
    if (items.length === 0) return;

    this.itemsPagadosPorMesa.update(actual => {
      const prevItems = actual[idMesa] ?? [];
      const merged = this.agruparItems([
        ...this.cloneItems(prevItems),
        ...this.cloneItems(items),
      ]);

      return {
        ...actual,
        [idMesa]: Array.from(merged.values()),
      };
    });
  }

  private limpiarItemsPagadosMesa(idMesa: number): void {
    this.itemsPagadosPorMesa.update(actual => {
      if (!actual[idMesa]) return actual;

      const next = { ...actual };
      delete next[idMesa];
      return next;
    });
  }

  private mesaSeleccionadaEstaDisponible(idMesa: number): boolean {
    const mesa = this.mesas().find(item => item.id_mesa === idMesa);
    return mesa?.estado_servicio === 'DISPONIBLE';
  }

  private parseMonto(rawValue: string): number | null {
    const digits = rawValue.replace(/\D/g, '');
    if (!digits) return null;
    return Number(digits);
  }

  imprimirTicket(): void {
    if (!this.isBrowser || this.items().length === 0) return;

    const ticketHtml = this.buildTicketHtml(new Date());
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

  private imprimirTicketFallback(ticketHtml: string): void {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=700');
    if (!popup) {
      window.alert('No se pudo abrir la impresión. Habilita ventanas emergentes para continuar.');
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

  private buildTicketHtml(fecha: Date): string {
    const negocioNombre = this.escapeHtml(this.auth.negocio()?.nombre ?? 'Negocio');
    const usuarioNombre = this.escapeHtml(this.auth.usuario()?.nombre_completo ?? 'Usuario');
    const fechaTexto = this.escapeHtml(this.formatDateTime(fecha));
    const tipoPedido = this.tipoPedido() === 'MESA' ? 'En mesa' : 'Para llevar';
    const mesaTexto = this.escapeHtml(this.getMesaLabel());
    const nota = this.notaOrden().trim();
    const notaHtml = nota
      ? `<div class="ticket-note"><strong>Nota:</strong> ${this.escapeHtml(nota)}</div>`
      : '';

    const filasItems = this.items().map(item => {
      const totalLinea = item.cantidad * item.precio_unitario;
      const exclusiones = this.getExclusionNames(item);
      const exclusionesHtml = exclusiones
        ? `<tr><td></td><td colspan="3" class="item-meta">Sin: ${this.escapeHtml(exclusiones)}</td></tr>`
        : '';

      return `
        <tr>
          <td>${item.cantidad}</td>
          <td>${this.escapeHtml(item.nombre)}</td>
          <td>${this.formatCurrency(item.precio_unitario)}</td>
          <td class="text-right">${this.formatCurrency(totalLinea)}</td>
        </tr>
        ${exclusionesHtml}
      `;
    }).join('');

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
              <span>${this.formatCurrency(this.total())}</span>
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

  private getMesaLabel(): string {
    if (this.tipoPedido() === 'LLEVAR') return 'No aplica';

    const idMesa = this.mesaId();
    if (!idMesa) return 'Sin asignar';

    return this.mesas().find(mesa => mesa.id_mesa === idMesa)?.nombre ?? `Mesa #${idMesa}`;
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

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // ===================== Móvil =====================

  toggleOrdenPanel(): void {
    this.ordenPanelOpen.update(v => !v);
  }
}
