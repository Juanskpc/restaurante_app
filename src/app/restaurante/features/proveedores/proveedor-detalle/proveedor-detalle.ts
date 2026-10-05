import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal,
  untracked,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import {
  CategoriaProveedor, Compra, InsumoPayload, InsumoProveedor, Proveedor, PuntoPrecio,
  ProveedoresService, UnidadInsumo, Visibilidad,
} from '../../../../core/services/proveedores.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';

/** Insumo del inventario del restaurante, para poder atarle el insumo del proveedor. */
export interface IngredienteLite {
  id_ingrediente: number;
  nombre: string;
  unidad_medida: string;
}

export interface PermisosProveedores {
  editar: boolean;
  archivar: boolean;
  compras: boolean;
  precios: boolean;
  publicar: boolean;
  crear: boolean;
}

const UNIDADES: ReadonlyArray<{ valor: UnidadInsumo; texto: string }> = [
  { valor: 'KG', texto: 'Kilogramo' },
  { valor: 'G', texto: 'Gramo' },
  { valor: 'L', texto: 'Litro' },
  { valor: 'ML', texto: 'Mililitro' },
  { valor: 'UN', texto: 'Unidad' },
  { valor: 'CAJA', texto: 'Caja' },
  { valor: 'BULTO', texto: 'Bulto' },
  { valor: 'PAQUETE', texto: 'Paquete' },
  { valor: 'OTRA', texto: 'Otra' },
];

const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const ETIQUETA_VISIBILIDAD: Record<Visibilidad, string> = {
  PRIVADO: 'Solo mi negocio',
  DIRECTORIO_BASICO: 'Compartido (básico)',
  DIRECTORIO_SIN_PRECIOS: 'Compartido sin precios',
  DIRECTORIO: 'Compartido con precios',
};

type Pestana = 'info' | 'insumos' | 'compras' | 'notas';
type SubModal = null | 'insumo' | 'precios' | 'reportar' | 'visibilidad';

/**
 * ProveedorDetalleComponent — la ficha abierta.
 *
 * ## La línea que divide esta pantalla en dos
 *
 * Arriba va lo **público** (lo que cualquiera con acceso ve: contacto, cobertura,
 * condiciones). Abajo, en pestañas, lo **privado de este negocio**: sus precios, sus compras,
 * sus notas. La separación no es decorativa: cuando se está mirando un proveedor del
 * directorio, la mitad privada o no existe o está vacía, y hay que verse de un golpe de vista
 * cuál es cuál para no creer que un precio de referencia es una oferta.
 *
 * Lo que el usuario no tiene permiso de ver no se esconde del todo: se dice que existe y que
 * hace falta un permiso. Esconderlo haría que la gente creyera que el módulo no lo tiene.
 */
