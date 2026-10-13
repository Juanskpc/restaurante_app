import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input,
  output, signal, viewChild,
} from '@angular/core';
import {
  LucideAngularModule, LUCIDE_ICONS, LucideIconProvider, ChevronDown, Search, X,
} from 'lucide-angular';

import { EmojiCarta, GRUPOS_EMOJI, normalizar } from './emojis';

/**
 * El ícono de una categoría o de un producto: **se escribe o se elige**, las dos cosas.
 *
 * El campo era un `input` de texto suelto, y eso deja al administrador buscando el emoji en el
 * teclado del sistema o copiándolo de internet. Ahora el input sigue ahí —quien tenga el emoji
 * a mano lo pega y listo, y quien quiera uno que no está en la lista también— con un botón al
 * lado que abre una rejilla de emojis de carta agrupados y buscables.
 *
 * El valor es un **emoji**, no el nombre de un icono de Lucide: así se guarda hoy en
 * `carta_categoria.icono` / `carta_producto.icono` (varchar 50) y así lo pintan la carta
 * virtual, el POS y el tiquete. No se cambia el formato: solo la forma de escribirlo.
 *
 * ## Lo que NO hace
 *
 * No valida que lo escrito sea un emoji. Un negocio puede querer poner «1» o «A» en una
 * categoría, y rechazarlo sería inventar una regla que hoy no existe y que rompería las fichas
 * que ya están guardadas.
 *
 * Trae sus iconos consigo en vez de confiar en el registro global de `app.config.ts`, igual que
 * `telefono-pais`: así se puede usar desde cualquier pantalla sin acordarse de añadirlos allí.
 */
@Component({
  selector: 'app-icono-selector',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({ ChevronDown, Search, X }),
    },
  ],
  templateUrl: './icono-selector.html',
  styleUrl: './icono-selector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconoSelectorComponent {
  private readonly host = inject(ElementRef);

  readonly valor = input<string>('');
  readonly deshabilitado = input<boolean>(false);
  /** `id` del input, para enlazarlo con su `<label for>`. */
  readonly campoId = input<string>('icono');
  readonly placeholder = input<string>('🍔');

  readonly valorChange = output<string>();

  protected readonly abierto = signal(false);
  protected readonly busqueda = signal('');

  private readonly campoBusqueda = viewChild<ElementRef<HTMLInputElement>>('buscador');

  /**
   * 8 y no 4: un emoji con unión (👨‍🍳 son 5 unidades UTF-16) no cabía en el límite anterior,
   * así que el chef no se podía ni escribir ni pegar. La columna admite 50, así que el tope de
   * aquí solo está para que nadie meta una frase en el campo del ícono.
   */
  protected readonly maxLargo = 8;

  protected readonly grupos = computed(() => {
    const texto = normalizar(this.busqueda());
    if (!texto) return GRUPOS_EMOJI;

    // Se busca por nombre y por palabras clave; también por el propio emoji, para que pegarlo
    // en el buscador lo encuentre y se vea en qué grupo vive.
    const coincide = (x: EmojiCarta) =>
      x.e === this.busqueda().trim()
      || normalizar(x.n).includes(texto)
      || normalizar(x.k ?? '').includes(texto);

    return GRUPOS_EMOJI
      .map((g) => ({ nombre: g.nombre, emojis: g.emojis.filter(coincide) }))
      .filter((g) => g.emojis.length > 0);
  });

  protected readonly sinResultados = computed(() => this.grupos().length === 0);

  /** Lo que se pinta en el botón: el valor actual, o el placeholder en gris si está vacío. */
  protected readonly muestra = computed(() => this.valor()?.trim() || '');

  protected alternar(): void {
    if (this.deshabilitado()) return;
    const abriendo = !this.abierto();
    this.abierto.set(abriendo);
    if (!abriendo) {
      this.busqueda.set('');
      return;
    }
    // El foco va al buscador: con el panel abierto, lo siguiente que se hace es escribir.
    setTimeout(() => this.campoBusqueda()?.nativeElement.focus(), 0);
  }

  protected elegir(emoji: string): void {
    this.abierto.set(false);
    this.busqueda.set('');
    this.valorChange.emit(emoji);
  }

  protected escribir(valor: string): void {
    this.valorChange.emit(String(valor ?? '').slice(0, this.maxLargo));
  }

  protected limpiar(): void {
    this.busqueda.set('');
    this.campoBusqueda()?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  protected cerrarSiFuera(evento: MouseEvent): void {
    if (!this.abierto()) return;
    if (!this.host.nativeElement.contains(evento.target as Node)) {
      this.abierto.set(false);
      this.busqueda.set('');
    }
  }

  @HostListener('document:keydown.escape')
  protected cerrarConEscape(): void {
    if (!this.abierto()) return;
    this.abierto.set(false);
    this.busqueda.set('');
  }

  protected trackGrupo(_: number, g: { nombre: string }): string {
    return g.nombre;
  }

  protected trackEmoji(_: number, x: EmojiCarta): string {
    return x.e;
  }
}
