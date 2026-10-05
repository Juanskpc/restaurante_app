import {
  ChangeDetectionStrategy, Component, HostListener, computed, effect, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import {
  CategoriaProveedor, Proveedor, ProveedorPayload, TipoAtencion, Visibilidad,
} from '../../../../core/services/proveedores.service';

/** Los días como los lee una persona. El backend los guarda 0..6 con el domingo en 0. */
const DIAS = [
  { valor: 1, corto: 'Lun' },
  { valor: 2, corto: 'Mar' },
  { valor: 3, corto: 'Mié' },
  { valor: 4, corto: 'Jue' },
  { valor: 5, corto: 'Vie' },
  { valor: 6, corto: 'Sáb' },
  { valor: 0, corto: 'Dom' },
] as const;

/**
 * Las cuatro visibilidades, explicadas en el idioma del dueño del restaurante.
 *
 * El texto importa tanto como la opción: «directorio compartido» no significa nada para quien
 * acaba de abrir la pantalla, y lo que de verdad se le está preguntando es cuánto de lo que
 * sabe de su proveedor está dispuesto a enseñarle a otros negocios.
 */
const VISIBILIDADES: ReadonlyArray<{ valor: Visibilidad; titulo: string; texto: string; icono: string }> = [
  {
    valor: 'PRIVADO',
    titulo: 'Solo para mi negocio',
    texto: 'Nadie más lo ve. Es lo normal si no quieres compartir con quién trabajas.',
    icono: 'lock',
  },
  {
    valor: 'DIRECTORIO_BASICO',
    titulo: 'Compartir lo básico',
    texto: 'Otros negocios ven el nombre, las categorías, la ciudad, el contacto y qué vende. Sin precios ni condiciones.',
    icono: 'eye',
  },
  {
    valor: 'DIRECTORIO_SIN_PRECIOS',
    titulo: 'Compartir sin precios',
    texto: 'Además ven cobertura y condiciones comerciales. Tus precios siguen siendo tuyos.',
    icono: 'users',
  },
  {
    valor: 'DIRECTORIO',
    titulo: 'Compartir con precios',
    texto: 'Lo anterior más los precios que marques como públicos, uno a uno, en cada insumo.',
    icono: 'globe',
  },
];

/**
 * ProveedorFormComponent — alta y edición de la ficha de un proveedor.
 *
 * Es un formulario largo y por eso va por secciones plegables mentales (básico, contacto,
 * ubicación, condiciones, visibilidad): en el móvil se recorre de arriba abajo sin que nada
 * quede escondido detrás de una pestaña.
 *
 * Lo único obligatorio es el nombre. Un proveedor que solo tiene nombre y teléfono ya vale la
 * pena registrarlo, y exigir más haría que nadie lo registre.
 */
@Component({
  selector: 'app-proveedor-form',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './proveedor-form.html',
  styleUrl: './proveedor-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorFormComponent {
  /** `null` = alta. Con ficha = edición. */
  readonly proveedor = input<Proveedor | null>(null);
  readonly categorias = input<CategoriaProveedor[]>([]);
  readonly guardando = input(false);
  /** Sin este permiso la sección de visibilidad se enseña bloqueada, no escondida. */
  readonly puedePublicar = input(false);

  readonly guardar = output<Omit<ProveedorPayload, 'id_negocio'>>();
  readonly cerrar = output<void>();

  readonly dias = DIAS;
  readonly visibilidades = VISIBILIDADES;

  // ── Campos ──
  readonly nombre = signal('');
  readonly nombreLegal = signal('');
  readonly identificacion = signal('');
  readonly descripcion = signal('');
  readonly cats = signal<Set<string>>(new Set());
  readonly buscaCategoria = signal('');

  readonly contacto = signal('');
  readonly telefono = signal('');
  readonly whatsapp = signal('');
  readonly email = signal('');
  readonly sitioWeb = signal('');
  readonly instagram = signal('');
  readonly facebook = signal('');

  readonly direccion = signal('');
  readonly ciudad = signal('');
  readonly region = signal('');
  readonly pais = signal('Colombia');
  readonly zonas = signal<string[]>([]);
  readonly zonaNueva = signal('');
  readonly tipoAtencion = signal<TipoAtencion>('AMBOS');

  readonly pedidoMinimo = signal<number | null>(null);
  readonly diasEntrega = signal<Set<number>>(new Set());
  readonly tiempoEntrega = signal<number | null>(null);
  readonly metodosPago = signal('');
  readonly mayoristas = signal(false);
  readonly observaciones = signal('');

  readonly visibilidad = signal<Visibilidad>('PRIVADO');

  /** Intento de guardar con el formulario incompleto: enciende los mensajes de validación. */
  readonly intentado = signal(false);

  readonly esEdicion = computed(() => this.proveedor() !== null);

  readonly categoriasFiltradas = computed(() => {
    const q = this.buscaCategoria().trim().toLowerCase();
    const todas = this.categorias();
    if (!q) return todas;
    return todas.filter((c) => c.nombre.toLowerCase().includes(q));
  });

  readonly errorNombre = computed(() =>
    this.intentado() && this.nombre().trim().length < 2
      ? 'Escribe el nombre con el que conoces a este proveedor.'
      : null,
  );

  readonly errorEmail = computed(() => {
    const v = this.email().trim();
    if (!v) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Ese correo no parece válido.';
  });

  readonly puedeGuardar = computed(
    () => this.nombre().trim().length >= 2 && !this.errorEmail() && !this.guardando(),
  );

  /**
   * Rellena el formulario cuando llega una ficha a editar.
   *
   * Va en un `effect` y no en `ngOnInit` porque el componente se crea una vez y el proveedor
   * puede cambiar: abrir «editar» sobre otro de la lista sin cerrar el modal rellenaría con
   * los datos del anterior.
   */
  private readonly rellenar = effect(() => {
    const p = this.proveedor();
    if (!p) {
      this.limpiar();
      return;
    }
    this.nombre.set(p.nombre_comercial ?? '');
    this.nombreLegal.set(p.nombre_legal ?? '');
    this.identificacion.set(p.identificacion ?? '');
    this.descripcion.set(p.descripcion ?? '');
    this.cats.set(new Set((p.categorias ?? []).map((c) => c.codigo)));

    this.contacto.set(p.persona_contacto ?? '');
    this.telefono.set(p.telefono ?? '');
    this.whatsapp.set(p.whatsapp ?? '');
    this.email.set(p.email ?? '');
    this.sitioWeb.set(p.sitio_web ?? '');
    this.instagram.set(p.redes?.['instagram'] ?? '');
    this.facebook.set(p.redes?.['facebook'] ?? '');

    this.direccion.set(p.direccion ?? '');
    this.ciudad.set(p.ciudad ?? '');
    this.region.set(p.region ?? '');
    this.pais.set(p.pais ?? 'Colombia');
    this.zonas.set([...(p.zonas_cobertura ?? [])]);
    this.tipoAtencion.set(p.tipo_atencion ?? 'AMBOS');

    this.pedidoMinimo.set(p.pedido_minimo ? Number(p.pedido_minimo) : null);
    this.diasEntrega.set(new Set(p.dias_entrega ?? []));
    this.tiempoEntrega.set(p.tiempo_entrega_hrs ?? null);
    this.metodosPago.set(p.metodos_pago ?? '');
    this.mayoristas.set(Boolean(p.precios_mayoristas));
    this.observaciones.set(p.observaciones ?? '');
    this.visibilidad.set(p.visibilidad ?? 'PRIVADO');
    this.intentado.set(false);
  });

  private limpiar(): void {
    this.nombre.set('');
    this.nombreLegal.set('');
    this.identificacion.set('');
    this.descripcion.set('');
    this.cats.set(new Set());
    this.buscaCategoria.set('');
    this.contacto.set('');
    this.telefono.set('');
    this.whatsapp.set('');
    this.email.set('');
    this.sitioWeb.set('');
    this.instagram.set('');
    this.facebook.set('');
    this.direccion.set('');
    this.ciudad.set('');
    this.region.set('');
    this.pais.set('Colombia');
    this.zonas.set([]);
    this.zonaNueva.set('');
    this.tipoAtencion.set('AMBOS');
    this.pedidoMinimo.set(null);
    this.diasEntrega.set(new Set());
    this.tiempoEntrega.set(null);
    this.metodosPago.set('');
    this.mayoristas.set(false);
    this.observaciones.set('');
    this.visibilidad.set('PRIVADO');
    this.intentado.set(false);
  }

  // ── Interacción ──

  tieneCategoria(codigo: string): boolean {
    return this.cats().has(codigo);
  }

  alternarCategoria(codigo: string): void {
    this.cats.update((actual) => {
      const copia = new Set(actual);
      if (copia.has(codigo)) copia.delete(codigo);
      else copia.add(codigo);
      return copia;
    });
  }

  tieneDia(valor: number): boolean {
    return this.diasEntrega().has(valor);
  }

  alternarDia(valor: number): void {
    this.diasEntrega.update((actual) => {
      const copia = new Set(actual);
      if (copia.has(valor)) copia.delete(valor);
      else copia.add(valor);
      return copia;
    });
  }

  agregarZona(): void {
    const z = this.zonaNueva().trim();
    if (!z) return;
    // Sin duplicados: «Norte» y «norte» son la misma zona para quien la lee.
    if (!this.zonas().some((x) => x.toLowerCase() === z.toLowerCase())) {
      this.zonas.update((lista) => [...lista, z]);
    }
    this.zonaNueva.set('');
  }

  quitarZona(zona: string): void {
    this.zonas.update((lista) => lista.filter((z) => z !== zona));
  }

  elegirVisibilidad(valor: Visibilidad): void {
    if (valor !== 'PRIVADO' && !this.puedePublicar()) return;
    this.visibilidad.set(valor);
  }

  onEnterZona(event: Event): void {
    event.preventDefault();
    this.agregarZona();
  }

  enviar(): void {
    this.intentado.set(true);
    if (!this.puedeGuardar()) return;

    const redes: Record<string, string> = {};
    if (this.instagram().trim()) redes['instagram'] = this.instagram().trim();
    if (this.facebook().trim()) redes['facebook'] = this.facebook().trim();

    this.guardar.emit({
      nombre_comercial: this.nombre().trim(),
      nombre_legal: this.nombreLegal().trim() || null,
      identificacion: this.identificacion().trim() || null,
      descripcion: this.descripcion().trim() || null,
      persona_contacto: this.contacto().trim() || null,
      telefono: this.telefono().trim() || null,
      whatsapp: this.whatsapp().trim() || null,
      email: this.email().trim() || null,
      sitio_web: this.sitioWeb().trim() || null,
      redes,
      direccion: this.direccion().trim() || null,
      ciudad: this.ciudad().trim() || null,
      region: this.region().trim() || null,
      pais: this.pais().trim() || 'Colombia',
      zonas_cobertura: this.zonas(),
      tipo_atencion: this.tipoAtencion(),
      pedido_minimo: this.pedidoMinimo() ?? 0,
      dias_entrega: [...this.diasEntrega()].sort((a, b) => a - b),
      tiempo_entrega_hrs: this.tiempoEntrega(),
      metodos_pago: this.metodosPago().trim() || null,
      precios_mayoristas: this.mayoristas(),
      observaciones: this.observaciones().trim() || null,
      visibilidad: this.visibilidad(),
      categorias: [...this.cats()],
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.guardando()) this.cerrar.emit();
  }
}
