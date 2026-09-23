import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
  PLATFORM_ID,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { CarritoService } from './carrito.service';
import { environment } from '../../../../environments/environment';
import {
  CartaPublicaConfig,
  DISENO_POR_DEFECTO,
  DisenoCarta,
  formatoEfectivo,
  fuentesARequerir,
  inicialesNegocio,
  plantillaPorId,
  resolverTokens,
  urlGoogleFonts,
} from '../../shared/carta-diseno/carta-diseno';

interface CategoriaPublica {
  id_categoria: number;
  nombre: string;
  descripcion: string | null;
  icono: string;
  imagen_url: string | null;
  orden?: number;
}

interface ProductoPublico {
  id_producto: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  imagen_url: string | null;
  icono: string;
  es_popular: boolean;
  /** `false` = agotado. Llegan siempre; la carta decide si mostrarlos según su diseño. */
  disponible?: boolean;
}

/** Una categoría con sus productos, tal como la devuelve `/public/carta/completa`. */
interface SeccionPublica extends CategoriaPublica {
  productos: ProductoPublico[];
}

/** Una sección lista para pintar: productos ya filtrados y repartidos según el formato. */
interface SeccionVisible extends CategoriaPublica {
  productos: ProductoPublico[];
  /** Lo que va en filas. En Tarjetas no se usa. */
  enLista: ProductoPublico[];
}

interface NegocioPublico {
  id_negocio: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  url_whatsapp: string | null;
  url_facebook: string | null;
  url_instagram: string | null;
  logo_url?: string | null;
  plan_activo: boolean;
  /** Diseño publicado, ya recortado por el plan. Puede faltar con un backend anterior. */
  carta?: CartaPublicaConfig | null;
}

/** Lo que manda Configuración → Apariencia cuando esta carta se muestra como vista previa. */
interface MensajeVistaPrevia {
  tipo: 'carta-diseno';
  diseno?: DisenoCarta;
  logo_url?: string | null;
  color_negocio?: string | null;
}

/** Aire entre el borde inferior de la barra fija y el título de la sección a la que se salta. */
const RESPIRO_SECCION = 12;

@Component({
  selector: 'app-menu-publico',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './menu-publico.html',
  styleUrl: './menu-publico.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // La plantilla se aplica sobre el propio elemento y no sobre <html>: así la marca del negocio
  // no se filtra al panel cuando esta carta se muestra en la vista previa, y tampoco pisa los
  // tokens del tema si alguien navega de la carta a otra pantalla de la app.
  host: {
    '[attr.data-plantilla]': 'plantilla().id',
    '[attr.data-formato]': 'formato()',
    '[attr.data-composicion]': 'composicion()',
    '[attr.data-oscura]': 'plantilla().oscura',
    '[style]': 'estiloCarta()',
  },
})
export class MenuPublicoComponent implements OnInit, AfterViewInit, OnDestroy {
  /**
   * El carrito del menú digital.
   *
   * Vive entero en el navegador y termina en un enlace de WhatsApp: el pedido lo crea el
   * asistente cuando el cliente escribe, con su número ya verificado por Meta. Ver
   * `carrito.service.ts` para por qué eso evita construir un chat web autenticado.
   */
  readonly carrito = inject(CarritoService);

  /**
   * ¿Se muestra el botón de pedido?
   *
   * Hacen falta dos cosas: un WhatsApp publicado al que escribir y un plan que incluya los
   * pedidos desde la carta. Lo segundo lo decide el servidor (`carta.puede_pedir`); si la
   * respuesta no lo trae, se conserva el comportamiento de antes de existir los planes.
   */
  readonly puedePedir = computed(() => {
    const negocio = this.negocio();
    if (!negocio?.url_whatsapp) return false;
    return negocio.carta?.puede_pedir ?? true;
  });

  /** El panel de pre-pedido, para revisar antes de mandar. */
  readonly prePedidoAbierto = signal(false);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  readonly negocioId = signal<number | null>(null);
  readonly negocio = signal<NegocioPublico | null>(null);
  readonly secciones = signal<SeccionPublica[]>([]);
  readonly negocioInvalido = signal(false);
  readonly planInactivo = signal(false);

  readonly cargandoNegocio = signal(false);
  readonly cargandoCarta = signal(false);

  /** La categoría que se está leyendo. `null` = todavía ninguna: manda la primera. */
  readonly categoriaActiva = signal<number | null>(null);

  // ── Diseño de la carta ──

