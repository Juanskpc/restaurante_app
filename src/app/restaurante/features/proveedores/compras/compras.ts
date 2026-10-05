import {
  ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, output, signal,
  untracked,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import { CatalogoCacheService } from '../../../../core/services/catalogo-cache.service';
import {
  Compra, CompraPayload, InsumoProveedor, Proveedor, ProveedoresService, ResumenGasto,
} from '../../../../core/services/proveedores.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import { IngredienteLite, PermisosProveedores } from '../proveedor-detalle/proveedor-detalle';

/** Un renglón del formulario de compra, mientras se está escribiendo. */
interface RenglonBorrador {
  /** Clave local para el `track` de la lista. No viaja al servidor. */
  clave: number;
  idInsumo: number | null;
  idIngrediente: number | null;
  descripcion: string;
  cantidad: number | null;
  unidad: string;
  precioUnitario: number | null;
  descuento: number | null;
}

const UNIDADES = ['KG', 'G', 'L', 'ML', 'UN', 'CAJA', 'BULTO', 'PAQUETE', 'OTRA'] as const;

/** La fecha de calendario de hoy en Bogotá, igual que la calcula el backend. */
function hoyBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/**
 * ComprasComponent — registro e historial de compras a proveedores.
 *
 * ## Lo que esta pantalla tiene que dejar claro
 *
 * Registrar una compra **mueve el inventario**: cada renglón ligado a un insumo suma stock.
 * Eso no puede pasar de forma silenciosa, así que el formulario dice por renglón qué va a
 * entrar al inventario y qué no, y al guardar se muestran los avisos del servidor cuando
 * algún renglón no pudo convertirse (una caja no se puede pasar a gramos sin saber cuánto
 * trae).
 *
 * Anular tampoco borra: revierte el stock y la compra queda tachada en el historial. Es la
 * misma idea que la anulación en caja — nada desaparece, todo se compensa.
 */
@Component({
  selector: 'app-compras',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './compras.html',
  styleUrl: './compras.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComprasComponent implements OnInit {
  private readonly api = inject(ProveedoresService);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly ui = inject(UiFeedbackService);

  /** Los proveedores que este negocio tiene vinculados: solo a esos se les compra. */
  readonly proveedores = input<Proveedor[]>([]);
  readonly ingredientes = input<IngredienteLite[]>([]);
  readonly permisos = input.required<PermisosProveedores>();
  /** Cuando el padre pide abrir el formulario con un proveedor ya elegido. */
  readonly abrirPara = input<number | null>(null);

  readonly registrada = output<void>();

  readonly unidades = UNIDADES;

  // ── Historial ──
  readonly compras = signal<Compra[]>([]);
  readonly total = signal(0);
  readonly cargando = signal(false);
  readonly errorCarga = signal(false);

  readonly busqueda = signal('');
  readonly filtroProveedor = signal<number | null>(null);
  readonly filtroIngrediente = signal<number | null>(null);
  readonly desde = signal<string>('');
  readonly hasta = signal<string>('');
  readonly verAnuladas = signal(false);

  // ── Resumen de gasto ──
  readonly resumen = signal<ResumenGasto | null>(null);

  // ── Detalle ──
  readonly abierta = signal<Compra | null>(null);
  readonly cargandoDetalle = signal(false);

  // ── Formulario ──
  readonly form = signal(false);
  readonly guardando = signal(false);
  readonly fProveedor = signal<number | null>(null);
  readonly fFecha = signal(hoyBogota());
  readonly fReferencia = signal('');
  readonly fDescuento = signal<number | null>(null);
  readonly fImpuesto = signal<number | null>(null);
  readonly fMetodoPago = signal<number | null>(null);
  readonly fObservaciones = signal('');
  readonly fAfectaInventario = signal(true);
  readonly renglones = signal<RenglonBorrador[]>([]);
  private claveRenglon = 0;

  /** Insumos del proveedor elegido, para rellenar los renglones de un toque. */
  readonly insumosProveedor = signal<InsumoProveedor[]>([]);
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string }>>([]);

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly puedeVer = computed(() => this.permisos().precios);
  readonly puedeRegistrar = computed(() => this.permisos().compras);

  readonly hayFiltros = computed(() =>
    !!this.busqueda().trim() || this.filtroProveedor() !== null
    || this.filtroIngrediente() !== null || !!this.desde() || !!this.hasta() || this.verAnuladas(),
  );

  // ── Totales del formulario ──
  readonly subtotal = computed(() =>
    this.renglones().reduce((suma, r) => {
      const linea = (Number(r.cantidad) || 0) * (Number(r.precioUnitario) || 0)
        - (Number(r.descuento) || 0);
      return suma + Math.max(0, linea);
    }, 0),
  );

  readonly totalForm = computed(() => Math.max(
    0,
    this.subtotal() - (Number(this.fDescuento()) || 0) + (Number(this.fImpuesto()) || 0),
  ));

  readonly puedeGuardar = computed(() =>
    this.fProveedor() !== null
    && this.renglones().length > 0
    && this.renglones().every((r) => (Number(r.cantidad) || 0) > 0 && this.descripcionDe(r).length > 0)
    && !this.guardando(),
  );

  /** El padre pidió abrir el formulario para un proveedor concreto. */
  private readonly alPedirApertura = effect(() => {
    const id = this.abrirPara();
    if (id == null) return;
    untracked(() => this.abrirForm(id));
  });

  /**
   * La carga inicial va en `ngOnInit` y no en el constructor por una razón concreta: un
   * `input.required` todavía no tiene valor cuando el constructor corre, y `cargar()` consulta
   * `permisos()`. Leerlo ahí lanza NG0950 y la pestaña no llega ni a pintarse.
   */
  ngOnInit(): void {
    this.cargar();
    this.cargarResumen();
    const id = this.negocioId();
    if (id) {
      this.catalogo.metodosPago(id).subscribe({
        next: (data) => this.metodosPago.set((data as never[]) ?? []),
        error: () => this.metodosPago.set([]),
      });
    }
  }

  // ============================================================
  // Historial
  // ============================================================

  cargar(): void {
    const id = this.negocioId();
    if (!id || !this.permisos().precios) return;

    const primera = this.compras().length === 0;
    if (primera) this.cargando.set(true);

    this.api.compras(id, {
      busqueda: this.busqueda().trim() || null,
      idProveedor: this.filtroProveedor(),
      idIngrediente: this.filtroIngrediente(),
      desde: this.desde() || null,
      hasta: this.hasta() || null,
      anuladas: this.verAnuladas(),
      limite: 100,
    }).subscribe({
      next: (res) => {
        this.compras.set(res?.data?.items ?? []);
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

  cargarResumen(): void {
    const id = this.negocioId();
    if (!id || !this.permisos().precios) return;
    this.api.resumenGasto(id, { desde: this.desde() || null, hasta: this.hasta() || null })
      .subscribe({
        next: (res) => this.resumen.set(res?.data ?? null),
        error: () => this.resumen.set(null),
      });
  }

  aplicarFiltros(): void {
    this.cargar();
    this.cargarResumen();
  }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtroProveedor.set(null);
    this.filtroIngrediente.set(null);
    this.desde.set('');
    this.hasta.set('');
    this.verAnuladas.set(false);
    this.aplicarFiltros();
  }

  abrirDetalle(compra: Compra): void {
    const id = this.negocioId();
    if (!id) return;
    this.abierta.set(compra);
    this.cargandoDetalle.set(true);
    this.api.compra(compra.id_compra, id).subscribe({
      next: (res) => {
        if (res?.data) this.abierta.set(res.data);
        this.cargandoDetalle.set(false);
      },
      error: () => this.cargandoDetalle.set(false),
    });
  }

  async anular(compra: Compra): Promise<void> {
    const id = this.negocioId();
    if (!id) return;

    const sumoStock = (compra.detalles ?? []).some((d) => d.stock_sumado > 0);
    const confirmado = await this.ui.confirm({
      title: 'Anular compra',
      message: sumoStock
        ? 'La compra quedará tachada y se devolverá al inventario exactamente lo que sumó. No se borra nada.'
        : 'La compra quedará tachada en el historial. No se borra nada.',
      confirmText: 'Anular',
      tone: 'warning',
    });
    if (!confirmado) return;

    this.api.anularCompra(compra.id_compra, id).subscribe({
      next: () => {
        this.ui.updated('Compra anulada y stock devuelto.');
        this.abierta.set(null);
        this.cargar();
        this.cargarResumen();
        this.registrada.emit();
      },
      error: (err) => this.ui.error(err?.error?.message ?? 'No se pudo anular la compra.'),
    });
  }

  // ============================================================
  // Formulario
  // ============================================================

  abrirForm(idProveedor: number | null = null): void {
    if (!this.puedeRegistrar()) return;
    this.fProveedor.set(idProveedor ?? this.proveedores()[0]?.id_proveedor ?? null);
    this.fFecha.set(hoyBogota());
    this.fReferencia.set('');
    this.fDescuento.set(null);
    this.fImpuesto.set(null);
    this.fMetodoPago.set(null);
    this.fObservaciones.set('');
    this.fAfectaInventario.set(true);
    this.renglones.set([this.nuevoRenglon()]);
    this.form.set(true);
    if (this.fProveedor() != null) this.cargarInsumosProveedor(this.fProveedor()!);
  }

  cerrarForm(): void {
    if (this.guardando()) return;
    this.form.set(false);
    this.insumosProveedor.set([]);
  }

  alCambiarProveedor(id: number | null): void {
    this.fProveedor.set(id);
    // Los renglones ligados a insumos del proveedor anterior ya no valen: se sueltan, pero
    // el texto escrito se conserva para no hacer repetir el trabajo.
    this.renglones.update((lista) => lista.map((r) => ({ ...r, idInsumo: null })));
    if (id != null) this.cargarInsumosProveedor(id);
    else this.insumosProveedor.set([]);
  }

  private cargarInsumosProveedor(idProveedor: number): void {
    const id = this.negocioId();
    if (!id) return;
    this.api.insumos(idProveedor, id).subscribe({
      next: (res) => this.insumosProveedor.set((res?.data ?? []).filter((i) => i.es_propio)),
      error: () => this.insumosProveedor.set([]),
    });
  }

  private nuevoRenglon(): RenglonBorrador {
    this.claveRenglon += 1;
    return {
      clave: this.claveRenglon,
      idInsumo: null,
      idIngrediente: null,
      descripcion: '',
      cantidad: null,
      unidad: 'UN',
      precioUnitario: null,
      descuento: null,
    };
  }

  agregarRenglon(): void {
    this.renglones.update((lista) => [...lista, this.nuevoRenglon()]);
  }

  quitarRenglon(clave: number): void {
    this.renglones.update((lista) =>
      lista.length <= 1 ? lista : lista.filter((r) => r.clave !== clave),
    );
  }

  /**
   * Elegir un insumo rellena el renglón con lo que ya se sabe de él: unidad, último precio y
   * el insumo de inventario al que está atado. Es el atajo que hace que registrar una compra
   * de ocho renglones no sean ocho formularios.
   */
  elegirInsumo(clave: number, idInsumo: number | null): void {
    const insumo = this.insumosProveedor().find((i) => i.id_proveedor_insumo === idInsumo) ?? null;
    this.renglones.update((lista) => lista.map((r) => {
      if (r.clave !== clave) return r;
      if (!insumo) return { ...r, idInsumo: null };
      return {
        ...r,
        idInsumo: insumo.id_proveedor_insumo,
        idIngrediente: insumo.id_ingrediente ?? null,
        descripcion: r.descripcion || insumo.nombre,
        unidad: insumo.unidad,
        precioUnitario: r.precioUnitario ?? insumo.precio ?? null,
      };
    }));
  }

  actualizarRenglon(clave: number, campo: keyof RenglonBorrador, valor: unknown): void {
    this.renglones.update((lista) =>
      lista.map((r) => (r.clave === clave ? { ...r, [campo]: valor } as RenglonBorrador : r)),
    );
  }

  descripcionDe(r: RenglonBorrador): string {
    if (r.descripcion.trim()) return r.descripcion.trim();
    const insumo = this.insumosProveedor().find((i) => i.id_proveedor_insumo === r.idInsumo);
    return insumo?.nombre ?? '';
  }

  totalRenglon(r: RenglonBorrador): number {
    return Math.max(
      0,
      (Number(r.cantidad) || 0) * (Number(r.precioUnitario) || 0) - (Number(r.descuento) || 0),
    );
  }

  /** El nombre del insumo de inventario al que suma este renglón, si suma a alguno. */
  destinoInventario(r: RenglonBorrador): string | null {
    if (!this.fAfectaInventario() || r.idIngrediente == null) return null;
    return this.ingredientes().find((g) => g.id_ingrediente === r.idIngrediente)?.nombre ?? null;
  }

  guardar(): void {
    const id = this.negocioId();
    if (!id || !this.puedeGuardar()) return;

    const payload: CompraPayload = {
      id_negocio: id,
      id_proveedor: this.fProveedor()!,
      fecha: this.fFecha() || hoyBogota(),
      referencia: this.fReferencia().trim() || null,
      descuento: Number(this.fDescuento()) || 0,
      impuesto: Number(this.fImpuesto()) || 0,
      id_metodo_pago: this.fMetodoPago(),
      observaciones: this.fObservaciones().trim() || null,
      afecta_inventario: this.fAfectaInventario(),
      detalles: this.renglones().map((r) => ({
        id_proveedor_insumo: r.idInsumo,
        id_ingrediente: r.idIngrediente,
        descripcion: this.descripcionDe(r),
        cantidad: Number(r.cantidad) || 0,
        unidad: r.unidad,
        precio_unitario: Number(r.precioUnitario) || 0,
        descuento: Number(r.descuento) || 0,
      })),
    };

    this.guardando.set(true);
    this.api.registrarCompra(payload).subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.form.set(false);

        const avisos = res?.data?.avisos ?? [];
        if (avisos.length) {
          // Los avisos no son un error: la compra quedó registrada. Pero si no se cuentan,
          // alguien va a buscar en el inventario un stock que nunca entró.
          this.ui.warning(
            `Compra registrada. ${avisos.length} ${avisos.length === 1 ? 'renglón no entró' : 'renglones no entraron'} al inventario: ${avisos[0].detalle}`,
            'Revisa el inventario',
          );
        } else {
          this.ui.created('Compra registrada.');
        }

        this.cargar();
        this.cargarResumen();
        this.registrada.emit();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudo registrar la compra.');
      },
    });
  }

  // ── Adjunto ──

  subirAdjunto(evento: Event, compra: Compra): void {
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    const id = this.negocioId();
    if (!archivo || !id) return;

    this.api.subirAdjunto(compra.id_compra, id, archivo).subscribe({
      next: () => {
        this.ui.success('Factura adjuntada.');
        this.abrirDetalle(compra);
        input.value = '';
      },
      error: (err) => {
        this.ui.error(err?.error?.message ?? 'No se pudo subir el archivo.');
        input.value = '';
      },
    });
  }

  /**
   * Abre la factura en otra pestaña.
   *
   * No es un enlace directo: el adjunto no se sirve desde `/uploads` (lleva precios y datos
   * fiscales) y hay que pedirlo con el token. Se descarga como blob y se abre desde memoria.
   */
  verAdjunto(compra: Compra): void {
    const id = this.negocioId();
    if (!id) return;
    this.api.adjunto(compra.id_compra, id).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        // Se libera al rato: revocarla de inmediato cancela la pestaña que la está abriendo.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      error: () => this.ui.error('No se pudo abrir la factura.'),
    });
  }

  cerrarDetalle(): void {
    this.abierta.set(null);
  }
}
