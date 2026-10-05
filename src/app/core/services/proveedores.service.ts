import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

// ============================================================
// Tipos del dominio
// ============================================================

/**
 * Cuánto de una ficha puede ver quien pregunta. Lo decide el backend y llega resuelto:
 * la pantalla no recalcula permisos, solo pinta lo que le dieron.
 *
 *   propio      → es suyo (lo creó o lo agregó): lo ve todo, incluido lo privado.
 *   completo    → del directorio, con precios publicados.
 *   sin_precios → del directorio, con condiciones pero sin precios.
 *   basico      → del directorio, solo lo indispensable para contactarlo.
 */
export type NivelAcceso = 'propio' | 'completo' | 'sin_precios' | 'basico';

export type Visibilidad = 'PRIVADO' | 'DIRECTORIO_BASICO' | 'DIRECTORIO_SIN_PRECIOS' | 'DIRECTORIO';
export type TipoAtencion = 'ENTREGA' | 'RECOGIDA' | 'AMBOS';
export type UnidadInsumo = 'KG' | 'G' | 'L' | 'ML' | 'UN' | 'CAJA' | 'BULTO' | 'PAQUETE' | 'OTRA';
export type AmbitoLista = 'mios' | 'directorio' | 'todos';
export type OrdenLista = 'nombre' | 'reciente' | 'precio' | 'uso' | 'actualizacion';

export interface CategoriaProveedor {
  id_categoria_prov: number;
  codigo: string;
  nombre: string;
  icono: string | null;
}

/**
 * Una ficha de proveedor tal como llega.
 *
 * Casi todo es opcional **a propósito**: el backend no manda `null` en lo que no corresponde
 * ver, manda la propiedad ausente. Es la diferencia entre «no tiene dirección» y «no te toca
 * verla», y la pantalla las pinta distinto.
 */
export interface Proveedor {
  id_proveedor: number;
  nombre_comercial: string;
  descripcion: string | null;
  logo_url: string | null;
  categorias: CategoriaProveedor[];

  persona_contacto: string | null;
  telefono: string | null;
  whatsapp: string | null;
  email: string | null;
  sitio_web: string | null;
  redes: Record<string, string>;
  ciudad: string | null;
  region: string | null;
  pais: string | null;
  tipo_atencion: TipoAtencion;

  es_propio: boolean;
  nivel_acceso: NivelAcceso;

  // Solo con condiciones comerciales visibles
  direccion?: string | null;
  zonas_cobertura?: string[];
  pedido_minimo?: number;
  dias_entrega?: number[];
  tiempo_entrega_hrs?: number | null;
  metodos_pago?: string | null;
  precios_mayoristas?: boolean;
  observaciones?: string | null;

  // Solo para quien lo tiene vinculado
  nombre_legal?: string | null;
  identificacion?: string | null;
  visibilidad?: Visibilidad;
  estado?: string;
  es_propietario?: boolean;
  estado_interno?: 'ACTIVO' | 'ARCHIVADO';
  notas?: string | null;
  condiciones_propias?: string | null;
  calificacion?: number | null;
  fecha_vinculacion?: string | null;

  // Agregados de la lista
  insumos?: number;
  insumos_destacados?: string | null;
  compras?: number | null;
  ultima_compra?: string | null;
  precio_min?: number | null;
  ultimo_precio?: string | null;
}

export interface ProveedorDetalle extends Proveedor {
  insumos_lista?: InsumoProveedor[];
}

export interface InsumoProveedor {
  id_proveedor_insumo: number;
  id_proveedor: number;
  nombre: string;
  id_categoria_prov: number | null;
  categoria: string | null;
  unidad: UnidadInsumo;
  presentacion: string | null;
  cantidad_presentacion: number | null;
  moneda: string;
  disponible: boolean;
  marca: string | null;
  es_propio: boolean;
  precio: number | null;
  fecha_precio: string | null;
  precio_publico?: boolean;
  /** `true` cuando hay precio pero no corresponde verlo. No es lo mismo que «sin precio». */
  precio_reservado?: boolean;
  // Solo en los propios
  id_ingrediente?: number | null;
  ingrediente?: string | null;
  codigo_proveedor?: string | null;
  notas?: string | null;
}

export interface PuntoPrecio {
  id_precio: number;
  precio: number;
  moneda: string;
  origen: 'MANUAL' | 'COMPRA';
  id_compra: number | null;
  fecha: string;
  usuario: string | null;
}

