import {
  ChangeDetectionStrategy, Component, DestroyRef, HostListener, OnInit, computed, effect, inject,
  PLATFORM_ID, signal, untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import {
  ClienteDirectorio, ClientesService, CuentaCliente, ModoCuenta, MovimientoCuenta,
} from '../../../core/services/clientes.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { aplicarLista, aplicarValor } from '../../../core/utils/refresco-vivo';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

/** `clientes`: directorio automático. `cuentas`: tiqueteras y fiado (opt-in del negocio). */
type Seccion = 'clientes' | 'cuentas';
type FiltroDir = 'todos' | 'frecuentes' | 'nuevos';
type OrdenDir = 'reciente' | 'nombre' | 'pedidos' | 'total' | 'ultimo';
type Filtro = 'todos' | 'deben' | 'a_favor';

/** Desde cuántos pedidos un cliente cuenta como «frecuente». */
const PEDIDOS_FRECUENTE = 3;
/** Cuántos días se considera «nuevo» a un cliente desde que se registró. */
const DIAS_NUEVO = 30;
type Orden = 'prioridad' | 'nombre' | 'saldo' | 'comprados' | 'restantes';
type Modal = null | 'nueva' | 'abono' | 'ajuste' | 'editar';

/** Filas por página de la tabla. */
const POR_PAGINA = 25;

/**
 * Tope que se pide al servidor. La lista se filtra, ordena y cuenta aquí: la clientela de
 * confianza de un restaurante son decenas, no miles, y así los contadores de cada filtro y la
 * búsqueda por tipo o saldo salen sin ir y volver a la base en cada tecla.
 */
const LIMITE_LISTA = 500;

/**
 * ClientesComponent — tiqueteras y fiado.
 *
 * En un restaurante de barrio hay clientes de confianza que **pagan el mes por adelantado**
 * (la tiquetera) y otros que **comen y pagan al final** (el fiado). No son dos cosas: es la
 * misma cuenta con el signo cambiado, y por eso es una sola pantalla.
 *
 *   saldo positivo → tiene comida pagada por delante
 *   saldo negativo → debe plata, hasta donde llegue su cupo
 *
 * La lista arranca ordenada por quién debe, porque «¿quién me debe?» es la pregunta que el
 * dueño se hace todos los días; «¿cuánto tengo cobrado por adelantado?» es la de fin de mes.
 */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, LucideAngularModule],
  templateUrl: './clientes.html',
  styleUrl: './clientes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ClientesService);
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly realtime = inject(RealtimeService);
  private readonly ui = inject(UiFeedbackService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  readonly cuentas = signal<CuentaCliente[]>([]);
  readonly cargando = signal(false);
  /** Falló la primera carga: se enseña el estado de error con «Intentar nuevamente». */
  readonly errorCarga = signal(false);
  readonly guardando = signal(false);
  readonly busqueda = signal('');
  readonly filtro = signal<Filtro>('todos');
  readonly orden = signal<Orden>('prioridad');
  readonly ordenAsc = signal(true);
  /** Página actual de la tabla (desde 0). */
  readonly pagina = signal(0);

  /** Menú contextual de una fila: qué cuenta y dónde pintarlo (coordenadas de ventana). */
  readonly menu = signal<{ cuenta: CuentaCliente; top: number; right: number } | null>(null);
  /** Tarjeta desplegada en móvil (muestra teléfono, comprados y acciones). */
  readonly expandida = signal<number | null>(null);
  /** Fila recién creada o editada: se resalta un momento para confirmar dónde quedó. */
  readonly resaltada = signal<number | null>(null);
  private timerResalte: ReturnType<typeof setTimeout> | null = null;

  readonly filtros: ReadonlyArray<{ valor: Filtro; texto: string }> = [
    { valor: 'todos', texto: 'Todos' },
    { valor: 'deben', texto: 'Deben' },
    { valor: 'a_favor', texto: 'A favor' },
  ];

  // ── Derivados de la lista ──

  /** Lo que coincide con la búsqueda, antes de aplicar el filtro de saldo. */
  private readonly buscadas = computed(() => {
    const q = this.normalizar(this.busqueda());
    if (!q) return this.cuentas();
    return this.cuentas().filter((c) => this.textoBuscable(c).includes(q));
  });

  /** Cuántas hay en cada filtro, con la búsqueda ya aplicada. */
  readonly conteos = computed<Record<Filtro, number>>(() => {
    const lista = this.buscadas();
    return {
      todos: lista.length,
      deben: lista.filter((c) => this.estadoCuenta(c) === 'debe').length,
      a_favor: lista.filter((c) => this.estadoCuenta(c) === 'favor').length,
    };
  });

  readonly filtradas = computed(() => {
    const f = this.filtro();
    const lista = this.buscadas().filter((c) => {
      if (f === 'deben') return this.estadoCuenta(c) === 'debe';
      if (f === 'a_favor') return this.estadoCuenta(c) === 'favor';
      return true;
    });
    return this.ordenar(lista);
  });

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));

  readonly paginadas = computed(() => {
    // Si la lista encoge (búsqueda, tiempo real) la página se ajusta sola a la última que existe.
    const p = Math.min(this.pagina(), this.totalPaginas() - 1);
    return this.filtradas().slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);
  });

  /** «1–25 de 60» del pie de la tabla. */
  readonly rango = computed(() => {
    const total = this.filtradas().length;
    const p = Math.min(this.pagina(), this.totalPaginas() - 1);
    const desde = total === 0 ? 0 : p * POR_PAGINA + 1;
    return { desde, hasta: Math.min(total, (p + 1) * POR_PAGINA), total, pagina: p };
  });

  /** ¿Hay algo que limpiar? Decide entre «sin resultados» y «aún no hay clientes». */
  readonly hayFiltros = computed(() => !!this.busqueda().trim() || this.filtro() !== 'todos');

  // ── Secciones ──

  /** Tiqueteras y fiado solo existen si el negocio las activó en Configuración. */
  readonly permiteCuentas = computed(() => this.auth.permiteCuentasCliente());
  readonly seccion = signal<Seccion>('clientes');

  // ── Directorio de clientes (registro automático) ──

  readonly directorio = signal<ClienteDirectorio[]>([]);
  readonly cargandoDir = signal(false);
  readonly errorDir = signal(false);
  readonly filtroDir = signal<FiltroDir>('todos');
  readonly ordenDir = signal<OrdenDir>('reciente');
  readonly ordenDirAsc = signal(false);
  readonly paginaDir = signal(0);
  readonly menuDir = signal<{ cliente: ClienteDirectorio; top: number; right: number } | null>(null);
  /** Ficha del cliente del directorio abierta. */
  readonly clienteVer = signal<ClienteDirectorio | null>(null);

  readonly filtrosDir: ReadonlyArray<{ valor: FiltroDir; texto: string }> = [
    { valor: 'todos', texto: 'Todos' },
    { valor: 'frecuentes', texto: 'Frecuentes' },
    { valor: 'nuevos', texto: 'Nuevos' },
  ];

  private readonly dirBuscados = computed(() => {
    const q = this.normalizar(this.busqueda());
    if (!q) return this.directorio();
    return this.directorio().filter((c) => this.textoBuscableDir(c).includes(q));
  });

  readonly conteosDir = computed<Record<FiltroDir, number>>(() => {
    const lista = this.dirBuscados();
    return {
      todos: lista.length,
      frecuentes: lista.filter((c) => c.pedidos >= PEDIDOS_FRECUENTE).length,
      nuevos: lista.filter((c) => this.esNuevo(c)).length,
    };
  });

  readonly dirFiltrados = computed(() => {
    const f = this.filtroDir();
    const lista = this.dirBuscados().filter((c) => {
      if (f === 'frecuentes') return c.pedidos >= PEDIDOS_FRECUENTE;
      if (f === 'nuevos') return this.esNuevo(c);
      return true;
    });
    return this.ordenarDir(lista);
  });

  readonly totalPaginasDir = computed(() =>
    Math.max(1, Math.ceil(this.dirFiltrados().length / POR_PAGINA)),
  );

  readonly rangoDir = computed(() => {
    const total = this.dirFiltrados().length;
    const p = Math.min(this.paginaDir(), this.totalPaginasDir() - 1);
    const desde = total === 0 ? 0 : p * POR_PAGINA + 1;
    return { desde, hasta: Math.min(total, (p + 1) * POR_PAGINA), total, pagina: p };
  });

  readonly dirPaginados = computed(() => {
    const p = this.rangoDir().pagina;
    return this.dirFiltrados().slice(p * POR_PAGINA, (p + 1) * POR_PAGINA);
  });

  readonly hayFiltrosDir = computed(() => !!this.busqueda().trim() || this.filtroDir() !== 'todos');

  readonly seleccionada = signal<CuentaCliente | null>(null);
  readonly movimientos = signal<MovimientoCuenta[]>([]);
  readonly cargandoMovimientos = signal(false);

  readonly modal = signal<Modal>(null);
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string; es_cuenta?: boolean }>>([]);
  readonly productos = signal<Array<{ id_producto: number; nombre: string; precio: number }>>([]);

  // ── Formularios ──
  readonly formNombre = signal('');
  readonly formTelefono = signal('');
  readonly formModo = signal<ModoCuenta>('DINERO');
  readonly formCupo = signal<number | null>(null);
  readonly formNota = signal('');

  readonly abonoMonto = signal<number | null>(null);
  readonly abonoTiquetes = signal<number | null>(null);
  readonly abonoProducto = signal<number | null>(null);
  readonly abonoDescuento = signal<number | null>(null);
  readonly abonoMetodo = signal<number | null>(null);
  readonly abonoConcepto = signal('');

  /** El producto elegido para la tiquetera, con su precio de carta. */
  readonly productoAbono = computed(() => {
    const id = Number(this.abonoProducto());
    return this.productos().find((p) => Number(p.id_producto) === id) ?? null;
  });

  /**
   * Una tiquetera se paga por adelantado: vale precio × cantidad, menos el descuento. Se muestra
   * calculado y sin campo editable, y el servidor lo vuelve a calcular con el precio de la carta:
   * lo que se pinta aquí es para que el cajero sepa cuánto cobrar, no lo que se guarda.
   */
  readonly subtotalTiquetera = computed(
    () => Number(this.productoAbono()?.precio ?? 0) * (Number(this.abonoTiquetes()) || 0),
  );
  readonly descuentoTiquetera = computed(() => Math.max(0, Number(this.abonoDescuento()) || 0));
  readonly totalTiquetera = computed(() =>
    Math.max(0, this.subtotalTiquetera() - this.descuentoTiquetera()),
  );

  readonly ajusteTipo = signal<'ABONO' | 'CARGO'>('ABONO');
  readonly ajusteMonto = signal<number | null>(null);
  readonly ajusteTiquetes = signal<number | null>(null);
  readonly ajusteProducto = signal<number | null>(null);
  readonly ajusteMotivo = signal('');

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  /** Vender tiqueteras y recibir pagos mueve plata: va detrás de su propio permiso. */
  readonly puedeAbonar = computed(() => this.auth.canAccessSubnivel('clientes_abonar'));
  /** Perdonar deudas NO mueve plata y por eso es más delicado: no deja rastro en caja. */
  readonly puedeAjustar = computed(() => this.auth.canAccessSubnivel('clientes_ajustar'));
  /** Eliminar una tiquetera: nace denegado para todos y se concede en Roles y permisos. */
  readonly puedeEliminar = computed(() => this.auth.canAccessSubnivel('clientes_eliminar'));

  readonly esTiquetes = computed(() => this.seleccionada()?.modo === 'TIQUETES');

  /** Formas de pago con las que se puede RECIBIR dinero (la de la propia cuenta no cuenta). */
  readonly metodosCobrables = computed(() => this.metodosPago().filter((m) => !m.es_cuenta));

  /** Al cambiar búsqueda, filtros u orden se vuelve a la primera página. */
  private readonly reinicioPaginacion = effect(() => {
    this.busqueda();
    this.filtro();
    this.orden();
    this.ordenAsc();
    untracked(() => this.pagina.set(0));
  });

  private readonly reinicioPaginacionDir = effect(() => {
    this.busqueda();
    this.filtroDir();
    this.ordenDir();
    this.ordenDirAsc();
    untracked(() => this.paginaDir.set(0));
  });

  ngOnInit(): void {
    this.cargarDirectorio();
    // Tiqueteras y fiado son opt-in: sin el interruptor, su API responde 403 y no se pide.
    if (this.permiteCuentas()) {
      this.cargar();
      this.cargarCatalogos();
    }
    // Un pedido confirmado registra (o actualiza) al cliente: el directorio escucha `pedidos`.
    this.destroyRef.onDestroy(
      this.realtime.alCambiar(['pedidos', 'clientes'], () => this.cargarDirectorio({ silencioso: true })),
    );
    this.destroyRef.onDestroy(() => {
      if (this.timerResalte) clearTimeout(this.timerResalte);
    });
    // El scroll vive en `.content` del layout, no en la ventana: se escucha en captura para
    // cerrar el menú contextual, que va fijo y se quedaría flotando lejos de su fila.
    if (isPlatformBrowser(this.platformId)) {
      const alScroll = () => this.alMoverVentana();
      document.addEventListener('scroll', alScroll, true);
      this.destroyRef.onDestroy(() => document.removeEventListener('scroll', alScroll, true));
    }
    this.destroyRef.onDestroy(
      this.realtime.alCambiar(['clientes'], () => {
        if (!this.permiteCuentas()) return;
        this.cargar({ silencioso: true });
        const sel = this.seleccionada();
        if (sel) this.refrescarSeleccionada(sel.id_cuenta, { silencioso: true });
      }),
    );
  }

  // ============================================================
  // Carga
  // ============================================================

  /**
   * Trae todas las cuentas; buscar, filtrar y ordenar pasa aquí, sin volver al servidor.
   *
   * `silencioso` lo usa el tiempo real y las recargas tras guardar: la lista se queda donde
   * está y solo cambian los saldos que cambiaron. El esqueleto de carga sale solo en la
   * primera carga (regla del refresco sin parpadeo), y un fallo no borra lo que ya se veía.
   */
  cargar({ silencioso = false } = {}): void {
    const id = this.negocioId();
    if (!id) return;

    const primera = this.cuentas().length === 0;
    if (primera) this.cargando.set(true);
    this.api.listar(id, { filtro: 'todos', limite: LIMITE_LISTA }).subscribe({
      next: (res) => {
        aplicarLista(this.cuentas, res?.data ?? [], (c) => c.id_cuenta);
        this.errorCarga.set(false);
        this.cargando.set(false);
      },
      error: () => {
        if (primera && !silencioso) this.errorCarga.set(true);
        this.cargando.set(false);
      },
    });
  }

  reintentar(): void {
    this.errorCarga.set(false);
    this.cargar();
  }

  private cargarCatalogos(): void {
    const id = this.negocioId();
    if (!id) return;

    this.catalogo.metodosPago(id).subscribe({
      next: (data) => this.metodosPago.set((data as never[]) ?? []),
      error: () => this.metodosPago.set([]),
    });

    this.catalogo.productos(id).subscribe({
      next: (data) => this.productos.set((data as never[]) ?? []),
      error: () => this.productos.set([]),
    });
  }

  seleccionar(cuenta: CuentaCliente): void {
    this.seleccionada.set(cuenta);
    this.refrescarSeleccionada(cuenta.id_cuenta);
  }

  cerrarDetalle(): void {
    this.seleccionada.set(null);
    this.movimientos.set([]);
  }

  private refrescarSeleccionada(idCuenta: number, { silencioso = false } = {}): void {
    const id = this.negocioId();
    if (!id) return;

    if (!silencioso || this.movimientos().length === 0) this.cargandoMovimientos.set(true);

    this.api.detalle(idCuenta, id).subscribe({
      next: (res) => {
        if (res?.data) aplicarValor(this.seleccionada, res.data);
      },
    });
    this.api.movimientos(idCuenta, id).subscribe({
      next: (res) => {
        aplicarLista(this.movimientos, res?.data ?? [], (m) => m.id_movimiento);
        this.cargandoMovimientos.set(false);
      },
      error: () => {
        if (!silencioso) this.movimientos.set([]);
        this.cargandoMovimientos.set(false);
      },
    });
  }

  // ============================================================
  // Modales
  // ============================================================

  /**
   * Alta de tiquetera/fiado. Desde el directorio llega con el nombre y el teléfono del cliente:
   * el backend resuelve por teléfono la MISMA persona, así la tiquetera queda en su ficha y no
   * en un cliente duplicado.
   */
  abrirNueva(prefill?: { nombre: string; telefono: string | null }): void {
    this.clienteVer.set(null);
    this.formNombre.set(prefill?.nombre ?? '');
    this.formTelefono.set(prefill?.telefono ?? '');
    this.formModo.set('DINERO');
    this.formCupo.set(null);
    this.formNota.set('');
    this.modal.set('nueva');
  }

  abrirEditar(): void {
    const c = this.seleccionada();
    if (!c) return;
    this.formModo.set(c.modo);
    this.formCupo.set(c.cupo || null);
    this.formNota.set(c.nota ?? '');
    this.modal.set('editar');
  }

  abrirAbono(): void {
    this.abonoMonto.set(null);
    this.abonoTiquetes.set(null);
    this.abonoDescuento.set(null);
    this.abonoProducto.set(this.productos()[0]?.id_producto ?? null);
    this.abonoMetodo.set(this.metodosCobrables()[0]?.id_metodo_pago ?? null);
    this.abonoConcepto.set('');
    this.modal.set('abono');
  }

  abrirAjuste(): void {
    this.ajusteTipo.set('ABONO');
    this.ajusteMonto.set(null);
    this.ajusteTiquetes.set(null);
    this.ajusteProducto.set(this.productos()[0]?.id_producto ?? null);
    this.ajusteMotivo.set('');
    this.modal.set('ajuste');
  }

  cerrarModal(): void {
    if (this.guardando()) return;
    this.modal.set(null);
  }

  // ============================================================
  // Acciones
  // ============================================================

  guardarNueva(): void {
    const id = this.negocioId();
    if (!id || this.guardando()) return;

    const nombre = this.formNombre().trim();
    if (nombre.length < 2) {
      this.ui.error('Escribe el nombre del cliente.');
      return;
    }

    this.guardando.set(true);
    this.api.crear({
      id_negocio: id,
      nombre,
      // El teléfono es opcional: media clientela de tiquetera no lo da, y exigirlo llevaría a
      // inventar números. Si lo hay, la cuenta queda enlazada con la ficha de WhatsApp.
      telefono: this.formTelefono().trim() || null,
      modo: this.formModo(),
      cupo: this.formCupo() ?? 0,
      nota: this.formNota().trim() || null,
    }).subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.created('Cuenta creada correctamente.');
        this.cargar({ silencioso: true });
        this.cargarDirectorio({ silencioso: true });
        // La cuenta nueva se ve donde vive: en la sección de tiqueteras.
        this.seccion.set('cuentas');
        if (res?.data) {
          this.resaltar(res.data.id_cuenta);
          this.seleccionar(res.data);
        }
      },
      error: (err) => this.fallo(err, 'No se pudo crear la cuenta.'),
    });
  }

  guardarEdicion(): void {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    this.guardando.set(true);
    this.api.actualizar(cuenta.id_cuenta, {
      id_negocio: id,
      modo: this.formModo(),
      cupo: this.formCupo() ?? 0,
      nota: this.formNota().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.updated('Cuenta actualizada.');
        this.resaltar(cuenta.id_cuenta);
        this.cargar({ silencioso: true });
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo actualizar la cuenta.'),
    });
  }

  guardarAbono(): void {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    const esTiquetes = cuenta.modo === 'TIQUETES';

    if (esTiquetes) {
      if (!this.productoAbono()) {
        this.ui.error('Elige de qué producto es la tiquetera.');
        return;
      }
      const cantidad = Number(this.abonoTiquetes());
      if (!Number.isInteger(cantidad) || cantidad <= 0) {
        this.ui.error('Escribe cuántos tiquetes se compran.');
        return;
      }
      if (this.descuentoTiquetera() >= this.subtotalTiquetera()) {
        this.ui.error('El descuento debe ser menor que el valor de la tiquetera.');
        return;
      }
    } else if (!(Number(this.abonoMonto()) > 0)) {
      this.ui.error('Escribe cuánto dinero está entrando.');
      return;
    }
    if (!this.abonoMetodo()) {
      this.ui.error('Elige con qué está pagando.');
      return;
    }

    this.guardando.set(true);
    this.api.abonar(cuenta.id_cuenta, {
      id_negocio: id,
      id_metodo_pago: Number(this.abonoMetodo()),
      // En tiquetes va solo como referencia: el servidor lo recalcula con el precio de la carta.
      monto: esTiquetes ? this.totalTiquetera() : Number(this.abonoMonto()),
      tiquetes: esTiquetes ? Number(this.abonoTiquetes()) : 0,
      id_producto: esTiquetes ? Number(this.abonoProducto()) : null,
      descuento: esTiquetes ? this.descuentoTiquetera() : 0,
      concepto: this.abonoConcepto().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.success('El dinero quedó registrado en la caja del turno.', 'Abono registrado');
        this.cargar();
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo registrar el abono.'),
    });
  }

  async guardarAjuste(): Promise<void> {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    const motivo = this.ajusteMotivo().trim();
    if (motivo.length < 3) {
      this.ui.error('Un ajuste necesita un motivo escrito.');
      return;
    }

    // Se confirma a propósito: es la única operación que cambia un saldo sin que entre ni
    // salga un peso de la caja, así que nadie debería hacerla sin querer.
    const seguir = await this.ui.confirm({
      title: 'Ajustar el saldo',
      message: 'Esto cambia el saldo del cliente sin que entre ni salga dinero de la caja. ¿Continuar?',
      confirmText: 'Ajustar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!seguir) return;

    this.guardando.set(true);
    this.api.ajustar(cuenta.id_cuenta, {
      id_negocio: id,
      tipo: this.ajusteTipo(),
      monto: cuenta.modo === 'DINERO' ? Number(this.ajusteMonto()) || 0 : 0,
      tiquetes: cuenta.modo === 'TIQUETES' ? Number(this.ajusteTiquetes()) || 0 : 0,
      id_producto: cuenta.modo === 'TIQUETES' ? this.ajusteProducto() : null,
      concepto: motivo,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.updated('Ajuste registrado.');
        this.cargar();
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo registrar el ajuste.'),
    });
  }

  /**
   * Elimina la tiquetera. Se confirma diciendo lo que le queda al cliente, porque eliminarla no
   * le devuelve nada: la plata ya entró a la caja el día que se vendió.
   */
  async eliminarCuenta(): Promise<void> {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    const queda = this.loQueLeQueda(cuenta);
    const seguir = await this.ui.confirm({
      title: 'Eliminar tiquetera',
      message: queda
        ? `${cuenta.cliente} todavía tiene ${queda}. Eliminarla no le devuelve ese valor ni saca dinero de la caja: `
          + 'la cuenta deja de aparecer aquí y en el cobro, y su historial se conserva. ¿Eliminar?'
        : `La cuenta de ${cuenta.cliente} deja de aparecer aquí y en el cobro. Su historial se conserva. ¿Eliminar?`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!seguir) return;

    this.guardando.set(true);
    this.api.eliminar(cuenta.id_cuenta, id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.ui.success('La tiquetera se eliminó.', 'Tiquetera eliminada');
        this.cerrarDetalle();
        this.cargar();
      },
      error: (err) => this.fallo(err, 'No se pudo eliminar la tiquetera.'),
    });
  }

  // ============================================================
  // Presentación
  // ============================================================

  /** El texto de la columna «Tipo de tiquetera». */
  tipoCuenta(cuenta: CuentaCliente): string {
    if (cuenta.modo === 'DINERO') return 'En dinero';
    return cuenta.productos ? `Por producto · ${cuenta.productos}` : 'Por producto';
  }

  /** Cómo se lee el saldo en dinero, sin que el usuario tenga que pensar en signos. */
  etiquetaSaldo(cuenta: CuentaCliente): string {
    if (cuenta.saldo < 0) return 'Debe';
    if (cuenta.saldo > 0) return 'A favor';
    return 'Al día';
  }

  /** Lo que le queda al cliente, en palabras, o `null` si no le queda nada. */
  private loQueLeQueda(cuenta: CuentaCliente): string | null {
    if (cuenta.modo === 'TIQUETES') {
      const quedan = (cuenta.tiquetes ?? []).reduce((suma, t) => suma + t.disponibles, 0)
        || cuenta.tiquetes_restantes
        || 0;
      if (quedan <= 0) return null;
      return quedan === 1 ? '1 tiquete sin usar' : `${quedan} tiquetes sin usar`;
    }
    if (cuenta.saldo > 0) return `$${cuenta.saldo.toLocaleString('es-CO')} a favor`;
    if (cuenta.saldo < 0) return `una deuda de $${Math.abs(cuenta.saldo).toLocaleString('es-CO')}`;
    return null;
  }

  claseSaldo(cuenta: CuentaCliente): string {
    return { debe: 'debe', favor: 'ok', cero: 'neutro' }[this.estadoCuenta(cuenta)];
  }

  /** Tiquetes que le quedan, venga del detalle (por producto) o de la lista (total). */
  restantes(cuenta: CuentaCliente): number {
    if (cuenta.modo !== 'TIQUETES') return 0;
    return cuenta.tiquetes?.length
      ? cuenta.tiquetes.reduce((suma, t) => suma + t.disponibles, 0)
      : (cuenta.tiquetes_restantes ?? cuenta.total_tiquetes ?? 0);
  }

  /**
   * El estado de la cuenta, con el mismo criterio que el filtro del servidor:
   * «a favor» es saldo positivo **o** tiquetes por comer; «debe» solo existe en dinero.
   */
  estadoCuenta(cuenta: CuentaCliente): 'debe' | 'favor' | 'cero' {
    if (cuenta.modo === 'TIQUETES') return this.restantes(cuenta) > 0 ? 'favor' : 'cero';
    if (cuenta.saldo < 0) return 'debe';
    if (cuenta.saldo > 0) return 'favor';
    return 'cero';
  }

  /** Iniciales para el avatar de la fila. */
  iniciales(nombre: string): string {
    const partes = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
    return ((partes[0]?.[0] ?? '') + (partes[1]?.[0] ?? '')).toUpperCase() || '·';
  }

  // ── Búsqueda, filtros y orden ──

  private normalizar(texto: string): string {
    return (texto ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  /**
   * Todo lo que se puede buscar de una cuenta: nombre, teléfono, tipo de tiquetera, productos,
   * saldo (con y sin puntos de miles) y número de tiquetes. «28000», «28.000», «almuerzo» o
   * «debe» encuentran lo que el cajero espera.
   */
  private textoBuscable(c: CuentaCliente): string {
    const saldo = Math.abs(c.saldo);
    return this.normalizar(
      [
        c.cliente,
        c.telefono ?? '',
        this.tipoCuenta(c),
        c.productos ?? '',
        c.modo === 'DINERO' ? `${saldo} ${saldo.toLocaleString('es-CO')} ${this.etiquetaSaldo(c)}` : '',
        c.modo === 'TIQUETES' ? `${c.tiquetes_comprados ?? 0} ${this.restantes(c)} tiquetes` : '',
      ].join(' '),
    );
  }

  private ordenar(lista: CuentaCliente[]): CuentaCliente[] {
    const orden = this.orden();
    // «Prioridad» es el orden del servidor: primero quien debe, luego por nombre.
    if (orden === 'prioridad') return lista;

    const dir = this.ordenAsc() ? 1 : -1;
    const clave = (c: CuentaCliente): number | string => {
      switch (orden) {
        case 'nombre': return this.normalizar(c.cliente);
        case 'saldo': return c.modo === 'DINERO' ? c.saldo : Number.NEGATIVE_INFINITY;
        case 'comprados': return c.modo === 'TIQUETES' ? (c.tiquetes_comprados ?? 0) : -1;
        case 'restantes': return c.modo === 'TIQUETES' ? this.restantes(c) : -1;
      }
    };
    return [...lista].sort((a, b) => {
      const ka = clave(a);
      const kb = clave(b);
      if (typeof ka === 'string' && typeof kb === 'string') return ka.localeCompare(kb) * dir;
      return ((ka as number) - (kb as number)) * dir;
    });
  }

  /** Clic en un encabezado: primero ascendente (nombre) o descendente (cifras); otro clic invierte. */
  ordenarPor(campo: Exclude<Orden, 'prioridad'>): void {
    if (this.orden() === campo) {
      this.ordenAsc.update((v) => !v);
      return;
    }
    this.orden.set(campo);
    this.ordenAsc.set(campo === 'nombre');
  }

  ariaSort(campo: Orden): 'ascending' | 'descending' | 'none' {
    if (this.orden() !== campo) return 'none';
    return this.ordenAsc() ? 'ascending' : 'descending';
  }

  limpiarBusqueda(input?: HTMLInputElement): void {
    this.busqueda.set('');
    input?.focus();
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtro.set('todos');
  }

  irAPagina(p: number): void {
    this.pagina.set(Math.max(0, Math.min(p, this.totalPaginas() - 1)));
  }

  /** Móvil: despliega o recoge la información secundaria de una tarjeta. */
  alternarTarjeta(idCuenta: number): void {
    this.expandida.update((actual) => (actual === idCuenta ? null : idCuenta));
  }

  private resaltar(idCuenta: number): void {
    this.resaltada.set(idCuenta);
    if (this.timerResalte) clearTimeout(this.timerResalte);
    this.timerResalte = setTimeout(() => this.resaltada.set(null), 2600);
  }

  // ── Menú contextual de la fila ──

  abrirMenu(evento: MouseEvent, cuenta: CuentaCliente): void {
    evento.stopPropagation();
    const actual = this.menu();
    if (actual?.cuenta.id_cuenta === cuenta.id_cuenta) {
      this.menu.set(null);
      return;
    }
    // Coordenadas de ventana: el menú va en `position: fixed` para que ni el recorte de la
    // tabla ni el scroll del contenido lo corten en las últimas filas.
    const r = (evento.currentTarget as HTMLElement).getBoundingClientRect();
    const altoMenu = 200;
    const top = r.bottom + altoMenu > window.innerHeight ? r.top - altoMenu - 4 : r.bottom + 4;
    this.menu.set({ cuenta, top: Math.max(8, top), right: window.innerWidth - r.right });
  }

  cerrarMenu(): void {
    this.menu.set(null);
  }

  /**
   * Acción del menú de la fila (o de la tarjeta en móvil, que pasa su cuenta directamente).
   * Las acciones trabajan sobre la cuenta seleccionada: el detalle queda abierto detrás, que es
   * donde se comprueba que el movimiento quedó (mismo flujo que desde el detalle).
   */
  accionMenu(accion: 'ver' | 'abonar' | 'editar' | 'eliminar', cuenta?: CuentaCliente): void {
    const objetivo = cuenta ?? this.menu()?.cuenta;
    this.menu.set(null);
    if (!objetivo) return;
    this.seleccionar(objetivo);
    if (accion === 'abonar') this.abrirAbono();
    if (accion === 'editar') this.abrirEditar();
    if (accion === 'eliminar') void this.eliminarCuenta();
  }

  @HostListener('window:resize')
  alMoverVentana(): void {
    if (this.menu()) this.menu.set(null);
    if (this.menuDir()) this.menuDir.set(null);
  }

  // ============================================================
  // Directorio de clientes (registro automático)
  // ============================================================

  cargarDirectorio({ silencioso = false } = {}): void {
    const id = this.negocioId();
    if (!id) return;

    const primera = this.directorio().length === 0;
    if (primera && !silencioso) this.cargandoDir.set(true);
    this.api.directorio(id).subscribe({
      next: (res) => {
        aplicarLista(this.directorio, res?.data ?? [], (c) => c.id_persona_negocio);
        this.errorDir.set(false);
        this.cargandoDir.set(false);
      },
      error: () => {
        if (primera && !silencioso) this.errorDir.set(true);
        this.cargandoDir.set(false);
      },
    });
  }

  reintentarDirectorio(): void {
    this.errorDir.set(false);
    this.cargarDirectorio();
  }

  cambiarSeccion(seccion: Seccion): void {
    if (seccion === 'cuentas' && !this.permiteCuentas()) return;
    this.menu.set(null);
    this.menuDir.set(null);
    this.expandida.set(null);
    this.seccion.set(seccion);
  }

  ordenarDirPor(campo: Exclude<OrdenDir, 'reciente'>): void {
    if (this.ordenDir() === campo) {
      this.ordenDirAsc.update((v) => !v);
      return;
    }
    this.ordenDir.set(campo);
    this.ordenDirAsc.set(campo === 'nombre');
  }

  ariaSortDir(campo: OrdenDir): 'ascending' | 'descending' | 'none' {
    if (this.ordenDir() !== campo) return 'none';
    return this.ordenDirAsc() ? 'ascending' : 'descending';
  }

  irAPaginaDir(p: number): void {
    this.paginaDir.set(Math.max(0, Math.min(p, this.totalPaginasDir() - 1)));
  }

  limpiarFiltrosDir(): void {
    this.busqueda.set('');
    this.filtroDir.set('todos');
  }

  abrirMenuDir(evento: MouseEvent, cliente: ClienteDirectorio): void {
    evento.stopPropagation();
    if (this.menuDir()?.cliente.id_persona_negocio === cliente.id_persona_negocio) {
      this.menuDir.set(null);
      return;
    }
    const r = (evento.currentTarget as HTMLElement).getBoundingClientRect();
    const altoMenu = 170;
    const top = r.bottom + altoMenu > window.innerHeight ? r.top - altoMenu - 4 : r.bottom + 4;
    this.menuDir.set({ cliente, top: Math.max(8, top), right: window.innerWidth - r.right });
  }

  cerrarMenuDir(): void {
    this.menuDir.set(null);
  }

  /** Clic en la fila: la ficha del cliente con sus datos y lo que se puede hacer con él. */
  verCliente(cliente: ClienteDirectorio): void {
    this.menuDir.set(null);
    this.clienteVer.set(cliente);
  }

  accionDir(accion: 'ver' | 'tiquetera' | 'abrir_tiquetera', cliente?: ClienteDirectorio): void {
    const c = cliente ?? this.menuDir()?.cliente ?? this.clienteVer();
    this.menuDir.set(null);
    if (!c) return;

    if (accion === 'ver') {
      this.verCliente(c);
      return;
    }
    if (accion === 'abrir_tiquetera') {
      this.abrirNueva({ nombre: c.cliente, telefono: c.telefono });
      return;
    }
    // Ver su tiquetera: se cambia de sección y se abre el detalle de la cuenta.
    if (!c.id_cuenta) return;
    this.clienteVer.set(null);
    this.seccion.set('cuentas');
    const cuenta =
      this.cuentas().find((x) => x.id_cuenta === c.id_cuenta) ??
      ({
        id_cuenta: c.id_cuenta,
        id_persona_negocio: c.id_persona_negocio,
        cliente: c.cliente,
        telefono: c.telefono,
        modo: c.modo_cuenta ?? 'DINERO',
        cupo: 0,
        estado: 'A',
        nota: null,
        saldo: 0,
      } as CuentaCliente);
    this.seleccionar(cuenta);
  }

  /** Enlace para escribirle por WhatsApp (el teléfono ya viene en E.164). */
  urlWhatsapp(telefono: string | null): string | null {
    if (!telefono) return null;
    return `https://wa.me/${telefono.replace(/\D/g, '')}`;
  }

  /** «Hoy», «Ayer», «Hace 5 días» o la fecha: se lee más rápido que un timestamp. */
  haceCuanto(fecha: string | null): string {
    if (!fecha) return '';
    const d = new Date(fecha);
    const hoy = new Date();
    const dias = Math.floor(
      (Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()) -
        Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000,
    );
    if (dias <= 0) return 'Hoy';
    if (dias === 1) return 'Ayer';
    if (dias < 7) return `Hace ${dias} días`;
    return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  private textoBuscableDir(c: ClienteDirectorio): string {
    const tel = c.telefono ?? '';
    return this.normalizar(
      [
        c.cliente,
        tel,
        tel.replace(/^\+57/, ''),
        c.origen === 'PEDIDO' ? 'carta pedido' : 'manual',
        c.modo_cuenta === 'DINERO' ? 'tiquetera en dinero' : '',
        c.modo_cuenta === 'TIQUETES' ? 'tiquetera por producto' : '',
      ].join(' '),
    );
  }

  private ordenarDir(lista: ClienteDirectorio[]): ClienteDirectorio[] {
    const orden = this.ordenDir();
    if (orden === 'reciente') return lista; // orden del servidor: último pedido primero
    const dir = this.ordenDirAsc() ? 1 : -1;
    return [...lista].sort((a, b) => {
      switch (orden) {
        case 'nombre':
          return this.normalizar(a.cliente).localeCompare(this.normalizar(b.cliente)) * dir;
        case 'pedidos':
          return (a.pedidos - b.pedidos) * dir;
        case 'total':
          return (a.total_gastado - b.total_gastado) * dir;
        case 'ultimo':
          return (
            (new Date(a.ultimo_pedido ?? 0).getTime() - new Date(b.ultimo_pedido ?? 0).getTime()) *
            dir
          );
      }
    });
  }

  private esNuevo(c: ClienteDirectorio): boolean {
    return Date.now() - new Date(c.registrado_en).getTime() < DIAS_NUEVO * 86_400_000;
  }

  @HostListener('document:keydown.escape')
  alPulsarEscape(): void {
    if (this.menu()) this.menu.set(null);
    else if (this.menuDir()) this.menuDir.set(null);
    else if (this.clienteVer() && !this.modal()) this.clienteVer.set(null);
    else if (this.modal()) this.cerrarModal();
    else if (this.seleccionada()) this.cerrarDetalle();
  }

  private fallo(err: HttpErrorResponse, porDefecto: string): void {
    this.guardando.set(false);
    this.ui.error(err?.error?.message || porDefecto);
  }
}