@Component({
  selector: 'app-proveedor-detalle',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './proveedor-detalle.html',
  styleUrl: './proveedor-detalle.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorDetalleComponent {
  private readonly api = inject(ProveedoresService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  readonly proveedor = input.required<Proveedor & { insumos?: InsumoProveedor[] }>();
  readonly cargando = input(false);
  readonly permisos = input.required<PermisosProveedores>();
  readonly ingredientes = input<IngredienteLite[]>([]);
  readonly categorias = input<CategoriaProveedor[]>([]);

  readonly cerrar = output<void>();
  readonly editar = output<void>();
  /** Algo cambió por dentro (insumo, notas, visibilidad): el padre recarga la lista. */
  readonly cambiado = output<void>();
  readonly archivar = output<boolean>();
  readonly vincular = output<void>();
  readonly registrarCompra = output<void>();

  readonly unidades = UNIDADES;
  readonly etiquetaVisibilidad = ETIQUETA_VISIBILIDAD;
  readonly visibilidadesPosibles: Visibilidad[] =
    ['PRIVADO', 'DIRECTORIO_BASICO', 'DIRECTORIO_SIN_PRECIOS', 'DIRECTORIO'];

  readonly pestana = signal<Pestana>('info');
  readonly subModal = signal<SubModal>(null);
  readonly guardando = signal(false);

  // ── Insumos ──
  readonly insumos = signal<InsumoProveedor[]>([]);
  readonly insumoEditando = signal<InsumoProveedor | null>(null);

  readonly iNombre = signal('');
  readonly iCategoria = signal<number | null>(null);
  readonly iIngrediente = signal<number | null>(null);
  readonly iUnidad = signal<UnidadInsumo>('UN');
  readonly iPresentacion = signal('');
  readonly iCantidad = signal<number | null>(null);
  readonly iPrecio = signal<number | null>(null);
  readonly iPublico = signal(false);
  readonly iDisponible = signal(true);
  readonly iMarca = signal('');
  readonly iCodigo = signal('');
  readonly iNotas = signal('');

  // ── Histórico de precios ──
  readonly historial = signal<PuntoPrecio[]>([]);
  readonly historialDe = signal<InsumoProveedor | null>(null);
  readonly cargandoHistorial = signal(false);

  // ── Compras de este proveedor ──
  readonly compras = signal<Compra[]>([]);
  readonly cargandoCompras = signal(false);

  // ── Notas privadas ──
  readonly notas = signal('');
  readonly condiciones = signal('');
  readonly calificacion = signal<number | null>(null);

  // ── Reporte ──
  readonly motivoReporte = signal('');

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly esPropio = computed(() => this.proveedor().es_propio === true);
  readonly esPropietario = computed(() => this.proveedor().es_propietario === true);
  readonly estaArchivado = computed(() => this.proveedor().estado_interno === 'ARCHIVADO');

  /** Editar la ficha solo lo puede quien la creó: para los demás es el directorio de todos. */
  readonly puedeEditarFicha = computed(() => this.esPropietario() && this.permisos().editar);
  readonly puedeVerPrecios = computed(() => this.permisos().precios);

  /**
   * ¿Hay algo que enseñar en «Dónde está»?
   *
   * El formulario solo pide la dirección, así que ciudad, región y zonas vienen vacías en casi
   * todos los proveedores nuevos. Un bloque con tres guiones ocupa sitio y no dice nada: si no
   * hay nada, el bloque no se pinta.
   */
  readonly tieneUbicacion = computed(() => {
    const p = this.proveedor();
    return !!p.direccion || !!p.ciudad || (p.zonas_cobertura?.length ?? 0) > 0;
  });

  readonly tieneCondiciones = computed(() => {
    const p = this.proveedor();
    return p.pedido_minimo !== undefined
      || p.tiempo_entrega_hrs != null
      || !!p.metodos_pago
      || !!p.observaciones
      || (p.dias_entrega?.length ?? 0) > 0;
  });

  readonly diasTexto = computed(() => {
    const dias = this.proveedor().dias_entrega ?? [];
    if (!dias.length) return null;
    if (dias.length === 7) return 'Todos los días';
    return dias.map((d) => DIAS_CORTOS[d] ?? '').filter(Boolean).join(', ');
  });

  readonly atencionTexto = computed(() => ({
    ENTREGA: 'Entrega a domicilio',
    RECOGIDA: 'Recogida en su bodega',
    AMBOS: 'Entrega y recogida',
  }[this.proveedor().tipo_atencion] ?? ''));

  readonly insumosPropios = computed(() => this.insumos().filter((i) => i.es_propio));
  readonly insumosAjenos = computed(() => this.insumos().filter((i) => !i.es_propio));

  readonly totalComprado = computed(() =>
    this.compras().filter((c) => c.estado === 'A').reduce((s, c) => s + c.total, 0),
  );

  readonly whatsappUrl = computed(() => {
    const n = (this.proveedor().whatsapp || '').replace(/[^\d+]/g, '');
    if (!n) return null;
    // Sin texto previo a propósito: cada negocio escribe su propio mensaje y uno genérico
    // («Hola, soy de…») obliga a borrarlo antes de escribir el de verdad.
    return `https://wa.me/${n.replace(/^\+/, '')}`;
  });

  /**
   * Carga lo privado cuando cambia el proveedor abierto.
   *
   * `untracked` alrededor de las escrituras: los `set` de abajo no deben volver a disparar el
   * efecto, y sin él la carga de insumos se reengancharía sola en bucle.
   */
  private readonly alAbrir = effect(() => {
    const p = this.proveedor();
    untracked(() => {
      this.insumos.set(p.insumos ?? []);
      this.notas.set(p.notas ?? '');
      this.condiciones.set(p.condiciones_propias ?? '');
      this.calificacion.set(p.calificacion ?? null);
      this.pestana.set('info');
      this.subModal.set(null);
      if (this.esPropio() && this.permisos().precios) this.cargarCompras();
    });
  });

  // ============================================================
  // Insumos
  // ============================================================

  recargarInsumos(): void {
    const id = this.negocioId();
    if (!id) return;
    this.api.insumos(this.proveedor().id_proveedor, id).subscribe({
      next: (res) => this.insumos.set(res?.data ?? []),
    });
  }

  abrirInsumo(insumo: InsumoProveedor | null): void {
    this.insumoEditando.set(insumo);
    this.iNombre.set(insumo?.nombre ?? '');
    this.iCategoria.set(insumo?.id_categoria_prov ?? null);
    this.iIngrediente.set(insumo?.id_ingrediente ?? null);
    this.iUnidad.set(insumo?.unidad ?? 'UN');
    this.iPresentacion.set(insumo?.presentacion ?? '');
    this.iCantidad.set(insumo?.cantidad_presentacion ?? null);
    this.iPrecio.set(insumo?.precio ?? null);
    this.iPublico.set(Boolean(insumo?.precio_publico));
    this.iDisponible.set(insumo ? insumo.disponible : true);
    this.iMarca.set(insumo?.marca ?? '');
    this.iCodigo.set(insumo?.codigo_proveedor ?? '');
    this.iNotas.set(insumo?.notas ?? '');
    this.subModal.set('insumo');
  }

  guardarInsumo(): void {
    const idNegocio = this.negocioId();
    if (!idNegocio || this.guardando()) return;

    const nombre = this.iNombre().trim();
    if (nombre.length < 2) {
      this.ui.warning('Escribe el nombre del insumo.');
      return;
    }

    const payload: InsumoPayload = {
      id_negocio: idNegocio,
      nombre,
      id_categoria_prov: this.iCategoria(),
      id_ingrediente: this.iIngrediente(),
      unidad: this.iUnidad(),
      presentacion: this.iPresentacion().trim() || null,
      cantidad_presentacion: this.iCantidad(),
      precio: this.iPrecio(),
      publico: this.iPublico(),
      disponible: this.iDisponible(),
      marca: this.iMarca().trim() || null,
      codigo_proveedor: this.iCodigo().trim() || null,
      notas: this.iNotas().trim() || null,
    };

    this.guardando.set(true);
    const editando = this.insumoEditando();
    const peticion = editando
      ? this.api.actualizarInsumo(editando.id_proveedor_insumo, payload)
      : this.api.crearInsumo(this.proveedor().id_proveedor, payload);

    peticion.subscribe({
      next: () => {
        this.guardando.set(false);
        this.subModal.set(null);
        this.ui.success(editando ? 'Insumo actualizado.' : 'Insumo agregado.');
        this.recargarInsumos();
        this.cambiado.emit();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudo guardar el insumo.');
      },
    });
  }

  async eliminarInsumo(insumo: InsumoProveedor): Promise<void> {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    const confirmado = await this.ui.confirm({
      title: 'Quitar insumo',
      message: `«${insumo.nombre}» dejará de aparecer en este proveedor. Las compras ya registradas se conservan.`,
      confirmText: 'Quitar',
      tone: 'warning',
    });
    if (!confirmado) return;

    this.api.eliminarInsumo(insumo.id_proveedor_insumo, idNegocio).subscribe({
      next: () => {
        this.ui.deleted('El insumo ya no aparece en este proveedor.');
        this.recargarInsumos();
        this.cambiado.emit();
      },
      error: (err) => this.ui.error(err?.error?.message ?? 'No se pudo quitar el insumo.'),
    });
  }

  verHistorial(insumo: InsumoProveedor): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    this.historialDe.set(insumo);
    this.historial.set([]);
    this.cargandoHistorial.set(true);
    this.subModal.set('precios');

    this.api.historicoPrecios(insumo.id_proveedor_insumo, idNegocio).subscribe({
      next: (res) => {
        this.historial.set(res?.data ?? []);
        this.cargandoHistorial.set(false);
      },
      error: () => {
        this.historial.set([]);
        this.cargandoHistorial.set(false);
      },
    });
  }

  /**
   * De cuánto subió o bajó respecto al punto anterior, en porcentaje.
   *
   * El histórico llega del más reciente al más antiguo, así que «el anterior» es el siguiente
   * de la lista. `null` en el último punto: no hay con qué compararlo.
   */
  variacion(indice: number): number | null {
    const puntos = this.historial();
    const actual = puntos[indice];
    const previo = puntos[indice + 1];
    if (!actual || !previo || !previo.precio) return null;
    return ((actual.precio - previo.precio) / previo.precio) * 100;
  }

  // ============================================================
  // Compras del proveedor
  // ============================================================

  cargarCompras(): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;
    this.cargandoCompras.set(true);
    this.api.compras(idNegocio, {
      idProveedor: this.proveedor().id_proveedor, limite: 50, anuladas: true,
    }).subscribe({
      next: (res) => {
        this.compras.set(res?.data?.items ?? []);
        this.cargandoCompras.set(false);
      },
      error: () => {
        this.compras.set([]);
        this.cargandoCompras.set(false);
      },
    });
  }

  // ============================================================
  // Notas privadas
  // ============================================================

  guardarNotas(): void {
    const idNegocio = this.negocioId();
    if (!idNegocio || this.guardando()) return;

    this.guardando.set(true);
    this.api.guardarPrivado(this.proveedor().id_proveedor, {
      id_negocio: idNegocio,
      notas: this.notas().trim() || null,
      condiciones: this.condiciones().trim() || null,
      calificacion: this.calificacion(),
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.ui.updated('Tus notas sobre este proveedor quedaron guardadas.');
        this.cambiado.emit();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudieron guardar las notas.');
      },
    });
  }

  ponerCalificacion(valor: number): void {
    this.calificacion.update((actual) => (actual === valor ? null : valor));
  }

  // ============================================================
  // Visibilidad y reporte
  // ============================================================

  cambiarVisibilidad(valor: Visibilidad): void {
    const idNegocio = this.negocioId();
    if (!idNegocio || this.guardando()) return;

    this.guardando.set(true);
    this.api.cambiarVisibilidad(this.proveedor().id_proveedor, idNegocio, valor).subscribe({
      next: () => {
        this.guardando.set(false);
        this.subModal.set(null);
        this.ui.updated('Visibilidad actualizada.');
        this.cambiado.emit();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudo cambiar la visibilidad.');
      },
    });
  }

  enviarReporte(): void {
    const idNegocio = this.negocioId();
    const motivo = this.motivoReporte().trim();
    if (!idNegocio || motivo.length < 5) {
      this.ui.warning('Cuéntanos qué información está mal (mínimo 5 caracteres).');
      return;
    }

    this.guardando.set(true);
    this.api.reportar(this.proveedor().id_proveedor, idNegocio, motivo).subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.subModal.set(null);
        this.motivoReporte.set('');
        this.ui.success(res?.message ?? 'Gracias por avisar.');
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message ?? 'No se pudo enviar el reporte.');
      },
    });
  }

  // ============================================================
  // Varios
  // ============================================================

  cerrarSubModal(): void {
    if (!this.guardando()) this.subModal.set(null);
  }

  irAPestana(p: Pestana): void {
    this.pestana.set(p);
    if (p === 'compras' && !this.compras().length && !this.cargandoCompras()) this.cargarCompras();
  }

  unidadTexto(u: UnidadInsumo | string): string {
    return UNIDADES.find((x) => x.valor === u)?.texto ?? String(u);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.guardando()) return;
    if (this.subModal()) this.subModal.set(null);
    else this.cerrar.emit();
  }
}