/** Una oferta dentro de una comparación. `precio_base` es el precio por unidad comparable. */
export interface OfertaComparada {
  id_proveedor_insumo: number;
  id_proveedor: number;
  proveedor: string;
  ciudad: string | null;
  insumo: string;
  marca: string | null;
  unidad: UnidadInsumo;
  presentacion: string | null;
  cantidad_presentacion: number | null;
  precio: number;
  moneda: string;
  fecha_precio: string | null;
  dias_desde_precio: number | null;
  disponible: boolean;
  /** PRIVADO: mi precio negociado. PUBLICO: precio de referencia de otro negocio. */
  ambito: 'PRIVADO' | 'PUBLICO';
  es_propio: boolean;
  vinculado: boolean;
  precio_base: number | null;
  unidad_base: 'KG' | 'L' | 'UN' | null;
  /** El precio base se calculó asumiendo 1 por presentación: avísalo, no lo escondas. */
  estimado: boolean;
}

export interface GrupoComparado {
  clave: string;
  insumo: string;
  ofertas: OfertaComparada[];
  /** `null` cuando no se puede señalar uno sin mentir (kilos contra cajas). */
  id_mas_barato: number | null;
  unidades_mixtas: boolean;
  presentaciones_distintas: boolean;
  fechas_dispares: boolean;
  precio_mas_viejo_dias: number | null;
}

export interface CompraDetalleLinea {
  id_detalle: number;
  id_proveedor_insumo: number | null;
  id_ingrediente: number | null;
  ingrediente: string | null;
  unidad_inventario: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  descuento: number;
  total: number;
  stock_sumado: number;
}

export interface Compra {
  id_compra: number;
  fecha: string;
  referencia: string | null;
  id_proveedor: number;
  proveedor: string;
  subtotal: number;
  descuento: number;
  impuesto: number;
  total: number;
  estado: 'A' | 'N';
  motivo_anulacion: string | null;
  observaciones: string | null;
  adjunto_url: string | null;
  afecta_inventario: boolean;
  metodo_pago: string | null;
  renglones: number;
  usuario: string | null;
  detalles?: CompraDetalleLinea[];
  /** Renglones que no pudieron entrar al inventario, con el motivo. Solo al registrar. */
  avisos?: Array<{ renglon: number; descripcion: string; motivo: string; detalle: string }>;
}

export interface ResumenGasto {
  total: number;
  compras: number;
  promedio: number;
  por_mes: Array<{ periodo: string; total: number; compras: number }>;
  por_proveedor: Array<{ id_proveedor: number; proveedor: string; total: number; compras: number }>;
}

export interface Pagina<T> {
  items: T[];
  total: number;
  limite: number;
  offset: number;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  code?: string;
}

/** Lo que se manda al crear o editar una ficha. */
export interface ProveedorPayload {
  id_negocio: number;
  nombre_comercial: string;
  nombre_legal?: string | null;
  identificacion?: string | null;
  descripcion?: string | null;
  persona_contacto?: string | null;
  telefono?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  sitio_web?: string | null;
  redes?: Record<string, string>;
  direccion?: string | null;
  ciudad?: string | null;
  region?: string | null;
  pais?: string | null;
  zonas_cobertura?: string[];
  tipo_atencion?: TipoAtencion;
  pedido_minimo?: number | null;
  dias_entrega?: number[];
  tiempo_entrega_hrs?: number | null;
  metodos_pago?: string | null;
  precios_mayoristas?: boolean;
  observaciones?: string | null;
  visibilidad?: Visibilidad;
  categorias?: Array<string | number>;
}

export interface InsumoPayload {
  id_negocio: number;
  nombre: string;
  id_categoria_prov?: number | null;
  id_ingrediente?: number | null;
  unidad?: UnidadInsumo;
  presentacion?: string | null;
  cantidad_presentacion?: number | null;
  precio?: number | null;
  fecha_precio?: string | null;
  publico?: boolean;
  disponible?: boolean;
  marca?: string | null;
  codigo_proveedor?: string | null;
  notas?: string | null;
}

export interface CompraPayload {
  id_negocio: number;
  id_proveedor: number;
  fecha?: string;
  referencia?: string | null;
  descuento?: number;
  impuesto?: number;
  id_metodo_pago?: number | null;
  observaciones?: string | null;
  afecta_inventario?: boolean;
  detalles: Array<{
    id_proveedor_insumo?: number | null;
    id_ingrediente?: number | null;
    descripcion?: string | null;
    cantidad: number;
    unidad?: string;
    precio_unitario?: number;
    descuento?: number;
  }>;
}

/**
 * ProveedoresService — proveedores de insumos, sus precios y las compras.
 *
 * El recorte de privacidad **no se hace aquí**: llega hecho del backend, que es el único
 * sitio donde puede hacerse de verdad. Esta clase no filtra nada, solo transporta — si
 * decidiera qué mostrar, bastaría abrir las herramientas del navegador para saltárselo.
 */
