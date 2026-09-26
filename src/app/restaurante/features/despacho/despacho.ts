import {
  Component, ChangeDetectionStrategy, DestroyRef, LOCALE_ID, OnInit, effect, inject, signal, computed, PLATFORM_ID,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CurrencyPipe, DatePipe, isPlatformBrowser } from '@angular/common';
import { Observable, Subject, forkJoin, of } from 'rxjs';
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators';
import { LucideAngularModule } from 'lucide-angular';

import { Router } from '@angular/router';

import { AuthService } from '../../../core/services/auth.service';
import { CajaService } from '../../../core/services/caja.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { aplicarLista } from '../../../core/utils/refresco-vivo';
import { ClientesService, CuentaCliente } from '../../../core/services/clientes.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { VistaTarjetasService } from '../../../core/services/vista-tarjetas.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { etiquetaFecha } from './etiqueta-fecha';
import { environment } from '../../../../environments/environment';
import {
  FilaPago,
  MultipagoSelectorComponent,
  PagoSeleccion,
} from '../../shared/multipago-selector/multipago-selector';

type TipoPedido = 'MESA' | 'LLEVAR' | 'DOMICILIO';
/**
 * Los filtros del despacho.
 *
 * `WHATSAPP` es distinto de los otros dos y conviene saberlo: LLEVAR y DOMICILIO filtran por el
 * **tipo** de pedido, y WhatsApp por su **origen**. Se cruzan a propósito — un pedido del bot es
 * además para llevar o a domicilio, y aparece en los dos sitios. No son pestañas excluyentes que
 * repartan la lista: son tres maneras de mirar la misma.
 */
type FiltroTipo = 'TODOS' | 'LLEVAR' | 'DOMICILIO' | 'WHATSAPP' | 'CANCELADOS';

/** Espera tras la última tecla antes de guardar domicilio o descuento. */
const AUTOGUARDADO_MS = 500;

/** Dónde se recuerda qué cancelados ya se «finalizaron» (se quitaron de la pantalla) en este equipo. */
const CANCELADOS_FINALIZADOS_KEY = 'despacho_cancelados_finalizados_v1';

interface DetalleDespacho {
  id_producto: number;
  cantidad: number;
  precio_unitario: number;
  nota?: string | null;
  producto?: { nombre: string };
  /** Los ingredientes que el cliente pidió quitar: cada uno trae su nombre. */
  exclusiones?: Array<{ id_ingrediente: number; ingrediente?: { nombre: string } | null }>;
}

export interface PedidoDespacho {
  id_orden: number;
  numero_orden: string;
  id_metodo_pago?: number | null;
  /** Cuenta de cliente elegida al tomar el pedido (tiquetera o fiado). */
  id_cuenta?: number | null;
  tipo_pedido: TipoPedido;
  total: number;
  valor_domicilio?: number | string | null;
  descuento?: number | string | null;
  fecha_creacion: string;
  estado: string;
  estado_cocina: string | null;
  estado_pago: string;
  nota?: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  direccion_domicilio: string | null;
  nota_domicilio: string | null;
  id_domiciliario: number | null;
  /**
   * Lo tomó el asistente de WhatsApp **y este negocio tiene el asistente en su plan**.
   *
   * No es una columna: el backend lo deduce de quién figura como autor de la orden (los pedidos
   * del bot nacen a nombre del usuario «Asistente» del negocio). Puede faltar si el backend es
   * anterior a este cambio — por eso es opcional y se lee como falso.
   *
   * Las dos cosas en una bandera a propósito: sin la feature, esta parte de la pantalla no debe
   * existir —ni filtro, ni etiqueta, ni botón—, y apagarla por trozos dejaría media función de
   * pago asomando. El backend la calcula; aquí solo se pinta.
   */
  de_whatsapp?: boolean;
  /**
   * ¿Se le puede ofrecer el aviso de «ya está listo»?
   *
   * Lo decide el **backend**, y por eso aquí no se recalcula. Son cuatro condiciones y una de
   * ellas es comercial (el plan): repetirlas en la pantalla garantiza que un día discrepen, y el
   * lado que discrepe sería el que ofrece un botón que el backend rechaza.
   */
  puede_avisar_listo?: boolean;
  /**
   * Cuándo se **intentó** avisar al cliente. `null` = todavía no se ha intentado.
   *
   * Ojo con el verbo: intentar no es llegar. El primer aviso real de producción quedó marcado
   * aquí y su mensaje murió en dead letter, así que la pantalla decía «Avisado» sobre alguien
   * que no había recibido nada. Para saber qué pasó de verdad está `aviso_listo_estado`.
   */
  aviso_listo_en?: string | null;
  /**
   * Qué pasó con ese mensaje: `entregado`, `pendiente` (en cola), `fallido`, o `null` si ya no
   * se puede consultar. Lo resuelve el backend leyendo el Ledger.
   */
  aviso_listo_estado?: 'entregado' | 'pendiente' | 'fallido' | null;
  domiciliario?: {
    id_usuario: number;
    primer_nombre: string;
    primer_apellido: string;
  } | null;
  usuario?: {
    id_usuario: number;
    primer_nombre: string;
    primer_apellido: string;
  };
  detalles?: DetalleDespacho[];
  /** Desglose de multipago: el elegido al tomar el pedido, o el ya cobrado. */
  pagos?: { id_metodo_pago: number; valor: number | string }[];
}

/**
 * Un pedido cancelado HOY, tal como lo devuelve `GET /despacho/cancelados`.
 *
 * Deliberadamente más flaco que `PedidoDespacho`: esto es una alerta de lo que acaba de pasar
 * en el turno, no una tarjeta para operar — no se cobra, no se edita, no se imprime. Lo único
 * que importa es que se sepa que pasó y quién lo hizo.
 */
export interface PedidoCancelado {
  id_orden: number;
  numero_orden: string;
  tipo_pedido: TipoPedido;
  total: number;
  contacto_nombre: string | null;
  /** Quién lo canceló: el propio negocio desde el panel, o el cliente por WhatsApp. */
  cancelado_por: 'cliente' | 'negocio' | null;
  fecha_cierre: string;
}