  /**
   * ¿Se está mostrando dentro de la vista previa de Configuración? En ese modo la carta pinta
   * el diseño que le manda el panel en vez del publicado, y nadie más lo ve.
   */
  readonly esVistaPrevia = signal(false);
  private readonly disenoPrevia = signal<DisenoCarta | null>(null);
  /** `undefined` = el panel no ha dicho nada y manda lo que vino del servidor. */
  private readonly logoPrevia = signal<string | null | undefined>(undefined);
  private readonly colorNegocioPrevia = signal<string | null | undefined>(undefined);

  readonly diseno = computed<DisenoCarta>(
    () => this.disenoPrevia() ?? this.negocio()?.carta ?? DISENO_POR_DEFECTO,
  );
  readonly plantilla = computed(() => plantillaPorId(this.diseno().plantilla));

  /**
   * El formato que se pinta, no el que está guardado.
   *
   * Mural y Retro se arman a dos columnas por definición, así que ignoran el formato elegido; y
   * una carta publicada con el viejo «mixto» se lee como tarjetas. Ver `formatoEfectivo`.
   */
  readonly formato = computed(() => formatoEfectivo(this.diseno(), this.plantilla()));

  /** Cómo se ARMA la carta. Es el atributo del que cuelgan los estilos de cada composición. */
  readonly composicion = computed(() => this.plantilla().composicion);

  private readonly colorNegocio = computed(() => {
    const previa = this.colorNegocioPrevia();
    return previa !== undefined ? previa : (this.negocio()?.carta?.color_negocio ?? null);
  });

  readonly estiloCarta = computed(() => resolverTokens(this.diseno(), this.colorNegocio()));

  readonly logoUrl = computed(() => {
    const previa = this.logoPrevia();
    return previa !== undefined ? previa : (this.negocio()?.logo_url ?? null);
  });
  readonly iniciales = computed(() => inicialesNegocio(this.negocio()?.nombre));

  readonly miniaturaEnLista = computed(() => this.plantilla().miniaturaEnLista);
  readonly precioConPuntos = computed(() => this.plantilla().precioConPuntos);

  /**
   * Las secciones que se pintan, una por categoría y todas seguidas.
   *
   * Una categoría sin nada que enseñar no aparece, ni en la carta ni en la barra: un botón que
   * lleva a una sección vacía es peor que no tenerlo. Los agotados cuentan como contenido solo
   * si el diseño pide mostrarlos.
   */
  readonly seccionesVisibles = computed<SeccionVisible[]>(() => {
    const mostrarAgotados = this.diseno().opciones?.mostrar_agotados === true;

    return this.secciones()
      .map((seccion) => {
        const productos = mostrarAgotados
          ? seccion.productos
          : seccion.productos.filter((p) => p.disponible !== false);
        return { ...seccion, productos, enLista: productos };
      })
      .filter((seccion) => seccion.productos.length > 0);
  });

  /** La activa, o la primera si la activa dejó de estar visible (p. ej. al ocultar agotados). */
  readonly categoriaActivaVisible = computed(() => {
    const visibles = this.seccionesVisibles();
    const activa = this.categoriaActiva();
    return visibles.some((s) => s.id_categoria === activa)
      ? activa
      : (visibles[0]?.id_categoria ?? null);
  });

  /**
   * Descarga las tipografías del diseño solo cuando hacen falta.
   *
   * La carta por defecto no descarga nada. Las demás piden una sola hoja de Google Fonts con
   * `display=swap`: mientras llega, el texto se lee con la fuente de respaldo de la pila.
   */
  private readonly cargaFuentes = effect(() => {
    const url = urlGoogleFonts(fuentesARequerir(this.diseno()));
    if (!url || !isPlatformBrowser(this.platformId)) return;
    if (this.document.head.querySelector(`link[data-carta-fuentes="${url}"]`)) return;
    const enlace = this.document.createElement('link');
    enlace.rel = 'stylesheet';
    enlace.href = url;
    enlace.setAttribute('data-carta-fuentes', url);
    this.document.head.appendChild(enlace);
  });

  readonly anio = new Date().getFullYear();
  readonly appSiteUrl = 'https://escalapp.cloud/admin/';