@Injectable({ providedIn: 'root' })
export class ProveedoresService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/proveedores`;

  // ── Catálogo ──

  categorias(): Observable<ApiResponse<CategoriaProveedor[]>> {
    return this.http.get<ApiResponse<CategoriaProveedor[]>>(`${this.base}/categorias`);
  }

  // ── Proveedores ──

  listar(idNegocio: number, opciones: {
    ambito?: AmbitoLista;
    busqueda?: string | null;
    categoria?: string | null;
    ciudad?: string | null;
    orden?: OrdenLista;
    archivados?: boolean;
    limite?: number;
    offset?: number;
  } = {}): Observable<ApiResponse<Pagina<Proveedor>>> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.ambito) params = params.set('ambito', opciones.ambito);
    if (opciones.busqueda) params = params.set('busqueda', opciones.busqueda);
    if (opciones.categoria) params = params.set('categoria', opciones.categoria);
    if (opciones.ciudad) params = params.set('ciudad', opciones.ciudad);
    if (opciones.orden) params = params.set('orden', opciones.orden);
    if (opciones.archivados) params = params.set('archivados', 'true');
    if (opciones.limite) params = params.set('limite', String(opciones.limite));
    if (opciones.offset) params = params.set('offset', String(opciones.offset));
    return this.http.get<ApiResponse<Pagina<Proveedor>>>(this.base, { params });
  }

  detalle(idProveedor: number, idNegocio: number): Observable<ApiResponse<Proveedor & { insumos: InsumoProveedor[] }>> {
    return this.http.get<ApiResponse<Proveedor & { insumos: InsumoProveedor[] }>>(
      `${this.base}/${idProveedor}`,
      { params: new HttpParams().set('id_negocio', String(idNegocio)) },
    );
  }

  crear(payload: ProveedorPayload): Observable<ApiResponse<Proveedor>> {
    return this.http.post<ApiResponse<Proveedor>>(this.base, payload);
  }

  actualizar(idProveedor: number, payload: ProveedorPayload): Observable<ApiResponse<Proveedor>> {
    return this.http.put<ApiResponse<Proveedor>>(`${this.base}/${idProveedor}`, payload);
  }

  cambiarVisibilidad(idProveedor: number, idNegocio: number, visibilidad: Visibilidad) {
    return this.http.patch<ApiResponse<{ id_proveedor: number; visibilidad: Visibilidad }>>(
      `${this.base}/${idProveedor}/visibilidad`, { id_negocio: idNegocio, visibilidad },
    );
  }

  archivar(idProveedor: number, idNegocio: number, archivado: boolean) {
    return this.http.patch<ApiResponse<{ id_proveedor: number; estado_interno: string }>>(
      `${this.base}/${idProveedor}/archivar`, { id_negocio: idNegocio, archivado },
    );
  }

  /** Agregar a «Mis proveedores» uno encontrado en el directorio compartido. */
  vincular(idProveedor: number, idNegocio: number) {
    return this.http.post<ApiResponse<{ id_proveedor: number; ya_estaba: boolean }>>(
      `${this.base}/${idProveedor}/vincular`, { id_negocio: idNegocio },
    );
  }

  guardarPrivado(idProveedor: number, payload: {
    id_negocio: number;
    notas?: string | null;
    condiciones?: string | null;
    calificacion?: number | null;
  }) {
    return this.http.put<ApiResponse<Proveedor>>(`${this.base}/${idProveedor}/privado`, payload);
  }

  reportar(idProveedor: number, idNegocio: number, motivo: string) {
    return this.http.post<ApiResponse<{ id_proveedor: number; reportado: boolean }>>(
      `${this.base}/${idProveedor}/reportar`, { id_negocio: idNegocio, motivo },
    );
  }

  // ── Insumos ──

  insumos(idProveedor: number, idNegocio: number): Observable<ApiResponse<InsumoProveedor[]>> {
    return this.http.get<ApiResponse<InsumoProveedor[]>>(`${this.base}/${idProveedor}/insumos`, {
      params: new HttpParams().set('id_negocio', String(idNegocio)),
    });
  }

  crearInsumo(idProveedor: number, payload: InsumoPayload): Observable<ApiResponse<InsumoProveedor>> {
    return this.http.post<ApiResponse<InsumoProveedor>>(`${this.base}/${idProveedor}/insumos`, payload);
  }

  actualizarInsumo(idInsumo: number, payload: InsumoPayload): Observable<ApiResponse<InsumoProveedor>> {
    return this.http.put<ApiResponse<InsumoProveedor>>(`${this.base}/insumos/${idInsumo}`, payload);
  }

  eliminarInsumo(idInsumo: number, idNegocio: number) {
    return this.http.delete<ApiResponse<{ id_proveedor_insumo: number }>>(
      `${this.base}/insumos/${idInsumo}`,
      { params: new HttpParams().set('id_negocio', String(idNegocio)) },
    );
  }

  historicoPrecios(idInsumo: number, idNegocio: number): Observable<ApiResponse<PuntoPrecio[]>> {
    return this.http.get<ApiResponse<PuntoPrecio[]>>(`${this.base}/insumos/${idInsumo}/precios`, {
      params: new HttpParams().set('id_negocio', String(idNegocio)),
    });
  }

  // ── Comparador ──

  comparar(idNegocio: number, opciones: { busqueda?: string; idIngrediente?: number } = {}) {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.busqueda) params = params.set('busqueda', opciones.busqueda);
    if (opciones.idIngrediente) params = params.set('id_ingrediente', String(opciones.idIngrediente));
    return this.http.get<ApiResponse<GrupoComparado[]>>(`${this.base}/comparador`, { params });
  }

  // ── Compras ──

  compras(idNegocio: number, opciones: {
    idProveedor?: number | null;
    idIngrediente?: number | null;
    busqueda?: string | null;
    desde?: string | null;
    hasta?: string | null;
    anuladas?: boolean;
    limite?: number;
    offset?: number;
  } = {}): Observable<ApiResponse<Pagina<Compra>>> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.idProveedor) params = params.set('id_proveedor', String(opciones.idProveedor));
    if (opciones.idIngrediente) params = params.set('id_ingrediente', String(opciones.idIngrediente));
    if (opciones.busqueda) params = params.set('busqueda', opciones.busqueda);
    if (opciones.desde) params = params.set('desde', opciones.desde);
    if (opciones.hasta) params = params.set('hasta', opciones.hasta);
    if (opciones.anuladas) params = params.set('anuladas', 'true');
    if (opciones.limite) params = params.set('limite', String(opciones.limite));
    if (opciones.offset) params = params.set('offset', String(opciones.offset));
    return this.http.get<ApiResponse<Pagina<Compra>>>(`${this.base}/compras`, { params });
  }

  compra(idCompra: number, idNegocio: number): Observable<ApiResponse<Compra>> {
    return this.http.get<ApiResponse<Compra>>(`${this.base}/compras/${idCompra}`, {
      params: new HttpParams().set('id_negocio', String(idNegocio)),
    });
  }

  registrarCompra(payload: CompraPayload): Observable<ApiResponse<Compra>> {
    return this.http.post<ApiResponse<Compra>>(`${this.base}/compras`, payload);
  }

  anularCompra(idCompra: number, idNegocio: number, motivo?: string) {
    return this.http.patch<ApiResponse<{ id_compra: number; estado: string }>>(
      `${this.base}/compras/${idCompra}/anular`, { id_negocio: idNegocio, motivo },
    );
  }

  resumenGasto(idNegocio: number, opciones: { desde?: string | null; hasta?: string | null } = {}) {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.desde) params = params.set('desde', opciones.desde);
    if (opciones.hasta) params = params.set('hasta', opciones.hasta);
    return this.http.get<ApiResponse<ResumenGasto>>(`${this.base}/compras/resumen`, { params });
  }

  evolucionPrecio(idNegocio: number, opciones: { idInsumo?: number; idIngrediente?: number }) {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.idInsumo) params = params.set('id_proveedor_insumo', String(opciones.idInsumo));
    if (opciones.idIngrediente) params = params.set('id_ingrediente', String(opciones.idIngrediente));
    return this.http.get<ApiResponse<Array<{
      fecha: string; precio: number; origen: string; proveedor: string; insumo: string;
    }>>>(`${this.base}/compras/evolucion-precio`, { params });
  }

  /**
   * Sube la factura escaneada. Va aparte del registro de la compra porque el archivo necesita
   * el id que acaba de nacer, y porque un fallo subiendo la foto no puede tumbar una compra
   * que ya entró al inventario.
   */
  subirAdjunto(idCompra: number, idNegocio: number, archivo: File) {
    const datos = new FormData();
    datos.append('id_negocio', String(idNegocio));
    datos.append('archivo', archivo);
    return this.http.post<ApiResponse<{ id_compra: number; adjunto_url: string }>>(
      `${this.base}/compras/${idCompra}/adjunto`, datos,
    );
  }

  /**
   * La factura, como blob.
   *
   * No es una `<img src>` ni un enlace: el adjunto NO se sirve desde `/uploads` —lleva precios
   * de compra y datos fiscales— y hay que pedirlo con el token, que es lo que el interceptor
   * añade a esta petición y no añadiría a una etiqueta del navegador.
   */
  adjunto(idCompra: number, idNegocio: number): Observable<Blob> {
    return this.http.get(`${this.base}/compras/${idCompra}/adjunto`, {
      params: new HttpParams().set('id_negocio', String(idNegocio)),
      responseType: 'blob',
    });
  }
}