@Component({
  selector: 'app-despacho',
  imports: [LucideAngularModule, CurrencyPipe, DatePipe, MultipagoSelectorComponent],
  templateUrl: './despacho.html',
  styleUrl: './despacho.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DespachoComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly cajaSvc = inject(CajaService);
  private readonly realtime = inject(RealtimeService);
  private readonly clientesApi = inject(ClientesService);
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly uiFeedback = inject(UiFeedbackService);
  private readonly router = inject(Router);
  private readonly vista = inject(VistaTarjetasService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  readonly pedidos = signal<PedidoDespacho[]>([]);
  /** «cebolla, tomate»: lo que el cliente pidió quitar de una línea, o `''` si no pidió quitar nada. */
  textoSin(d: DetalleDespacho): string {
    return (d.exclusiones ?? [])
      .map((e) => e.ingrediente?.nombre)
      .filter((n): n is string => Boolean(n))
      .join(', ');
  }

  /** Solo la primera carga. Los refrescos del tiempo real no tapan el listado. */
  readonly cargando = signal(false);
  readonly refrescando = signal(false);
  /**
   * Los cancelados de HOY. Viven aparte de `pedidos` (son otro endpoint y no se pueden cobrar ni
   * editar), pero se pintan en la misma cuadrícula como una tarjeta más, marcada «Cancelado».
   */
  readonly canceladosRecientes = signal<PedidoCancelado[]>([]);
  /**
   * Cancelados que el usuario ya «finalizó» (quitó de la pantalla). Se guarda en el equipo: el
   * servidor solo devuelve los de hoy, así que al cambiar el día se vacía solo.
   */
  private readonly canceladosFinalizados = signal<ReadonlySet<number>>(new Set());
  readonly filtro = signal<FiltroTipo>('TODOS');
  readonly pedidoActivo = signal<PedidoDespacho | null>(null);
  readonly cobrandoId = signal<number | null>(null);
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string; es_cuenta?: boolean }>>([]);
  /** Cuentas de cliente: despacho también cobra, y también contra una tiquetera. */
  readonly cuentasCliente = signal<CuentaCliente[]>([]);
  readonly metodoPagoSeleccionado = signal<number | null>(null);
  readonly pagoSeleccion = signal<PagoSeleccion | null>(null);
  /** Para el selector de "cambiar domiciliario". Antes solo se podía fijar al crear el pedido. */
  readonly domiciliariosDisponibles = signal<Array<{ id_usuario: number; nombre: string }>>([]);
  readonly asignandoDomiciliarioId = signal<number | null>(null);

  // ── Cobro del domicilio desde despacho ──
  /** Texto en crudo del campo; se normaliza al guardar. */
  readonly domicilioInput = signal('');
  readonly guardandoDomicilio = signal(false);

  /** El pedido cuyo aviso está en vuelo. Bloquea el botón mientras tanto. */
  readonly avisandoId = signal<number | null>(null);

  // ── Descuento desde despacho (mismo criterio que el domicilio) ──
  readonly descuentoInput = signal('');
  readonly guardandoDescuento = signal(false);

  /**
   * Los dos ajustes se guardan solos mientras se escribe: sin botón, el total del
   * pedido y su desglose se actualizan al vuelo. Cada campo tiene su propio canal
   * —con `switchMap` una petición cancela la anterior— para que editar uno no
   * anule el guardado del otro.
   */
  private readonly domicilioEditado$ = new Subject<{ idOrden: number; valor: number }>();
  private readonly descuentoEditado$ = new Subject<{ idOrden: number; valor: number }>();

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly permiteMultipago = computed(() => this.auth.permiteMultipago());
  /** Opt-in del negocio (Configuración → Domicilios): sin él no se ve el campo. */
  readonly permitePagoDomicilio = computed(() => this.auth.permitePagoDomicilio());
  /** Opt-in del negocio (Configuración → Descuentos): sin él no se ve el campo. */
  readonly permiteDescuento = computed(() => this.auth.permiteDescuento());
  readonly puedeVerTodos = computed(() => this.auth.canAccessSubnivel('despacho_ver_todos'));
  readonly puedeCancelarNoPagados = computed(() => this.auth.canAccessSubnivel('despacho_cancelar_no_pagado'));
  readonly puedeUsarDomicilio = computed(() => this.auth.canAccessSubnivel('pedidos_domicilio'));
  /**
   * ¿Quien mira es un repartidor y nada más? Sus tarjetas son solo domicilios asignados a él, así
   * que ni los «Para llevar» ni el botón de imprimir (el tiquete lo saca el local) le sirven.
   */
  readonly esDomiciliario = computed(() => {
    const roles = [
      ...(this.auth.negocio()?.roles ?? []),
      ...(this.auth.session()?.roles_globales ?? []),
    ];
    return roles.length > 0 && roles.every((r) => String(r.descripcion).toUpperCase() === 'DOMICILIARIO');
  });
  /** Sin «ver todos» o siendo repartidor no hay pedidos para llevar que mostrar. */
  readonly muestraLlevar = computed(() => this.puedeVerTodos() && !this.esDomiciliario());
  readonly puedeEditarPedido = computed(() => this.auth.canAccessRoute('/pedidos'));

  // ── Preferencias de vista (por dispositivo, ver VistaTarjetasService) ──
  // En el teléfono arranca en «mediana» (2 por fila) si el usuario aún no eligió tamaño; lo que
  // elija se guarda y manda sobre este valor.
  readonly densidad = this.vista.densidad('despacho', 'compacta');
  readonly verProductos = this.vista.verProductos('despacho');
  readonly densidadIcono = computed(() => {
    const d = this.densidad();
    if (d === 'normal') return 'layout-grid';
    return d === 'compacta' ? 'grid-3x3' : 'list';
  });
  readonly densidadTitulo = computed(() => {
    const d = this.densidad();
    if (d === 'normal') return 'Tarjetas grandes — clic para achicar';
    if (d === 'compacta') return 'Tarjetas medianas — clic para achicar más';
    return 'Tarjetas pequeñas — clic para volver al tamaño original';
  });

  readonly pedidosFiltrados = computed(() => {
    const f = this.filtro();
    const lista = this.pedidos();
    if (f === 'TODOS') return lista;
    // «Cancelados» solo enseña los cancelados: los pedidos vivos no entran.
    if (f === 'CANCELADOS') return [];
    if (f === 'WHATSAPP') return lista.filter((p) => p.de_whatsapp);
    return lista.filter((p) => p.tipo_pedido === f);
  });

  /** Cancelados de hoy que siguen en pantalla (no finalizados). */
  readonly canceladosVisibles = computed(() => {
    const finalizados = this.canceladosFinalizados();
    return this.canceladosRecientes().filter(
      (c) => !finalizados.has(c.id_orden) && (c.tipo_pedido !== 'DOMICILIO' || this.puedeUsarDomicilio()),
    );
  });

  /** Los cancelados que corresponden al filtro activo. Los de WhatsApp no se distinguen aquí. */
  readonly canceladosFiltrados = computed(() => {
    const f = this.filtro();
    const lista = this.canceladosVisibles();
    if (f === 'TODOS' || f === 'CANCELADOS') return lista;
    if (f === 'WHATSAPP') return [];
    return lista.filter((c) => c.tipo_pedido === f);
  });

  // Los contadores de los filtros cuentan también los cancelados visibles: si no, la tarjeta
  // «Cancelado» aparecería en la lista con un número que no la incluye.
  readonly countTodos = computed(() => this.pedidos().length + this.canceladosVisibles().length);
  readonly countLlevar = computed(() =>
    this.pedidos().filter((p) => p.tipo_pedido === 'LLEVAR').length
    + this.canceladosVisibles().filter((c) => c.tipo_pedido === 'LLEVAR').length,
  );
  readonly countDomicilio = computed(() =>
    this.pedidos().filter((p) => p.tipo_pedido === 'DOMICILIO').length
    + this.canceladosVisibles().filter((c) => c.tipo_pedido === 'DOMICILIO').length,
  );
  readonly countWhatsapp = computed(() => this.pedidos().filter((p) => p.de_whatsapp).length);
  readonly countCancelados = computed(() => this.canceladosVisibles().length);

  /**
   * El chip de «Cancelados» se esconde cuando no queda ninguno (todos finalizados, o cambió el
   * día), y el filtro no puede sobrevivirle: se quedaría la pantalla vacía sin chip para salir.
   */
  private readonly filtroCanceladosEffect = effect(() => {
    if (this.countCancelados() === 0 && this.filtro() === 'CANCELADOS') {
      this.filtro.set('TODOS');
    }
  });

  /** Si el negocio apaga Domicilios, el filtro activo no puede quedarse ahí colgado. */
  private readonly filtroPermisoEffect = effect(() => {
    if (!this.puedeUsarDomicilio() && this.filtro() === 'DOMICILIO') {
      this.filtro.set('TODOS');
    }
  });

  /**
   * El chip de WhatsApp se esconde cuando no queda ninguno, y el filtro no puede sobrevivirle.
   *
   * Pasa solo: se despacha el último pedido del bot, el chip desaparece —y sin esto la pantalla
   * se queda vacía con el filtro puesto en algo que ya no se ve, o sea sin manera de volver.
   */
  private readonly filtroWhatsappEffect = effect(() => {
    if (this.countWhatsapp() === 0 && this.filtro() === 'WHATSAPP') {
      this.filtro.set('TODOS');
    }
  });

  ngOnInit(): void {
    this.canceladosFinalizados.set(this.leerCanceladosFinalizados());
    this.cargar();
    this.loadMetodosPago();
    this.loadDomiciliarios();
    // Despacho también cobra, así que necesita saber si hay turno abierto. Sin esto
    // dependía de que el usuario hubiera pasado antes por POS o por Caja: entrando
    // directo aquí, el estado seguía vacío y el cobro se rechazaba con «caja cerrada».
    const idNegocioCaja = this.negocioId();
    if (idNegocioCaja) {
      this.cajaSvc.asegurarCargada(idNegocioCaja);
      this.loadCuentasCliente(idNegocioCaja);
    }

    this.cargarCancelados();

    // Despacho es la pantalla que espera a cocina: en cuanto marcan un plato listo, aquí
    // tiene que verse. Y los pedidos que entran por WhatsApp aparecen por este mismo camino —
    // igual que una cancelación del cliente, que es la que nadie del negocio disparó.
    this.destroyRef.onDestroy(
      this.realtime.alCambiar(['pedidos'], () => {
        this.cargar();
        this.cargarCancelados();
      }),
    );

    this.domicilioEditado$
      .pipe(
        debounceTime(AUTOGUARDADO_MS),
        switchMap(({ idOrden, valor }) => this.guardarValorDomicilio(idOrden, valor)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    this.descuentoEditado$
      .pipe(
        debounceTime(AUTOGUARDADO_MS),
        switchMap(({ idOrden, valor }) => this.guardarDescuento(idOrden, valor)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }

  private loadCuentasCliente(idNegocio: number): void {
    // Ver `pedidos.ts`: sin el interruptor encendido no hay a quién preguntar.
    if (!this.auth.permiteCuentasCliente()) return;
    this.clientesApi.listar(idNegocio).subscribe({
      next: (res) => aplicarLista(this.cuentasCliente, res?.data ?? [], (c) => c.id_cuenta),
      error: () => { /* se conserva la lista que ya estaba */ },
    });
  }

  private loadMetodosPago(): void {
    const id = this.negocioId();
    if (!id) return;
    this.catalogo.metodosPago(id).subscribe({
      next: (data) => this.metodosPago.set(data ?? []),
      error: () => this.metodosPago.set([]),
    });
  }

  private loadDomiciliarios(): void {
    const id = this.negocioId();
    if (!id || !this.puedeUsarDomicilio()) return;
    this.catalogo.domiciliarios(id).subscribe({
      next: (data) => this.domiciliariosDisponibles.set(data ?? []),
      error: () => this.domiciliariosDisponibles.set([]),
    });
  }

  /**
   * Trae los pedidos en curso.
   *
   * Despacho es la pantalla que más avisos recibe (cada plato que cocina marca listo es uno),
   * así que aquí el repintado se nota más que en ninguna otra. Por eso el listado NO se
   * desmonta al refrescar: solo se enciende «Cargando» si todavía no hay nada, y los pedidos
   * se fusionan uno a uno — el que no cambió conserva su objeto y su tarjeta se queda quieta.
   */
  cargar(): void {
    const id = this.negocioId();
    if (!id) return;

    const esPrimeraCarga = this.pedidos().length === 0;
    if (esPrimeraCarga) this.cargando.set(true);
    this.refrescando.set(true);

    const url = `${environment.apiUrl}/despacho?id_negocio=${id}`;

    this.http.get<{ success: boolean; data: PedidoDespacho[] }>(url).subscribe({
      next: (res) => {
        aplicarLista(this.pedidos, res?.data ?? [], (p) => p.id_orden);
        this.cargando.set(false);
        this.refrescando.set(false);
      },
      error: () => {
        this.cargando.set(false);
        this.refrescando.set(false);
        // Si ya había pedidos en pantalla se quedan: un corte de red no vacía el despacho, y
        // el aviso de error tampoco hace falta ahí — el siguiente refresco lo arregla solo.
        if (esPrimeraCarga) {
          this.uiFeedback.error('No se pudieron cargar los pedidos de despacho.');
        }
      },
    });
  }

  private cargarCancelados(): void {
    const id = this.negocioId();
    if (!id) return;

    const url = `${environment.apiUrl}/despacho/cancelados?id_negocio=${id}`;
    this.http.get<{ success: boolean; data: PedidoCancelado[] }>(url).subscribe({
      next: (res) => {
        const lista = res?.data ?? [];
        aplicarLista(this.canceladosRecientes, lista, (p) => p.id_orden);
        this.podarCanceladosFinalizados(lista);
      },
      // Silencioso a propósito: es información extra, no la pantalla principal. Si falla,
      // Despacho sigue funcionando igual que antes de que esto existiera — y se queda con lo
      // que ya tenía, que es mejor que vaciar el panel por un error de red.
      error: () => {},
    });
  }

  seleccionarFiltro(f: FiltroTipo): void {
    this.filtro.set(f);
  }

  /** «Finalizar» en una tarjeta cancelada: la quita de la pantalla. No toca el pedido en el servidor. */
  finalizarCancelado(c: PedidoCancelado, event: Event): void {
    event.stopPropagation();
    this.canceladosFinalizados.update((s) => new Set(s).add(c.id_orden));
    this.guardarCanceladosFinalizados();
  }

  private leerCanceladosFinalizados(): ReadonlySet<number> {
    if (!this.isBrowser) return new Set();
    try {
      const crudo = JSON.parse(localStorage.getItem(CANCELADOS_FINALIZADOS_KEY) ?? '[]');
      return new Set(Array.isArray(crudo) ? crudo.filter((n): n is number => Number.isInteger(n)) : []);
    } catch {
      return new Set();
    }
  }

  private guardarCanceladosFinalizados(): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(CANCELADOS_FINALIZADOS_KEY, JSON.stringify([...this.canceladosFinalizados()]));
    } catch {
      // Modo privado o almacenamiento lleno: se recuerda solo mientras la pestaña siga abierta.
    }
  }

  /** Olvida los finalizados que el servidor ya no devuelve (de otro día): la lista no crece sin fin. */
  private podarCanceladosFinalizados(vigentes: PedidoCancelado[]): void {
    const actuales = this.canceladosFinalizados();
    if (actuales.size === 0) return;
    const ids = new Set(vigentes.map((c) => c.id_orden));
    const restantes = [...actuales].filter((id) => ids.has(id));
    if (restantes.length === actuales.size) return;
    this.canceladosFinalizados.set(new Set(restantes));
    this.guardarCanceladosFinalizados();
  }

  /** Quién lo canceló, en una palabra que el negocio entienda. */
  canceladoPorLabel(p: PedidoCancelado): string {
    return p.cancelado_por === 'cliente' ? 'Lo canceló el cliente' : 'Cancelado en el negocio';
  }

  rotarDensidad(): void {
    this.vista.rotarDensidad('despacho');
  }

  setVerProductos(valor: boolean): void {
    this.vista.setVerProductos('despacho', valor);
  }

  /** Solo se edita lo que aún no se cobró: tocar un pedido pagado descuadraría la caja. */
  puedeEditar(p: PedidoDespacho): boolean {
    return this.puedeEditarPedido() && this.esPendientePago(p);
  }

  /**
   * Abre el pedido en el POS con sus productos ya cargados.
   * Pedidos lo detecta por query param (ver `aplicarEdicionDesdeQueryParams`).
   */
  editarPedido(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    if (!this.puedeEditar(p)) return;

    void this.router.navigate(['/pedidos'], {
      queryParams: { editar: p.id_orden, tipo: p.tipo_pedido },
    });
  }

  /**
   * "ORD-0004" → "0004". En la tarjeta el prefijo solo gasta ancho (es el mismo para
   * todas); el modal y el tiquete sí conservan el número completo.
   */
  ordenCorto(numeroOrden: string): string {
    const corto = String(numeroOrden ?? '').replace(/^[A-Za-z]+[-_]/, '');
    return corto || numeroOrden;
  }

  valorDomicilio(p: PedidoDespacho): number {
    const valor = Number(p.valor_domicilio ?? 0);
    return Number.isFinite(valor) && valor > 0 ? valor : 0;
  }

  descuento(p: PedidoDespacho): number {
    const valor = Number(p.descuento ?? 0);
    return Number.isFinite(valor) && valor > 0 ? valor : 0;
  }

  /** Lo que costaron los productos: el total ya trae sumado el domicilio y restada la rebaja. */
  subtotalProductos(p: PedidoDespacho): number {
    return Number(p.total) - this.valorDomicilio(p) + this.descuento(p);
  }

  abrirPedido(p: PedidoDespacho): void {
    this.pedidoActivo.set(p);
    this.metodoPagoSeleccionado.set(p.id_metodo_pago ?? null);
    this.pagoSeleccion.set(null);
    const valor = this.valorDomicilio(p);
    this.domicilioInput.set(valor > 0 ? String(valor) : '');
    const rebaja = this.descuento(p);
    this.descuentoInput.set(rebaja > 0 ? String(rebaja) : '');
  }

  cerrarPedido(): void {
    this.pedidoActivo.set(null);
    this.metodoPagoSeleccionado.set(null);
    this.pagoSeleccion.set(null);
    this.domicilioInput.set('');
    this.guardandoDomicilio.set(false);
    this.descuentoInput.set('');
    this.guardandoDescuento.set(false);
  }

  // ── Valor del domicilio ──

  /**
   * ¿Se puede poner (o corregir) el valor del domicilio de este pedido?
   *
   * Hasta ahora solo se podía al tomar el pedido, y un domiciliario que descubre
   * el recargo al llegar tenía que devolverse al POS. Se exige pedido sin cobrar:
   * mover el total de uno ya pagado descuadraría la caja, y el backend lo rechaza
   * igualmente (ORDEN_PAGADA).
   */
  puedeCobrarDomicilio(p: PedidoDespacho): boolean {
    return this.permitePagoDomicilio() && this.puedeUsarDomicilio() && this.esPendientePago(p);
  }

  /**
   * Cada tecla programa el guardado; el `debounceTime` espera a que pare de escribir.
   * Se emite SIEMPRE (aunque el valor coincida con el guardado) y se descarta luego
   * en el pipeline: filtrar aquí dejaba pasar un valor intermedio como último evento
   * cuando el usuario volvía atrás, y se guardaba algo distinto de lo que se veía.
   */
  setDomicilioInput(rawValue: string): void {
    this.domicilioInput.set(rawValue);

    const p = this.pedidoActivo();
    if (!p || !this.puedeCobrarDomicilio(p)) return;

    this.guardandoDomicilio.set(true);
    this.domicilioEditado$.next({ idOrden: p.id_orden, valor: this.parseMonto(rawValue) });
  }

  /** Solo dígitos: el campo acepta "12.000" o "$12000" y se queda con 12000. */
  private parseMonto(rawValue: string): number {
    const digits = String(rawValue ?? '').replace(/\D/g, '');
    return digits ? Number(digits) : 0;
  }

  /**
   * ¿Se le puede ofrecer el aviso? La respuesta la da el backend, entera.
   *
   * Allí se comprueban las condiciones —el plan incluye el asistente, el pedido vino por
   * WhatsApp y no se le ha avisado ya— y se vuelven a comprobar al pulsar. Aquí solo se lee.
   * Sirve tanto para LLEVAR como para DOMICILIO, cada uno con su propio texto — ver
   * `etiquetaAvisar`.
   */
  puedeAvisarListo(p: PedidoDespacho): boolean {
    return Boolean(p.puede_avisar_listo);
  }

  /**
   * La acción que ocupa el botón de ancho completo de la tarjeta. Solo una, para que todas las
   * tarjetas terminen igual: avisar al cliente (si el backend lo permite) → cobrar (abre el detalle,
   * donde se elige la forma de pago) → finalizar un pedido ya cobrado.
   */
  accionPrincipal(p: PedidoDespacho): 'avisar' | 'cobrar' | 'finalizar' {
    if (this.puedeAvisarListo(p)) return 'avisar';
    return this.esPendientePago(p) ? 'cobrar' : 'finalizar';
  }

  /** El texto del botón cambia según qué le está pasando al cliente, no solo si puede avisarse. */
  etiquetaAvisar(p: PedidoDespacho): string {
    return p.tipo_pedido === 'DOMICILIO' ? 'Avisar que va en camino' : 'Avisar que está listo';
  }

  /**
   * Le manda al cliente «tu pedido ya está listo».
   *
   * **Cuesta dinero**: es una plantilla de WhatsApp y Meta se la cobra al negocio. Por eso el
   * botón se bloquea en cuanto se pulsa (`avisandoId`) y se apaga para siempre en cuanto el
   * backend confirma. El candado de verdad está allí; esto solo evita el doble clic obvio.
   */
  /** El aviso salió y murió por el camino: se puede —y se debe— volver a intentarlo. */
  avisoFallido(p: PedidoDespacho): boolean {
    return Boolean(p.aviso_listo_en) && p.aviso_listo_estado === 'fallido';
  }

  /** Se avisó y el mensaje sigue vivo (entregado, o en cola). */
  avisoHecho(p: PedidoDespacho): boolean {
    return Boolean(p.aviso_listo_en) && p.aviso_listo_estado !== 'fallido';
  }

  avisarListo(p: PedidoDespacho, ev?: Event): void {
    ev?.stopPropagation();
    if (!this.puedeAvisarListo(p) || this.avisandoId() !== null) return;

    this.avisandoId.set(p.id_orden);
    this.http.post<{ success: boolean; data?: { avisado_en?: string } }>(
      `${environment.apiUrl}/despacho/${p.id_orden}/avisar-listo`,
      { id_negocio: this.negocioId() }
    ).subscribe({
      next: (res) => {
        const avisadoEn = res?.data?.avisado_en ?? new Date().toISOString();
        const apply = (ord: PedidoDespacho) =>
          ord.id_orden === p.id_orden
            ? {
                ...ord,
                aviso_listo_en: avisadoEn,
                // Recién creado: está en cola, todavía no entregado. Decir «entregado» aquí
                // sería adelantar una noticia que aún no tenemos.
                aviso_listo_estado: 'pendiente' as const,
                puede_avisar_listo: false,
              }
            : ord;

        this.pedidos.update((lista) => lista.map(apply));
        const activo = this.pedidoActivo();
        if (activo?.id_orden === p.id_orden) this.pedidoActivo.set(apply(activo));

        this.avisandoId.set(null);
        this.uiFeedback.success('Le avisamos al cliente por WhatsApp.', 'Pedido listo');
      },
      error: (err: HttpErrorResponse) => {
        this.avisandoId.set(null);
        // El backend ya escribe estos mensajes para que los lea quien apretó el botón (no tiene
        // conversación, pidió la baja, ya se le avisó): se enseñan tal cual.
        this.uiFeedback.error(err?.error?.message || 'No se pudo avisar al cliente.');
      },
    });
  }

  /**
   * Asigna o cambia el domiciliario de un pedido a domicilio.
   *
   * Hasta ahora esto solo se podía fijar al tomar el pedido: un domiciliario asignado por el
   * bot (al azar, o por turno) o por error en el mostrador se quedaba así para siempre. Con
   * esto el negocio lo corrige sin tener que cancelar y volver a tomar el pedido entero.
   */
  cambiarDomiciliario(p: PedidoDespacho, idRaw: string): void {
    const idDomiciliario = Number(idRaw);
    if (!idDomiciliario || idDomiciliario === p.id_domiciliario) return;

    this.asignandoDomiciliarioId.set(p.id_orden);
    this.http.patch<{ success: boolean; data?: { domiciliario?: PedidoDespacho['domiciliario'] } }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/domiciliario`,
      { id_negocio: this.negocioId(), id_domiciliario: idDomiciliario },
    ).subscribe({
      next: (res) => {
        const apply = (ord: PedidoDespacho) =>
          ord.id_orden === p.id_orden
            ? { ...ord, id_domiciliario: idDomiciliario, domiciliario: res?.data?.domiciliario ?? ord.domiciliario }
            : ord;

        this.pedidos.update((lista) => lista.map(apply));
        const activo = this.pedidoActivo();
        if (activo?.id_orden === p.id_orden) this.pedidoActivo.set(apply(activo));

        this.asignandoDomiciliarioId.set(null);
        this.uiFeedback.success('Domiciliario actualizado.');
      },
      error: (err: HttpErrorResponse) => {
        this.asignandoDomiciliarioId.set(null);
        this.uiFeedback.error(err?.error?.message || 'No se pudo cambiar el domiciliario.');
      },
    });
  }

  private guardarValorDomicilio(idOrden: number, valor: number): Observable<unknown> {
    const guardado = this.pedidos().find((ord) => ord.id_orden === idOrden);
    if (guardado && valor === this.valorDomicilio(guardado)) {
      this.guardandoDomicilio.set(false);
      return of(null);
    }

    return this.http.patch<{ success: boolean; data?: { total?: number; valor_domicilio?: number } }>(
      `${environment.apiUrl}/pedidos/${idOrden}/valor-domicilio`,
      { id_negocio: this.negocioId(), valor_domicilio: valor }
    ).pipe(
      tap((res) => {
        // El total lo recalcula el backend (productos + domicilio - descuento):
        // se toma de la respuesta en vez de sumarlo aquí, para no discrepar.
        this.aplicarAjuste(idOrden, {
          valor_domicilio: Number(res?.data?.valor_domicilio ?? valor),
          total: res?.data?.total,
        });
        this.guardandoDomicilio.set(false);
      }),
      catchError((err: HttpErrorResponse) => {
        this.guardandoDomicilio.set(false);
        const guardado = this.pedidos().find((ord) => ord.id_orden === idOrden);
        const actual = guardado ? this.valorDomicilio(guardado) : 0;
        this.domicilioInput.set(actual > 0 ? String(actual) : '');
        this.uiFeedback.error(err?.error?.message || 'No se pudo actualizar el valor del domicilio.');
        return of(null);
      }),
      map(() => null),
    );
  }

  /** Vuelca el total recalculado (y el campo tocado) sobre la lista y el modal. */
  private aplicarAjuste(
    idOrden: number,
    cambios: { valor_domicilio?: number; descuento?: number; total?: number },
  ): void {
    const apply = (ord: PedidoDespacho): PedidoDespacho =>
      ord.id_orden === idOrden
        ? { ...ord, ...cambios, total: Number(cambios.total ?? ord.total) }
        : ord;

    this.pedidos.update((lista) => lista.map(apply));
    const activo = this.pedidoActivo();
    if (activo?.id_orden === idOrden) this.pedidoActivo.set(apply(activo));
  }

  // ── Descuento ──

  /**
   * Mismo criterio que el domicilio: opt-in del negocio y solo mientras el pedido
   * no esté cobrado — mover el total de uno pagado descuadraría la caja, y el
   * backend lo rechaza igualmente (ORDEN_PAGADA).
   */
  puedeEditarDescuento(p: PedidoDespacho): boolean {
    return this.permiteDescuento() && this.esPendientePago(p);
  }

  setDescuentoInput(rawValue: string): void {
    this.descuentoInput.set(rawValue);

    const p = this.pedidoActivo();
    if (!p || !this.puedeEditarDescuento(p)) return;

    this.guardandoDescuento.set(true);
    this.descuentoEditado$.next({ idOrden: p.id_orden, valor: this.parseMonto(rawValue) });
  }

  private guardarDescuento(idOrden: number, valor: number): Observable<unknown> {
    const guardado = this.pedidos().find((ord) => ord.id_orden === idOrden);
    if (guardado && valor === this.descuento(guardado)) {
      this.guardandoDescuento.set(false);
      return of(null);
    }

    return this.http.patch<{ success: boolean; data?: { total?: number; descuento?: number } }>(
      `${environment.apiUrl}/pedidos/${idOrden}/descuento`,
      { id_negocio: this.negocioId(), descuento: valor }
    ).pipe(
      tap((res) => {
        // El backend recorta la rebaja para que el total no baje de cero, así que
        // manda lo que respondió y no lo que se tecleó.
        const descuento = Number(res?.data?.descuento ?? valor);
        this.aplicarAjuste(idOrden, { descuento, total: res?.data?.total });
        // Solo se corrige el campo cuando el backend recortó: reescribirlo siempre
        // movería el cursor mientras se teclea. Y se dice por qué cambió, que si no
        // el número se corrige solo delante del usuario sin explicación.
        if (descuento !== valor) {
          this.descuentoInput.set(descuento > 0 ? String(descuento) : '');
          this.uiFeedback.warning('El descuento no puede superar el total del pedido.');
        }
        this.guardandoDescuento.set(false);
      }),
      catchError((err: HttpErrorResponse) => {
        this.guardandoDescuento.set(false);
        const guardado = this.pedidos().find((ord) => ord.id_orden === idOrden);
        const actual = guardado ? this.descuento(guardado) : 0;
        this.descuentoInput.set(actual > 0 ? String(actual) : '');
        this.uiFeedback.error(err?.error?.message || 'No se pudo actualizar el descuento.');
        return of(null);
      }),
      map(() => null),
    );
  }

  onPagoSeleccion(seleccion: PagoSeleccion): void {
    this.pagoSeleccion.set(seleccion);
    this.metodoPagoSeleccionado.set(seleccion.modo === 'simple' ? seleccion.idMetodoPago : null);
  }

  /** Filas con las que abre el selector: el desglose guardado del pedido. */
  readonly filasPagoActivo = computed<FilaPago[]>(() =>
    (this.pedidoActivo()?.pagos ?? []).map((f) => ({
      id_metodo_pago: f.id_metodo_pago,
      valor: Number(f.valor ?? 0),
    }))
  );

  private readonly locale = inject(LOCALE_ID);

  /**
   * Cuándo se hizo el pedido: «8:02 p. m.» si es de hoy, «ayer 8:02 p. m.» si es de ayer y solo la
   * fecha («03 abr») desde hace dos días. Ver `etiquetaFecha`.
   */
  fechaPedido(valor: string | Date | null | undefined): string {
    return etiquetaFecha(valor, this.locale);
  }

  /** Devuelve un href tel: limpio (solo dígitos y +). */
  telHref(numero: string | null | undefined): string | null {
    if (!numero) return null;
    const limpio = String(numero).replace(/[^\d+]/g, '');
    return limpio ? `tel:${limpio}` : null;
  }

  tipoLabel(tipo: TipoPedido): string {
    if (tipo === 'DOMICILIO') return 'Domicilio';
    if (tipo === 'LLEVAR') return 'Llevar';
    return 'En mesa';
  }

  domiciliarioNombre(p: PedidoDespacho): string {
    if (!p.domiciliario) return 'Sin asignar';
    return `${p.domiciliario.primer_nombre} ${p.domiciliario.primer_apellido}`.trim();
  }

  /** Quién tomó el pedido. Nombre completo, para el modal y el `title` de la tarjeta. */
  tomadoPorNombre(p: PedidoDespacho): string {
    if (!p.usuario) return 'Desconocido';
    return `${p.usuario.primer_nombre} ${p.usuario.primer_apellido}`.trim() || 'Desconocido';
  }

  /**
   * Versión corta para la tarjeta: nombre + inicial del apellido («Ana G.»).
   *
   * En las densidades compacta y mini la tarjeta baja de ~150 px de ancho, y un
   * «María Fernanda Gutiérrez» completo o rompe la línea o se corta a la mitad.
   * Con la inicial cabe entero, y el nombre completo sigue disponible en el
   * `title` y en el modal.
   */
  tomadoPorCorto(p: PedidoDespacho): string {
    if (!p.usuario) return 'Desconocido';
    const nombre = String(p.usuario.primer_nombre ?? '').trim();
    const apellido = String(p.usuario.primer_apellido ?? '').trim();
    if (!nombre) return apellido || 'Desconocido';
    return apellido ? `${nombre} ${apellido[0]}.` : nombre;
  }

  itemsResumen(p: PedidoDespacho): string {
    const totalItems = this.unidadesItems(p);
    if (totalItems <= 0) return '—';
    return `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`;
  }

  /** Solo el número. En tarjetas angostas "2 productos" no cabe; "2" con ícono sí. */
  unidadesItems(p: PedidoDespacho): number {
    return (p.detalles ?? []).reduce((s, d) => s + Number(d.cantidad ?? 0), 0);
  }

  esPendientePago(p: PedidoDespacho): boolean {
    return (p.estado_pago ?? 'pendiente_pago') === 'pendiente_pago';
  }

  /**
   * Quita de la pantalla los cancelados dados. No toca nada en el servidor: es lo mismo que
   * pulsar «Finalizar» en cada una de sus tarjetas.
   */
  private descartarCancelados(ids: number[]): void {
    if (ids.length === 0) return;
    this.canceladosFinalizados.update((s) => new Set([...s, ...ids]));
    this.guardarCanceladosFinalizados();
  }

  /**
   * «Finalizar todo»: cierra lo cobrado, cancela lo que no se cobró (si el rol puede) y quita de
   * la pantalla los cancelados.
   *
   * Antes solo miraba `pedidosFiltrados()`. Los cancelados se añadieron después como una lista
   * aparte (`canceladosFiltrados()`) y este botón nunca se enteró: con solo cancelados en pantalla
   * quedaba deshabilitado, y con pedidos mezclados los dejaba ahí. Y los que el propio botón
   * cancelaba reaparecían un instante después como «Cancelado», con lo que la pantalla acababa
   * con MÁS tarjetas que al principio.
   */
  async finalizarTodo(): Promise<void> {
    const lista = this.pedidosFiltrados();
    const cancelados = this.canceladosFiltrados();
    if (lista.length === 0 && cancelados.length === 0) {
      await this.uiFeedback.alert({
        title: 'Sin pedidos',
        message: 'No hay pedidos activos para finalizar.',
        tone: 'info',
      });
      return;
    }

    // Solo hay cancelados: no hay nada que cobrar ni cancelar, y quitarlos de la vista no pierde nada.
    if (lista.length === 0) {
      this.descartarCancelados(cancelados.map((c) => c.id_orden));
      return;
    }

    const cobrados   = lista.filter(p => !this.esPendientePago(p));
    const noCobrados = lista.filter(p =>  this.esPendientePago(p));

    let procesarCobrados   = cobrados;
    let procesarNoCobrados: PedidoDespacho[] = [];

    if (noCobrados.length > 0) {
      if (this.puedeCancelarNoPagados()) {
        const confirmar = await this.uiFeedback.confirm({
          title: 'Pedidos sin cobrar',
          message: `Hay ${noCobrados.length} pedido(s) que aún no se han cobrado. ¿Desea limpiar los cobrados y eliminar los no cobrados?`,
          confirmText: 'Sí',
          cancelText: 'No',
          tone: 'warning',
        });
        if (!confirmar) return;
        procesarNoCobrados = noCobrados;
      } else {
        if (cobrados.length === 0) {
          // No hay nada que cerrar ni permiso para cancelar, pero los cancelados sí se pueden quitar.
          this.descartarCancelados(cancelados.map((c) => c.id_orden));
          await this.uiFeedback.alert({
            title: 'Sin pedidos cobrados',
            message: 'No hay pedidos cobrados para finalizar y no tienes permiso para eliminar los no cobrados.',
            tone: 'warning',
          });
          return;
        }
        const confirmar = await this.uiFeedback.confirm({
          title: 'Finalizar cobrados',
          message: `Hay ${noCobrados.length} pedido(s) no cobrado(s) que no puedes eliminar. ¿Finalizar solo los ${cobrados.length} pedido(s) cobrado(s)?`,
          confirmText: 'Finalizar cobrados',
          cancelText: 'Cancelar',
          tone: 'warning',
        });
        if (!confirmar) return;
      }
    } else {
      const confirmar = await this.uiFeedback.confirm({
        title: 'Finalizar todo',
        message: `¿Finalizar los ${cobrados.length} pedido(s) cobrado(s)?`,
        confirmText: 'Finalizar todo',
        cancelText: 'Cancelar',
        tone: 'info',
      });
      if (!confirmar) return;
    }

    // Ya confirmó: los cancelados que ya estaban en pantalla se van con el resto.
    this.descartarCancelados(cancelados.map((c) => c.id_orden));

    const aCerrar = procesarCobrados;
    const aCancelar = procesarNoCobrados;
    const requests$ = [
      ...aCerrar.map(p =>
        this.http.patch(`${environment.apiUrl}/pedidos/${p.id_orden}/cerrar`, {}).pipe(catchError(() => of(null)))
      ),
      ...aCancelar.map(p =>
        this.http.patch(`${environment.apiUrl}/pedidos/${p.id_orden}/cancelar`, {}).pipe(catchError(() => of(null)))
      ),
    ];

    if (requests$.length === 0) return;

    forkJoin(requests$).subscribe({
      next: (resultados) => {
        // Una petición que falló devuelve `null` (catchError): esa tarjeta se queda, no se
        // esconde como si hubiera salido bien.
        const todos = [...aCerrar, ...aCancelar];
        const hechos = todos.filter((_, i) => resultados[i] !== null);
        const fallidos = todos.length - hechos.length;
        const ids = new Set(hechos.map(p => p.id_orden));

        this.pedidos.update(l => l.filter(p => !ids.has(p.id_orden)));
        if (this.pedidoActivo() && ids.has(this.pedidoActivo()!.id_orden)) {
          this.pedidoActivo.set(null);
        }

        // Los que este mismo botón acaba de cancelar no vuelven como tarjeta «Cancelado».
        const canceladosAhora = aCancelar.filter(p => ids.has(p.id_orden)).map(p => p.id_orden);
        this.descartarCancelados(canceladosAhora);
        this.cargarCancelados();

        if (fallidos > 0) {
          this.cargar();
          this.uiFeedback.error(`No se pudieron procesar ${fallidos} pedido(s). Se recargó la lista.`);
        } else {
          this.uiFeedback.success('Pedidos procesados correctamente.', 'Finalizar todo');
        }
      },
      error: () => {
        this.cargar();
        this.uiFeedback.error('Error al procesar algunos pedidos. Se recargó la lista.');
      },
    });
  }

  async limpiarPedido(p: PedidoDespacho, event: Event): Promise<void> {
    event.stopPropagation();

    const confirmar = await this.uiFeedback.confirm({
      title: 'Marcar como entregado',
      message: `El pedido ${p.numero_orden} quedará finalizado y se removerá del módulo de despacho.`,
      confirmText: 'Finalizar',
      cancelText: 'Cancelar',
      tone: 'info',
    });
    if (!confirmar) return;

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/cerrar`, {}
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          this.pedidos.update(lista => lista.filter(ord => ord.id_orden !== p.id_orden));
          if (this.pedidoActivo()?.id_orden === p.id_orden) this.pedidoActivo.set(null);
          this.uiFeedback.success('Pedido finalizado correctamente.', 'Entregado');
        }
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.uiFeedback.error(msg || 'No se pudo finalizar el pedido.');
      },
    });
  }

  async cancelarPedido(p: PedidoDespacho, event: Event): Promise<void> {
    event.stopPropagation();

    if (!this.puedeCancelarNoPagados()) {
      await this.uiFeedback.alert({
        title: 'Acceso restringido',
        message: 'Tu rol no tiene permiso para cancelar pedidos pendientes de pago.',
        tone: 'warning',
      });
      return;
    }

    const confirmar = await this.uiFeedback.confirm({
      title: 'Cancelar pedido',
      message: `Se cancelará el pedido ${p.numero_orden}. Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar pedido',
      cancelText: 'Volver',
      tone: 'warning',
    });
    if (!confirmar) return;

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/cancelar`, {}
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          this.pedidos.update(lista => lista.filter(ord => ord.id_orden !== p.id_orden));
          if (this.pedidoActivo()?.id_orden === p.id_orden) this.pedidoActivo.set(null);
          this.cargarCancelados();
          this.uiFeedback.success('El pedido fue cancelado.', 'Pedido cancelado');
        }
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.uiFeedback.error(msg || 'No se pudo cancelar el pedido.');
      },
    });
  }

  /**
   * La forma de pago con la que el pedido ya llegó, lista para cobrar sin abrir el detalle; o
   * `null` si no trae ninguna, o trae una que hay que revisar antes de cobrar.
   *
   * Un pedido llega a Despacho con la forma de pago elegida (al tomarlo) o sin ella. Si ya viene,
   * pedirla otra vez en el modal es un paso que sobra. Se abre el modal —y no se cobra— cuando:
   *  - no hay forma de pago (hay que elegirla);
   *  - un multipago ya no suma el total (se editó el pedido después): cobrar así lo rechazaría;
   *  - la forma es «Cuenta / Tiquetera» y el pedido no dice de quién es: el servidor exige la
   *    cuenta y no la adivina, para no descontarle el almuerzo a otra persona.
   */
  private seleccionGuardada(p: PedidoDespacho): PagoSeleccion | null {
    const idCuenta = p.id_cuenta ?? null;
    const esCuenta = (idMetodo: number | null) =>
      this.metodosPago().some((m) => m.id_metodo_pago === idMetodo && m.es_cuenta);

    const filas = (p.pagos ?? []).map((f) => ({
      id_metodo_pago: f.id_metodo_pago,
      valor: Number(f.valor ?? 0),
    }));
    if (filas.length > 0) {
      const suma = filas.reduce((t, f) => t + f.valor, 0);
      const cuadra = Math.abs(suma - Number(p.total)) < 0.5;
      if (!cuadra || (filas.some((f) => esCuenta(f.id_metodo_pago)) && !idCuenta)) return null;
      return { modo: 'multi', idMetodoPago: null, pagos: filas, filas, valido: true, idCuenta };
    }

    const idMetodoPago = p.id_metodo_pago ?? null;
    if (!idMetodoPago || (esCuenta(idMetodoPago) && !idCuenta)) return null;
    return { modo: 'simple', idMetodoPago, pagos: [], filas: [], valido: true, idCuenta };
  }

  /**
   * «Cobrar» en la tarjeta: si el pedido ya trae su forma de pago cobra enseguida; si no, abre el
   * detalle para elegirla. Desde el modal se sigue usando `cobrar` con lo que ahí se eligió.
   */
  cobrarDesdeTarjeta(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    const seleccion = this.seleccionGuardada(p);
    if (!seleccion) {
      this.abrirPedido(p);
      return;
    }
    void this.cobrar(p, event, seleccion);
  }

  async cobrar(p: PedidoDespacho, event: Event, seleccionDirecta?: PagoSeleccion): Promise<void> {
    event.stopPropagation();
    if (this.cobrandoId() !== null) return;

    const seleccion = seleccionDirecta ?? this.pagoSeleccion();
    const esMulti = seleccion?.modo === 'multi';

    // Construir el cuerpo del cobro: pago simple o multipago.
    let bodyPago: Record<string, unknown>;
    if (esMulti) {
      if (!seleccion?.valido) {
        void this.uiFeedback.alert({
          title: 'Multipago incompleto',
          message: 'La suma de las formas de pago debe ser igual al total del pedido.',
          tone: 'warning',
        });
        return;
      }
      bodyPago = { pagos: seleccion.pagos };
    } else {
      const idMetodoPago = seleccion?.idMetodoPago ?? this.metodoPagoSeleccionado() ?? p.id_metodo_pago ?? null;
      if (!idMetodoPago) {
        void this.uiFeedback.alert({
          title: 'Forma de pago requerida',
          message: 'Selecciona una forma de pago antes de registrar el cobro.',
          tone: 'warning',
        });
        return;
      }
      bodyPago = { id_metodo_pago: idMetodoPago };
    }

    const origenCobro = p.tipo_pedido === 'DOMICILIO' ? 'DOMICILIARIO' : 'CAJA';
    let idCaja = origenCobro === 'CAJA' ? this.cajaSvc.cajaAbierta()?.id_caja ?? null : null;
    // Con varias cajas el pedido se cobra en la SUYA, que puede no ser la que este equipo
    // tiene elegida: comprobar aquí la elegida bloquearía cobros válidos. Decide el servidor,
    // que responde CAJA_CERRADA (con el nombre de la caja) si de verdad está cerrada.
    if (origenCobro === 'CAJA' && !idCaja && !this.cajaSvc.variasCajas()) {
      // El estado local puede estar viejo (otro equipo abrió el turno, o la consulta
      // falló): se pregunta al servidor antes de negar el cobro.
      const idNeg = this.negocioId();
      const caja = idNeg ? await this.cajaSvc.verificar(idNeg) : null;
      if (!caja) {
        void this.uiFeedback.alert({
          title: 'Caja cerrada',
          message: 'La caja está cerrada. Ábrela antes de registrar cobros en despacho.',
          tone: 'warning',
        });
        return;
      }
      idCaja = caja.id_caja;
    }

    this.cobrandoId.set(p.id_orden);

    this.http.patch<{ success: boolean }>(
      `${environment.apiUrl}/pedidos/${p.id_orden}/marcar-pagado`,
      {
        ...bodyPago,
        // De quién es la tiquetera, cuando el cobro va contra una cuenta de cliente.
        ...(seleccion?.idCuenta ? { id_cuenta: seleccion.idCuenta } : {}),
        origen_cobro: origenCobro,
        id_caja: idCaja,
      }
    ).subscribe({
      next: (res) => {
        if (res?.success) {
          const idMetodoAplicado = esMulti ? null : (bodyPago['id_metodo_pago'] as number);
          const pagosAplicados = esMulti ? seleccion?.pagos ?? [] : [];
          const apply = (ord: PedidoDespacho) =>
            ord.id_orden === p.id_orden
              ? { ...ord, estado_pago: 'pagado', id_metodo_pago: idMetodoAplicado, pagos: pagosAplicados }
              : ord;

          this.pedidos.update(lista => lista.map(apply));
          const activo = this.pedidoActivo();
          if (activo?.id_orden === p.id_orden) {
            this.pedidoActivo.set(apply(activo));
          }
          this.uiFeedback.success('Pago registrado correctamente.', 'Cobro exitoso');
        }
        this.cobrandoId.set(null);
      },
      error: (err: HttpErrorResponse) => {
        const codigo = err?.error?.errors?.code || err?.error?.code;
        if (codigo === 'CAJA_CERRADA') {
          const idNeg = this.negocioId();
          if (idNeg) void this.cajaSvc.verificar(idNeg);
          void this.uiFeedback.alert({
            title: 'Caja cerrada',
            message: err?.error?.message || 'La caja está cerrada. Ábrela antes de registrar cobros.',
            tone: 'warning',
          });
        } else {
          this.uiFeedback.error(err?.error?.message || 'No se pudo registrar el pago.');
        }
        this.cobrandoId.set(null);
      },
    });
  }

  // ── Impresión ──

  imprimirTicket(p: PedidoDespacho, event: Event): void {
    event.stopPropagation();
    if (!this.isBrowser) return;

    const html = this.buildTicketHtml(p, new Date());
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(frame);

    const frameDoc = frame.contentDocument;
    if (!frameDoc) {
      frame.remove();
      this.imprimirTicketFallback(html);
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
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

  private imprimirTicketFallback(html: string): void {
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=420,height=700');
    if (!popup) {
      void this.uiFeedback.alert({
        title: 'No se pudo abrir la impresión',
        message: 'Habilita ventanas emergentes para continuar con la impresión.',
        tone: 'error',
      });
      return;
    }
    popup.document.open();
    popup.document.write(html);
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

  private buildTicketHtml(p: PedidoDespacho, fecha: Date): string {
    const negocio = this.escapeHtml(this.auth.negocio()?.nombre ?? 'Negocio');
    // "Atiende" es quien tomó el pedido, no quien está cobrando/imprimiendo ahora mismo.
    const creador = p.usuario;
    const usuario = this.escapeHtml(
      creador ? `${creador.primer_nombre} ${creador.primer_apellido}`.trim() : (this.auth.usuario()?.nombre_completo ?? 'Usuario')
    );
    const fechaTexto = this.escapeHtml(this.formatDateTime(fecha));
    const tipoTexto = p.tipo_pedido === 'DOMICILIO' ? 'Domicilio' : 'Para llevar';
    const contacto = this.escapeHtml(p.contacto_nombre ?? '');
    const telefono = this.escapeHtml(p.contacto_telefono ?? '');
    const direccion = p.tipo_pedido === 'DOMICILIO' ? this.escapeHtml(p.direccion_domicilio ?? '') : '';
    const notaDomicilio = this.escapeHtml(p.nota_domicilio?.trim() ?? '');
    const notaOrden = this.escapeHtml(p.nota?.trim() ?? '');
    const domiciliario = p.domiciliario
      ? this.escapeHtml(`${p.domiciliario.primer_nombre} ${p.domiciliario.primer_apellido}`.trim())
      : '';

    const infoRows = [
      contacto ? `<div class="meta">Cliente: ${contacto}</div>` : '',
      telefono ? `<div class="meta">Tel: ${telefono}</div>` : '',
      direccion ? `<div class="meta">Dir: ${direccion}</div>` : '',
      domiciliario ? `<div class="meta">Domiciliario: ${domiciliario}</div>` : '',
    ].join('');

    const notas = [
      notaOrden ? `<div class="ticket-note"><strong>Nota:</strong> ${notaOrden}</div>` : '',
      notaDomicilio ? `<div class="ticket-note"><strong>Nota domicilio:</strong> ${notaDomicilio}</div>` : '',
    ].filter(Boolean).join('');

    // El domicilio ya viene sumado en el total y el descuento restado: se desglosan
    // para que el cliente vea de dónde sale lo que paga.
    const domicilio = this.valorDomicilio(p);
    const rebaja = this.descuento(p);
    const desgloseRows = (domicilio > 0 || rebaja > 0)
      ? [
          `<div class="totals-row"><span>Productos</span><span>${this.formatCurrency(this.subtotalProductos(p))}</span></div>`,
          domicilio > 0 ? `<div class="totals-row"><span>Domicilio</span><span>${this.formatCurrency(domicilio)}</span></div>` : '',
          rebaja > 0 ? `<div class="totals-row"><span>Descuento</span><span>-${this.formatCurrency(rebaja)}</span></div>` : '',
        ].join('')
      : '';

    const filasItems = (p.detalles ?? []).map(d => {
      const nombre = this.escapeHtml(d.producto?.nombre ?? '(Producto)');
      const sin = this.escapeHtml(this.textoSin(d));
      const sinHtml = sin
        ? `<tr><td></td><td colspan="3" class="item-meta">Sin: ${sin}</td></tr>`
        : '';
      const lineTotal = d.cantidad * d.precio_unitario;
      const notaItem = d.nota ? this.escapeHtml(String(d.nota)) : '';
      const notaItemHtml = notaItem
        ? `<tr><td></td><td colspan="3" class="item-meta">Nota: ${notaItem}</td></tr>`
        : '';
      return `
        <tr>
          <td>${d.cantidad}</td>
          <td>${nombre}</td>
          <td>${this.formatCurrency(d.precio_unitario)}</td>
          <td class="text-right">${this.formatCurrency(lineTotal)}</td>
        </tr>
        ${sinHtml}
        ${notaItemHtml}`;
    }).join('');

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Ticket ${this.escapeHtml(p.numero_orden)}</title>
  <style>
    @page { size: 80mm auto; margin: 6mm; }
    * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
    body { margin: 0; color: #111; background: #fff; }
    .ticket { max-width: 280px; margin: 0 auto; font-size: 12px; }
    .center { text-align: center; }
    .title { margin: 0; font-size: 16px; font-weight: 700; }
    .meta { margin-top: 2px; color: #555; }
    hr { border: 0; border-top: 1px dashed #aaa; margin: 10px 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px 0; vertical-align: top; }
    th { font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: .04em; }
    .text-right { text-align: right; }
    .item-meta { font-size: 10px; color: #666; padding-top: 0; }
    .ticket-note { margin-top: 6px; font-size: 11px; color: #333; }
    .totals { margin-top: 8px; }
    .totals-row { display: flex; justify-content: space-between; margin-top: 3px; }
    .totals-row.total { margin-top: 7px; padding-top: 5px; border-top: 1px dashed #aaa; font-weight: 700; font-size: 14px; }
    .footer { margin-top: 12px; text-align: center; font-size: 11px; color: #666; }
    @media print {
      * { color: #000 !important; font-weight: 700 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .title, .totals-row.total { font-weight: 900 !important; }
      h1, h2, th { font-weight: 900 !important; }
      hr { border-top-color: #000 !important; border-top-style: solid !important; }
      .meta, .ticket-note, .footer { color: #000 !important; font-weight: 700 !important; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="center">
      <h1 class="title">${negocio}</h1>
      <div class="meta">${fechaTexto}</div>
      <div class="meta">Atiende: ${usuario}</div>
      <div class="meta">${tipoTexto} · ${this.escapeHtml(p.numero_orden)}</div>
      ${infoRows}
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
      <tbody>${filasItems}</tbody>
    </table>
    ${notas}
    <hr />
    <div class="totals">
      ${desgloseRows}
      <div class="totals-row total">
        <span>TOTAL</span>
        <span>${this.formatCurrency(p.total)}</span>
      </div>
    </div>
    <div class="footer">Gracias por tu compra</div>
  </div>
</body>
</html>`;
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(value);
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', maximumFractionDigits: 0,
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
}
