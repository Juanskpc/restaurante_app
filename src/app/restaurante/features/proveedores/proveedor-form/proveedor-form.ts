import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, input,
  output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import {
  CategoriaProveedor, Proveedor, ProveedorPayload, TipoAtencion, Visibilidad,
} from '../../../../core/services/proveedores.service';
import { TelefonoPaisComponent } from '../../../shared/telefono-pais/telefono-pais';

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
    texto: 'Otros negocios ven el nombre, la categoría, el contacto y qué vende. Sin precios.',
    icono: 'eye',
  },
  {
    valor: 'DIRECTORIO_SIN_PRECIOS',
    titulo: 'Compartir sin precios',
    texto: 'Además ven la dirección y las condiciones. Tus precios siguen siendo tuyos.',
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
 * ## Por qué pide tan poco
 *
 * Esto es un manejo interno: «a X proveedor le compro X producto y este es su contacto». Un
 * formulario con razón social, NIT, cobertura, pedido mínimo y días de entrega es un formulario
 * que nadie llena — y un proveedor sin registrar no sirve de nada. Se piden cinco datos y la
 * visibilidad; lo demás (insumos, precios, notas) se añade desde la ficha, cuando hace falta.
 *
 * Lo único obligatorio es el nombre.
 *
 * ## Lo que no se ve pero sigue ahí
 *
 * El backend reescribe la ficha entera al editar, así que los campos que este formulario ya no
 * muestra —los que pudo cargar una versión anterior o el directorio— se guardan en
 * `ocultos` y se devuelven tal cual. Sin eso, abrir y guardar un proveedor antiguo le borraría
 * en silencio la mitad de la ficha.
 *
 * ## El contacto es uno solo
 *
 * Se guarda en `telefono` **y** en `whatsapp`. En un proveedor de barrio es el mismo número, y
 * pedirlo dos veces para que funcionen los botones de «Llamar» y «WhatsApp» es trabajo que el
 * formulario puede hacer por su cuenta.
 */
@Component({
  selector: 'app-proveedor-form',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, TelefonoPaisComponent],
  templateUrl: './proveedor-form.html',
  styleUrl: './proveedor-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProveedorFormComponent {
  private readonly host = inject(ElementRef);

  /** `null` = alta. Con ficha = edición. */
  readonly proveedor = input<Proveedor | null>(null);
  readonly categorias = input<CategoriaProveedor[]>([]);
  readonly guardando = input(false);
  /** Sin este permiso la sección de visibilidad se enseña bloqueada, no escondida. */
  readonly puedePublicar = input(false);

  readonly guardar = output<Omit<ProveedorPayload, 'id_negocio'>>();
  readonly cerrar = output<void>();

  readonly visibilidades = VISIBILIDADES;

  // ── Los seis campos ──
  readonly nombre = signal('');
  readonly contacto = signal('');
  readonly categoria = signal<string | null>(null);
  readonly sitioWeb = signal('');
  readonly direccion = signal('');
  readonly visibilidad = signal<Visibilidad>('PRIVADO');

  /** Buscador de la categoría; también es lo que se ve cuando hay una elegida. */
  readonly buscaCategoria = signal('');
  readonly listaAbierta = signal(false);

  /** Intento de guardar con el formulario incompleto: enciende los mensajes de validación. */
  readonly intentado = signal(false);

  /**
   * Lo que la ficha ya tenía y este formulario no muestra. Se devuelve intacto al guardar.
   * Ver la nota de la cabecera: el backend reescribe la ficha entera.
   */
  private ocultos: Partial<ProveedorPayload> = {};

  readonly esEdicion = computed(() => this.proveedor() !== null);

  readonly categoriaElegida = computed<CategoriaProveedor | null>(
    () => this.categorias().find((c) => c.codigo === this.categoria()) ?? null,
  );

  readonly categoriasFiltradas = computed(() => {
    const q = this.buscaCategoria().trim().toLowerCase();
    const todas = this.categorias();
    // Con una ya elegida, el campo muestra su nombre: filtrar por ese texto dejaría la lista
    // con un solo elemento y haría imposible cambiarla sin borrar antes.
    if (!q || q === this.categoriaElegida()?.nombre.toLowerCase()) return todas;
    return todas.filter((c) => c.nombre.toLowerCase().includes(q));
  });

  readonly errorNombre = computed(() =>
    this.intentado() && this.nombre().trim().length < 2
      ? 'Escribe el nombre con el que conoces a este proveedor.'
      : null,
  );

  readonly puedeGuardar = computed(() => this.nombre().trim().length >= 2 && !this.guardando());

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
    this.contacto.set(p.whatsapp || p.telefono || '');
    this.sitioWeb.set(p.sitio_web ?? '');
    this.direccion.set(p.direccion ?? '');
    this.visibilidad.set(p.visibilidad ?? 'PRIVADO');

    const primera = (p.categorias ?? [])[0] ?? null;
    this.categoria.set(primera?.codigo ?? null);
    this.buscaCategoria.set(primera?.nombre ?? '');

    this.ocultos = {
      nombre_legal: p.nombre_legal ?? null,
      identificacion: p.identificacion ?? null,
      descripcion: p.descripcion ?? null,
      persona_contacto: p.persona_contacto ?? null,
      email: p.email ?? null,
      redes: p.redes ?? {},
      ciudad: p.ciudad ?? null,
      region: p.region ?? null,
      pais: p.pais ?? 'Colombia',
      zonas_cobertura: p.zonas_cobertura ?? [],
      tipo_atencion: (p.tipo_atencion ?? 'AMBOS') as TipoAtencion,
      pedido_minimo: p.pedido_minimo ?? 0,
      dias_entrega: p.dias_entrega ?? [],
      tiempo_entrega_hrs: p.tiempo_entrega_hrs ?? null,
      metodos_pago: p.metodos_pago ?? null,
      precios_mayoristas: p.precios_mayoristas ?? false,
      observaciones: p.observaciones ?? null,
    };

    this.intentado.set(false);
    this.listaAbierta.set(false);
  });

  private limpiar(): void {
    this.nombre.set('');
    this.contacto.set('');
    this.categoria.set(null);
    this.buscaCategoria.set('');
    this.sitioWeb.set('');
    this.direccion.set('');
    this.visibilidad.set('PRIVADO');
    this.intentado.set(false);
    this.listaAbierta.set(false);
    this.ocultos = {};
  }

  // ── Categoría ──

  abrirLista(): void {
    this.listaAbierta.set(true);
  }

  alEscribirCategoria(texto: string): void {
    this.buscaCategoria.set(texto);
    this.listaAbierta.set(true);
    // Borrar el texto suelta la categoría: si no, quedaría elegida una que ya no se lee.
    if (!texto.trim()) this.categoria.set(null);
  }

  elegirCategoria(c: CategoriaProveedor): void {
    this.categoria.set(c.codigo);
    this.buscaCategoria.set(c.nombre);
    this.listaAbierta.set(false);
  }

  limpiarCategoria(): void {
    this.categoria.set(null);
    this.buscaCategoria.set('');
    this.listaAbierta.set(true);
  }

  elegirVisibilidad(valor: Visibilidad): void {
    if (valor !== 'PRIVADO' && !this.puedePublicar()) return;
    this.visibilidad.set(valor);
  }

  enviar(): void {
    this.intentado.set(true);
    if (!this.puedeGuardar()) return;

    const contacto = this.contacto().trim() || null;

    this.guardar.emit({
      ...this.ocultos,
      nombre_comercial: this.nombre().trim(),
      // Un solo número para las dos acciones. Ver la nota de la cabecera.
      telefono: contacto,
      whatsapp: contacto,
      sitio_web: this.sitioWeb().trim() || null,
      direccion: this.direccion().trim() || null,
      visibilidad: this.visibilidad(),
      categorias: this.categoria() ? [this.categoria()!] : [],
    });
  }

  /** La lista de categorías se cierra al pulsar fuera, como cualquier desplegable. */
  @HostListener('document:click', ['$event'])
  cerrarListaSiFuera(evento: MouseEvent): void {
    if (!this.listaAbierta()) return;
    const campo = this.host.nativeElement.querySelector('.combo');
    if (campo && !campo.contains(evento.target as Node)) this.listaAbierta.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.listaAbierta()) {
      this.listaAbierta.set(false);
      return;
    }
    if (!this.guardando()) this.cerrar.emit();
  }
}