  /**
   * La política vive en la app de administración, que se sirve bajo `/admin/`. Es absoluta a
   * propósito: este menú es otra aplicación y no comparte router con aquella.
   *
   * Este menú es **el punto más expuesto de toda la plataforma**: lo abre alguien que no es
   * cliente nuestro ni tiene cuenta, y al pulsar «Continuar por WhatsApp» su número pasa a
   * nuestros servidores —que están en Estados Unidos—. Por eso el aviso va junto al botón que
   * inicia ese envío, que es donde se consiente.
   */
  readonly urlPrivacidad = 'https://escalapp.cloud/admin/privacidad';

  readonly socialLinks = computed(() => {
    const info = this.negocio();
    if (!info) return [];
    const links: { type: string; url: string; icon: string; label: string }[] = [];
    if (info.url_whatsapp) links.push({ type: 'whatsapp', url: info.url_whatsapp, icon: 'message-circle', label: 'WhatsApp' });
    if (info.url_facebook) links.push({ type: 'facebook', url: info.url_facebook, icon: 'facebook', label: 'Facebook' });
    if (info.url_instagram) links.push({ type: 'instagram', url: info.url_instagram, icon: 'instagram', label: 'Instagram' });
    return links;
  });

  readonly tieneSocial = computed(() => this.socialLinks().length > 0);

  readonly categoriasScroll = viewChild<ElementRef<HTMLElement>>('catScroll');
  /**
   * La barra de categorías: lo único que se queda pinchado arriba. Su alto es el que hay que
   * descontar para que el título de una sección no quede debajo de ella.
   */
  private readonly barraSuperior = viewChild<ElementRef<HTMLElement>>('barraSuperior');
  private readonly seccionesRef = viewChildren<ElementRef<HTMLElement>>('seccion');
  readonly puedeScrollIzq = signal(false);
  readonly puedeScrollDer = signal(false);

  /**
   * Mientras el scroll lo mueve un clic en una categoría, el resaltado no se recalcula: si no,
   * al pasar por las secciones intermedias la barra iría marcando cada una y el cliente vería
   * saltar el resaltado por categorías que no eligió.
   */
  private navegandoPorClic = false;
  private finDeScroll: ReturnType<typeof setTimeout> | null = null;
  private resaltadoPendiente = false;

