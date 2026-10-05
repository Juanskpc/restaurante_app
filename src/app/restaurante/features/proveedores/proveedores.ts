import {
  ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import {
  AmbitoLista, CategoriaProveedor, OrdenLista, Proveedor, ProveedorPayload, ProveedoresService,
} from '../../../core/services/proveedores.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { ComparadorComponent } from './comparador/comparador';
import { ComprasComponent } from './compras/compras';
import { ProveedorFormComponent } from './proveedor-form/proveedor-form';
import {
  IngredienteLite, PermisosProveedores, ProveedorDetalleComponent,
} from './proveedor-detalle/proveedor-detalle';

type Seccion = 'lista' | 'comparador' | 'compras';

const AMBITOS: ReadonlyArray<{ valor: AmbitoLista; texto: string }> = [
  { valor: 'mios', texto: 'Mis proveedores' },
  { valor: 'directorio', texto: 'Directorio compartido' },
  { valor: 'todos', texto: 'Todos' },
];

const ORDENES: ReadonlyArray<{ valor: OrdenLista; texto: string }> = [
  { valor: 'nombre', texto: 'Nombre (A–Z)' },
  { valor: 'reciente', texto: 'Actualizados primero' },
  { valor: 'uso', texto: 'Los que más uso' },
  { valor: 'precio', texto: 'Precio más bajo' },
  { valor: 'actualizacion', texto: 'Precios más frescos' },
];

/** Cuántas fichas se piden por página. El directorio puede crecer: no se trae entero. */
const POR_PAGINA = 24;

/**
 * ProveedoresComponent — la vista del módulo.
 *
 * ## Tres secciones y una sola idea
 *
 * «Proveedores» responde *a quién le compro*, el «Comparador» responde *quién me lo vende más
 * barato* y «Compras» responde *cuánto llevo gastado*. Son tres preguntas distintas del mismo
 * dueño, y por eso van en pestañas de una misma pantalla y no en tres entradas de menú: el
 * recorrido natural es mirar un proveedor, comparar su precio y registrar la compra.
 *
 * ## El filtro de ámbito es lo primero que hay que entender
 *
 * «Mis proveedores» son los que este negocio tiene; el «Directorio compartido» son los que
 * otros negocios publicaron y este todavía no tiene. La diferencia está marcada en cada fila
 * con una etiqueta, no solo con el filtro, porque en «Todos» se mezclan — y confundir uno
 * propio con uno ajeno lleva a creer que un precio de referencia es una oferta.
 *
 * El recorte de privacidad NO se hace aquí: llega hecho del backend. Esta pantalla pinta lo
 * que le dan.
 */
@Component({
  selector: 'app-proveedores',
  standalone: true,
  imports: [
    FormsModule, LucideAngularModule, CurrencyPipe, DatePipe,
    ProveedorFormComponent, ProveedorDetalleComponent, ComparadorComponent, ComprasComponent,
  ],
  templateUrl: './proveedores.html',
  styleUrl: './proveedores.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedoresComponent implements OnInit {
  private readonly api = inject(ProveedoresService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly ui = inject(UiFeedbackService);

  readonly ambitos = AMBITOS;
  readonly ordenes = ORDENES;

  readonly seccion = signal<Seccion>('lista');

  // ── Listado ──
  readonly proveedores = signal<Proveedor[]>([]);
  readonly total = signal(0);
  readonly pagina = signal(0);
  readonly cargando = signal(false);
  readonly errorCarga = signal(false);

  readonly busqueda = signal('');
  readonly ambito = signal<AmbitoLista>('mios');
  readonly categoria = signal<string | null>(null);
  readonly ciudad = signal('');
  readonly orden = signal<OrdenLista>('nombre');
  readonly verArchivados = signal(false);

  // ── Catálogos ──
  readonly categorias = signal<CategoriaProveedor[]>([]);
  readonly ingredientes = signal<IngredienteLite[]>([]);

  // ── Modales ──
  readonly form = signal(false);
  readonly editando = signal<Proveedor | null>(null);
  readonly guardando = signal(false);
  readonly abierto = signal<(Proveedor & { insumos?: never[] }) | null>(null);
  readonly cargandoDetalle = signal(false);
  /** Cuando se pide registrar una compra desde la ficha: lleva el proveedor a la pestaña. */
  readonly compraPara = signal<number | null>(null);

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  /**
   * Los permisos del módulo, resueltos una vez.
   *
   * `canAccessSubnivel` ya trata al ADMINISTRADOR como que lo tiene todo, así que aquí no hay
   * que repetir esa regla. Lo que sí se hace es resolverlos juntos: pasarlos sueltos a cada
   * hijo acabaría en que uno comprueba el permiso equivocado.
   */
  readonly permisos = computed<PermisosProveedores>(() => ({
    crear: this.auth.canAccessSubnivel('proveedores_crear'),
    editar: this.auth.canAccessSubnivel('proveedores_editar'),
    archivar: this.auth.canAccessSubnivel('proveedores_archivar'),
    compras: this.auth.canAccessSubnivel('proveedores_compras'),
    precios: this.auth.canAccessSubnivel('proveedores_precios'),
    publicar: this.auth.canAccessSubnivel('proveedores_publicar'),
  }));

  /** Los vinculados y activos: los únicos a los que se les puede registrar una compra. */
  readonly misProveedores = computed(
    () => this.proveedores().filter((p) => p.es_propio && p.estado_interno !== 'ARCHIVADO'),
  );

  readonly hayFiltros = computed(() =>
    !!this.busqueda().trim() || this.categoria() !== null || !!this.ciudad().trim()
    || this.ambito() !== 'mios' || this.verArchivados(),
  );

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.total() / POR_PAGINA)));

  readonly rango = computed(() => {
    const p = this.pagina();
    const desde = this.total() === 0 ? 0 : p * POR_PAGINA + 1;
    return { desde, hasta: Math.min(this.total(), (p + 1) * POR_PAGINA), total: this.total() };
  });

  /** Al cambiar cualquier criterio se vuelve a la primera página y se recarga. */
  private readonly alCambiarFiltros = effect(() => {
    this.ambito();
    this.categoria();
    this.orden();
    this.verArchivados();
    untracked(() => {
      this.pagina.set(0);
      this.cargar();
    });
  });

  ngOnInit(): void {
    this.cargarCatalogos();
  }

  // ============================================================
  // Carga
  // ============================================================

  cargar(): void {
    const id = this.negocioId();
    if (!id) return;

    const primera = this.proveedores().length === 0;
    if (primera) this.cargando.set(true);

    this.api.listar(id, {
      ambito: this.ambito(),
      busqueda: this.busqueda().trim() || null,
      categoria: this.categoria(),
      ciudad: this.ciudad().trim() || null,
      orden: this.orden(),
      archivados: this.verArchivados(),
      limite: POR_PAGINA,
      offset: this.pagina() * POR_PAGINA,
    }).subscribe({
      next: (res) => {
        this.proveedores.set(res?.data?.items ?? []);
        this.total.set(res?.data?.total ?? 0);
        this.errorCarga.set(false);
        this.cargando.set(false);
      },
      error: () => {
        if (primera) this.errorCarga.set(true);
        this.cargando.set(false);
      },
    });
  }

  private cargarCatalogos(): void {
    const id = this.negocioId();
    if (!id) return;

    this.api.categorias().subscribe({
      next: (res) => this.categorias.set(res?.data ?? []),
      error: () => this.categorias.set([]),
    });

    // Los insumos del inventario salen del endpoint que ya existe para la carta: no se crea
    // otro ni se duplica la entidad. Son los mismos `carta_ingrediente` de Inventario.
    this.http.get<{ success: boolean; data?: IngredienteLite[] }>(
      `${environment.apiUrl}/carta/ingredientes?id_negocio=${id}`,
    ).subscribe({
      next: (res) => this.ingredientes.set(res?.data ?? []),
      error: () => this.ingredientes.set([]),
    });
  }

  reintentar(): void {
    this.errorCarga.set(false);
    this.cargar();
  }

  buscar(): void {
    this.pagina.set(0);
    this.cargar();
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.ciudad.set('');
    this.categoria.set(null);
    this.verArchivados.set(false);
    this.ambito.set('mios');
    this.pagina.set(0);
    this.cargar();
  }

  irAPagina(delta: number): void {
    const siguiente = Math.min(Math.max(0, this.pagina() + delta), this.totalPaginas() - 1);
    if (siguiente === this.pagina()) return;
    this.pagina.set(siguiente);
    this.cargar();
  }

  // ============================================================
  // Detalle
  // ============================================================

  abrir(proveedor: Proveedor): void {
    const id = this.negocioId();
    if (!id) return;

    this.abierto.set(proveedor as Proveedor & { insumos?: never[] });
    this.cargandoDetalle.set(true);
    this.api.detalle(proveedor.id_proveedor, id).subscribe({
      next: (res) => {
        if (res?.data) this.abierto.set(res.data as never);
        this.cargandoDetalle.set(false);
      },
      error: (err) => {
        this.cargandoDetalle.set(false);
        this.abierto.set(null);
        this.ui.error(err?.error?.message ?? 'No se pudo abrir el proveedor.');
      },
    });
  }

  cerrarDetalle(): void {
    this.abierto.set(null);
  }

  /** Relee la ficha abierta y la lista: algo cambió dentro del detalle. */
  refrescarTodo(): void {
    const abierto = this.abierto();
    if (abierto) this.abrir(abierto);
    this.cargar();
  }

  // ============================================================
  // Alta y edición
  // ============================================================

  abrirNuevo(): void {
    this.editando.set(null);
    this.form.set(true);
  }

  abrirEdicion(proveedor: Proveedor): void {
    this.editando.set(proveedor);
    this.form.set(true);
  }

  cerrarForm(): void {
    if (this.guardando()) return;
    this.form.set(false);
    this.editando.set(null);
  }

  guardarProveedor(datos: Omit<ProveedorPayload, 'id_negocio'>): void {
    const id = this.negocioId();
    if (!id || this.guardando()) return;

    const payload: ProveedorPayload = { ...datos, id_negocio: id };
    const editando = this.editando();

    this.guardando.set(true);
    const peticion = editando
      ? this.api.actualizar(editando.id_proveedor, payload)
      : this.api.crear(payload);

    peticion.subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.form.set(false);
        this.editando.set(null);
        this.ui.success(editando ? 'Proveedor actualizado.' : 'Proveedor creado.');
        this.cargar();
        // Si se estaba editando desde la ficha abierta, se relee para que no quede vieja.
        if (this.abierto() && res?.data) this.abrir(res.data);
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudo guardar el proveedor.');
      },
    });
  }

  // ============================================================
  // Acciones sobre la ficha
  // ============================================================

  async archivar(proveedor: Proveedor, archivado: boolean): Promise<void> {
    const id = this.negocioId();
    if (!id) return;

    if (archivado) {
      const confirmado = await this.ui.confirm({
        title: 'Archivar proveedor',
        message: `«${proveedor.nombre_comercial}» saldrá de tu lista, pero no se borra: tus `
          + 'compras y precios se conservan, y los demás negocios no se enteran.',
        confirmText: 'Archivar',
        tone: 'warning',
      });
      if (!confirmado) return;
    }

    this.api.archivar(proveedor.id_proveedor, id, archivado).subscribe({
      next: () => {
        this.ui.updated(archivado ? 'Proveedor archivado.' : 'Proveedor reactivado.');
        this.abierto.set(null);
        this.cargar();
      },
      error: (err) => this.ui.error(err?.error?.message ?? 'No se pudo archivar el proveedor.'),
    });
  }

  vincular(proveedor: Proveedor): void {
    const id = this.negocioId();
    if (!id) return;

    this.api.vincular(proveedor.id_proveedor, id).subscribe({
      next: (res) => {
        this.ui.success(res?.message ?? 'Proveedor agregado a tu lista.');
        this.cargar();
        this.abrir(proveedor);
      },
      error: (err) => this.ui.error(err?.error?.message ?? 'No se pudo agregar el proveedor.'),
    });
  }

  /** Desde la ficha: salta a la pestaña de compras con el proveedor ya elegido. */
  registrarCompraDe(proveedor: Proveedor): void {
    this.abierto.set(null);
    this.seccion.set('compras');
    // Se reinicia primero para que pedir el mismo proveedor dos veces vuelva a abrir el form.
    this.compraPara.set(null);
    queueMicrotask(() => this.compraPara.set(proveedor.id_proveedor));
  }

  // ============================================================
  // Presentación
  // ============================================================

  /** Las tres primeras categorías: en una fila de tabla más no caben sin apretar. */
  categoriasCortas(p: Proveedor): string {
    return (p.categorias ?? []).slice(0, 3).map((c) => c.nombre).join(', ');
  }

  /**
   * Dónde está, con lo que haya. El formulario solo pide la dirección, así que ciudad y zonas
   * vienen casi siempre vacías: la dirección es el primer candidato, no el último.
   */
  ubicacion(p: Proveedor): string {
    if (p.direccion) return p.direccion;
    const partes = [p.ciudad, p.region].filter(Boolean);
    if (partes.length) return partes.join(', ');
    return p.zonas_cobertura?.length ? p.zonas_cobertura.slice(0, 2).join(', ') : '';
  }

  /** El teléfono preferido para llamar o escribir: WhatsApp si lo hay. */
  contactoPreferido(p: Proveedor): string | null {
    return p.whatsapp || p.telefono || null;
  }

  whatsappDe(p: Proveedor): string | null {
    const n = (p.whatsapp || '').replace(/[^\d+]/g, '');
    return n ? `https://wa.me/${n.replace(/^\+/, '')}` : null;
  }
}