  private readonly priceFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  ngOnInit(): void {
    this.esVistaPrevia.set(this.route.snapshot.queryParamMap.get('vista') === 'previa');

    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (!id) return;
      this.negocioInvalido.set(false);
      this.planInactivo.set(false);
      this.negocio.set(null);
      this.secciones.set([]);
      this.categoriaActiva.set(null);
      this.negocioId.set(id);
      // El carrito se ata al negocio ANTES de cargar nada: la clave de guardado lleva su id,
      // para que quien mire dos cartas distintas no se encuentre los platos de una en la otra.
      this.carrito.iniciar(id);
      this.cargarNegocio(id);
    });
  }

  ngAfterViewInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => this.actualizarFlechas());

    window.addEventListener('resize', this._onResize);
    window.addEventListener('scroll', this._onScroll, { passive: true });
    this._onScroll();

    if (this.esVistaPrevia()) {
      window.addEventListener('message', this._onMensaje);
      // Avisa al panel de que ya puede mandar el diseño: si lo mandó antes de que la carta
      // estuviera escuchando, se habría perdido.
      window.parent?.postMessage({ tipo: 'carta-lista' }, window.location.origin);
    }
  }

  ngOnDestroy(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('scroll', this._onScroll);
    window.removeEventListener('message', this._onMensaje);
    if (this.finDeScroll) clearTimeout(this.finDeScroll);
  }

  private _onResize = (): void => this.actualizarFlechas();

  private _onScroll = (): void => {
    // Fin del scroll: 120 ms sin eventos. Si lo movió un clic, se suelta el bloqueo y se deja
    // marcada la categoría elegida aunque la página no pudiera llegar hasta ella (la última
    // sección de una carta corta nunca sube hasta arriba).
    if (this.finDeScroll) clearTimeout(this.finDeScroll);
    this.finDeScroll = setTimeout(() => {
      this.finDeScroll = null;
      if (this.navegandoPorClic) {
        this.navegandoPorClic = false;
      } else {
        this.actualizarCategoriaActiva();
      }
    }, 120);

    // Durante el scroll del cliente, como mucho un recálculo por fotograma.
    if (!this.navegandoPorClic && !this.resaltadoPendiente) {
      this.resaltadoPendiente = true;
      requestAnimationFrame(() => {
        this.resaltadoPendiente = false;
        if (!this.navegandoPorClic) this.actualizarCategoriaActiva();
      });
    }
  };

  private _onMensaje = (evento: MessageEvent<MensajeVistaPrevia>): void => {
    // Solo el panel de esta misma aplicación puede cambiar lo que se ve.
    if (evento.origin !== window.location.origin) return;
    const datos = evento.data;
    if (!datos || datos.tipo !== 'carta-diseno') return;
    if (datos.diseno) this.disenoPrevia.set(datos.diseno);
    if ('logo_url' in datos) this.logoPrevia.set(datos.logo_url ?? null);
    if ('color_negocio' in datos) this.colorNegocioPrevia.set(datos.color_negocio ?? null);
  };

  actualizarFlechas(): void {
    const el = this.categoriasScroll()?.nativeElement;
    if (!el) {
      this.puedeScrollIzq.set(false);
      this.puedeScrollDer.set(false);
      return;
    }
    const tolerance = 2;
    this.puedeScrollIzq.set(el.scrollLeft > tolerance);
    this.puedeScrollDer.set(el.scrollLeft + el.clientWidth < el.scrollWidth - tolerance);
  }

  scrollCategorias(dir: 'left' | 'right'): void {
    const el = this.categoriasScroll()?.nativeElement;
    if (!el) return;
    const amount = el.clientWidth * 0.6;
    el.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
  }

  onCatScroll(): void {
    this.actualizarFlechas();
  }

  /**
   * Lleva la página a la sección de una categoría.
   *
   * Al destino se le resta el alto de la barra de categorías, que es lo único que se queda
   * pinchado arriba, para que el título de la sección no acabe debajo de ella. Se calcula a
   * mano y no con `scrollIntoView` porque ese método mueve también los
   * contenedores de la página que contiene a la carta: dentro de la vista previa de
   * Configuración desplazaba el panel entero.
   */
  irACategoria(idCategoria: number): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const seccion = this.seccionesRef()
      .map((ref) => ref.nativeElement)
      .find((el) => Number(el.dataset['categoria']) === idCategoria);
    if (!seccion) return;

    this.categoriaActiva.set(idCategoria);
    this.centrarChip(idCategoria);

    const alturaBarra = this.barraSuperior()?.nativeElement.getBoundingClientRect().height ?? 0;
    const inicio = seccion.getBoundingClientRect().top + window.scrollY;
    const maximo = this.document.documentElement.scrollHeight - window.innerHeight;
    const destino = Math.max(0, Math.min(inicio - alturaBarra - RESPIRO_SECCION, maximo));
    if (Math.abs(destino - window.scrollY) < 2) return;

    this.navegandoPorClic = true;
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: destino, behavior: suave ? 'smooth' : 'auto' });
  }

  /**
   * Marca en la barra la categoría que se está leyendo: la última cuya sección ya entró en el
   * tercio superior de lo que queda visible bajo la barra fija. Esperar a que el título tocara
   * la barra hacía que, con la sección ya a la vista y leyéndose, siguiera marcada la anterior.
   * Al tocar fondo se marca la última, que en una carta corta nunca llega tan arriba.
   */
  private actualizarCategoriaActiva(): void {
    const secciones = this.seccionesRef().map((ref) => ref.nativeElement);
    if (secciones.length === 0) return;

    const fondoBarra = this.barraSuperior()?.nativeElement.getBoundingClientRect().bottom ?? 0;
    const limite = fondoBarra + Math.max(RESPIRO_SECCION * 2, (window.innerHeight - fondoBarra) * 0.3);
    const alFondo =
      window.scrollY > 0 &&
      window.innerHeight + window.scrollY >= this.document.documentElement.scrollHeight - 4;

    let activa = Number(secciones[0].dataset['categoria']);
    if (alFondo) {
      activa = Number(secciones[secciones.length - 1].dataset['categoria']);
    } else {
      for (const seccion of secciones) {
        if (seccion.getBoundingClientRect().top > limite) break;
        activa = Number(seccion.dataset['categoria']);
      }
    }

    if (activa !== this.categoriaActivaVisible()) {
      this.categoriaActiva.set(activa);
      this.centrarChip(activa);
    }
  }

  /** Deja a la vista, en la barra, el botón de la categoría activa. Solo mueve la barra. */
  private centrarChip(idCategoria: number): void {
    const contenedor = this.categoriasScroll()?.nativeElement;
    if (!contenedor) return;
    const indice = this.seccionesVisibles().findIndex((s) => s.id_categoria === idCategoria);
    const chip = contenedor.children[indice] as HTMLElement | undefined;
    if (!chip) return;

    const caja = contenedor.getBoundingClientRect();
    const boton = chip.getBoundingClientRect();
    const izquierda = contenedor.scrollLeft + (boton.left - caja.left) - (caja.width - boton.width) / 2;
    contenedor.scrollTo({ left: Math.max(0, izquierda), behavior: 'smooth' });
  }

  agregarAlCarrito(prod: ProductoPublico): void {
    // Un agotado se muestra para que el cliente sepa que existe, no para pedirlo.
    if (prod.disponible === false) return;
    this.carrito.agregar({
      id_producto: prod.id_producto,
      nombre: prod.nombre,
      precio: prod.precio,
    });
  }

  quitarDelCarrito(idProducto: number): void {
    this.carrito.quitar(idProducto);
  }

  abrirPrePedido(): void {
    if (this.carrito.vacio()) return;
    this.prePedidoAbierto.set(true);
  }

  cerrarPrePedido(): void {
    this.prePedidoAbierto.set(false);
  }

  /**
   * Abre WhatsApp con el pedido escrito.
   *
   * No se vacía el carrito al salir: si el cliente vuelve atrás sin enviar, encontrarlo vacío
   * sería perder su trabajo. Se marca como entregado, y con eso la próxima carga de la página
   * arranca limpia en vez de resucitar un pedido que ya salió hace días.
   */
  enviarPorWhatsApp(): void {
    const enlace = this.carrito.enlaceWhatsApp(this.negocio()?.url_whatsapp);
    if (!enlace) return;
    if (!isPlatformBrowser(this.platformId)) return;
    window.open(enlace, '_blank', 'noopener');
    this.carrito.marcarEnviado();
    this.cerrarPrePedido();
  }

  formatPrice(value: number): string {
    if (!Number.isFinite(value)) return '$ 0';
    return this.priceFormatter.format(value);
  }

  /** Origen del API sin el prefijo /restaurante, para resolver rutas /uploads. */
  private readonly apiOrigin = environment.apiUrl.replace(/\/restaurante\/?$/, '');

  /** Resuelve una imagen_url relativa (/uploads/...) contra el origen del API. */
  resolveImg(url: string | null | undefined): string {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    return `${this.apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  /**
   * Carga el negocio, y con él su diseño.
   *
   * El diseño viene en la misma respuesta que el nombre, así que la carta aparece ya con su
   * marca en vez de pintarse primero con los colores de EscalApp y cambiar después.
   */
  private cargarNegocio(idNegocio: number): void {
    this.cargandoNegocio.set(true);
    this.http
      .get<{ success: boolean; data: NegocioPublico }>(
        `${environment.apiUrl}/public/negocios/${idNegocio}`,
      )
      .subscribe({
        next: (res) => {
          const negocio = res?.data ?? null;
          this.negocio.set(negocio);
          this.cargandoNegocio.set(false);

          if (!negocio) {
            this.negocioInvalido.set(true);
            return;
          }

          if (!negocio.plan_activo) {
            this.planInactivo.set(true);
            return;
          }

          this.cargarCarta(idNegocio);
        },
        error: () => {
          this.negocioInvalido.set(true);
          this.cargandoNegocio.set(false);
        },
      });
  }

  /**
   * La carta entera en una sola petición.
   *
   * Las categorías ya no se cargan al tocarlas: se pintan todas seguidas y la barra solo lleva
   * a cada una. Los agotados se piden siempre y se filtran aquí según el diseño, así la vista
   * previa puede encender «Mostrar agotados» y verlos sin publicar ni recargar.
   */
  private cargarCarta(idNegocio: number): void {
    if (this.negocioInvalido() || this.planInactivo()) return;
    this.cargandoCarta.set(true);
    this.http
      .get<{ success: boolean; data: SeccionPublica[] }>(
        `${environment.apiUrl}/public/carta/completa?id_negocio=${idNegocio}&incluir_agotados=1`,
      )
      .subscribe({
        next: (res) => {
          this.secciones.set(
            (res?.data ?? []).map((seccion) => ({ ...seccion, productos: seccion.productos ?? [] })),
          );
          this.categoriaActiva.set(null);
          this.cargandoCarta.set(false);
          setTimeout(() => this.actualizarFlechas(), 50);
        },
        error: (err) => {
          this.cargandoCarta.set(false);
          if (err?.status === 402) {
            this.planInactivo.set(true);
            this.secciones.set([]);
          }
        },
      });
  }
}
