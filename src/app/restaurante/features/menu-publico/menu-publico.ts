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
import { catchError, forkJoin, of } from 'rxjs';

import { CarritoService, MesaElegida, Modalidad, claveLinea } from './carrito.service';
import {
  CampoCliente,
  ETIQUETAS,
  MAXIMOS,
  limpiarTelefono,
  requisitos,
  validarCliente,
} from './datos-cliente';
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
  /** Solo lo que se puede quitar (id y nombre): sin cantidades, stock ni costos. Puede faltar con un backend anterior. */
  ingredientes_removibles?: { id_ingrediente: number; nombre: string }[];
}

/** Barrio con su precio de domicilio, tal como lo devuelve `/public/negocios/:id/barrios`. */
interface BarrioPublico {
  id_barrio: number;
  nombre: string;
  valor: number;
}

/** Cuál de los pasos de «¿cómo quieres pedir?» toca ahora. */
type PasoEleccion = 'modalidad' | 'barrio' | 'mesa';

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

/** Los cuatro estados de `horarioService.estadoDeAtencion` — mismo que lee el saludo del bot. */
type EstadoAtencion = 'abierto' | 'fuera_de_horario' | 'aun_no_abre' | 'cerrado_sin_horario';

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
  /** Puede faltar con un backend anterior; en ese caso se trata como "abierto" (ver `atendiendoAhora`). */
  atencion?: { estado: EstadoAtencion } | null;
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
   * ¿La carta ofrece pedir? Hacen falta un WhatsApp publicado al que escribir y un plan que
   * incluya los pedidos desde la carta (`carta.puede_pedir`; si la respuesta no lo trae, se
   * conserva el comportamiento de antes de existir los planes). Falso = carta de solo lectura:
   * los botones NO se muestran.
   */
  readonly pedidosHabilitados = computed(() => {
    const negocio = this.negocio();
    if (!negocio?.url_whatsapp) return false;
    return negocio.carta?.puede_pedir ?? true;
  });

  /**
   * ¿Está el negocio atendiendo AHORA MISMO? Mismo estado que usa el saludo del bot
   * (`horarioService.estadoDeAtencion`): horario y caja cruzados en un solo sitio. Falso = los
   * botones se VEN pero desactivados (2026-09-24: sustituye a la franja de aviso).
   *
   * `undefined` en la respuesta (backend anterior a este campo) se trata como "abierto".
   */
  readonly atendiendoAhora = computed(() => (this.negocio()?.atencion?.estado ?? 'abierto') === 'abierto');

  readonly textoFueraDeHorario = 'Disponible en horario de atención';

  // ── ¿Cómo quieres pedir? ──────────────────────────────────────────────────────────────
  //
  // Antes de los productos: en el local / a domicilio / recoger. Solo cuando se puede pedir y el
  // negocio atiende ahora. El estado inicial es el mismo en el servidor y en el navegador; lo
  // que el cliente eligió antes se restaura DESPUÉS, en `carrito.iniciar` (solo navegador).

  /** Barrios con precio (solo si el negocio cobra el domicilio por barrio) y mesas activas. */
  readonly barriosInfo = signal<{ habilitado: boolean; barrios: BarrioPublico[] }>({
    habilitado: false,
    barrios: [],
  });
  readonly mesas = signal<MesaElegida[]>([]);
  /** Hasta que llegan barrios y mesas no se muestra el selector: no parpadea con opciones a medias. */
  readonly eleccionCargada = signal(false);
  /** «Cambiar»: vuelve al primer paso aunque ya haya una elección. */
  private readonly forzarInicio = signal(false);

  readonly hayBarrios = computed(
    () => this.barriosInfo().habilitado && this.barriosInfo().barrios.length > 0,
  );
  readonly hayMesas = computed(() => this.mesas().length > 0);

  /** El paso que toca, o `null` si la elección está completa. */
  readonly pasoEleccion = computed<PasoEleccion | null>(() => {
    const modalidad = this.carrito.modalidad();
    if (this.forzarInicio() || modalidad === null) return 'modalidad';
    if (modalidad === 'D' && this.hayBarrios() && this.carrito.barrio() === null) return 'barrio';
    if (modalidad === 'L' && this.carrito.mesa() === null) return 'mesa';
    return null;
  });

  /** El selector se ve solo cuando se puede pedir, se atiende ahora y falta elegir algo. */
  readonly mostrarSelector = computed(
    () =>
      this.pedidosHabilitados() &&
      this.atendiendoAhora() &&
      !this.esVistaPrevia() &&
      this.eleccionCargada() &&
      this.pasoEleccion() !== null,
  );

  /** ¿Se ofrece cambiar lo elegido? Solo con elección completa y pedido posible. */
  readonly mostrarChip = computed(
    () =>
      this.pedidosHabilitados() &&
      this.atendiendoAhora() &&
      !this.esVistaPrevia() &&
      this.eleccionCargada() &&
      this.pasoEleccion() === null,
  );

  /** «A domicilio · Centro · $4.500», «Para recoger», «En el local · Mesa 3». */
  readonly resumenEleccion = computed(() => {
    const barrio = this.carrito.barrio();
    switch (this.carrito.modalidad()) {
      case 'D':
        if (!barrio) return 'A domicilio';
        return barrio.id_barrio === 0
          ? 'A domicilio · Otro barrio'
          : `A domicilio · ${barrio.nombre} · ${this.formatPrice(barrio.valor ?? 0)}`;
      case 'R':
        return 'Para recoger en el local';
      case 'L':
        return `En el local · ${this.carrito.mesa()?.nombre ?? ''}`.trim();
      default:
        return '';
    }
  });

  /**
   * La nota bajo el total: solo nombra el recargo que de verdad puede aplicar, y en mesa no hay
   * ninguno (no hay empaque ni domicilio), así que ahí no se muestra nada (`''`).
   */
  readonly notaTotal = computed(() => {
    const base = 'El total final lo confirma el restaurante';
    switch (this.carrito.modalidad()) {
      case 'D':
        return this.carrito.domicilio() > 0
          ? `${base}: puede variar por el empaque.`
          : `${base}: no incluye el domicilio y puede variar por el empaque.`;
      case 'R':
        return `${base}: puede variar por el empaque.`;
      case 'L':
        return '';
      default:
        return `${base}: puede subir por el empaque o el domicilio.`;
    }
  });

  elegirModalidad(modalidad: Modalidad): void {
    this.forzarInicio.set(false);
    this.carrito.elegirModalidad(modalidad);
  }

  elegirBarrio(barrio: BarrioPublico | null): void {
    this.carrito.elegirBarrio(
      barrio
        ? { id_barrio: barrio.id_barrio, nombre: barrio.nombre, valor: barrio.valor }
        : { id_barrio: 0, nombre: 'Otro barrio', valor: null },
    );
  }

  elegirMesa(mesa: MesaElegida): void {
    this.carrito.elegirMesa(mesa);
  }

  cambiarEleccion(): void {
    this.forzarInicio.set(true);
  }

  /**
   * Lee barrios y mesas del negocio. Un fallo de cualquiera de las dos NO tumba la carta:
   * sin barrios el domicilio se pide sin barrio, sin mesas «En el local» no aparece.
   */
  private cargarEleccion(idNegocio: number): void {
    if (!this.pedidosHabilitados()) {
      this.eleccionCargada.set(true);
      return;
    }
    const base = `${environment.apiUrl}/public/negocios/${idNegocio}`;
    forkJoin({
      barrios: this.http
        .get<{ data: { habilitado: boolean; barrios: BarrioPublico[] } }>(`${base}/barrios`)
        .pipe(catchError(() => of(null))),
      mesas: this.http
        .get<{ data: MesaElegida[] }>(`${base}/mesas`)
        .pipe(catchError(() => of(null))),
    }).subscribe(({ barrios, mesas }) => {
      this.barriosInfo.set(barrios?.data ?? { habilitado: false, barrios: [] });
      this.mesas.set(mesas?.data ?? []);
      this.reconciliarEleccion();
      this.eleccionCargada.set(true);
    });
  }

  /**
   * Lo guardado de otra visita puede haber dejado de valer: un barrio borrado, una mesa
   * desactivada, «en el local» en un negocio sin mesas. Se suelta y se vuelve a preguntar.
   * Y una mesa en la URL (`?mesa=<id>`, el QR de la mesa) manda sobre lo guardado.
   */
  private reconciliarEleccion(): void {
    const modalidad = this.carrito.modalidad();
    const barrio = this.carrito.barrio();
    if (modalidad === 'D' && barrio && barrio.id_barrio !== 0) {
      const sigue = this.barriosInfo().barrios.some((b) => b.id_barrio === barrio.id_barrio);
      if (!sigue || !this.hayBarrios()) this.carrito.elegirBarrio(null);
    }
    if (modalidad === 'D' && barrio && !this.hayBarrios()) this.carrito.elegirBarrio(null);
    if (modalidad === 'L') {
      const mesa = this.carrito.mesa();
      if (!this.hayMesas()) this.carrito.elegirModalidad(null);
      else if (mesa && !this.mesas().some((m) => m.id_mesa === mesa.id_mesa)) {
        this.carrito.elegirMesa(null);
      }
    }

    const deLaUrl = Number(this.route.snapshot.queryParamMap.get('mesa'));
    if (Number.isInteger(deLaUrl) && deLaUrl > 0) {
      const mesa = this.mesas().find((m) => m.id_mesa === deLaUrl);
      if (mesa) {
        this.carrito.elegirModalidad('L');
        this.carrito.elegirMesa(mesa);
      }
    }
  }

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

  /** Las fuentes de la carta ya bajaron (o pasó el tope de espera): ver `preparando`. */
  private readonly fuentesListas = signal(false);

  /**
   * ¿Ya hay con qué pintar la carta CON SU IDENTIDAD? Negocio (y con él su diseño y colores),
   * carta, elección de modalidad y fuentes. Mientras falte algo no se enseña nada de la carta: el
   * visitante veía primero el pie de EscalApp y un esqueleto con los colores por defecto, y
   * después el cambio a los de la marca. Un negocio inválido o sin plan también es «listo»: ahí
   * lo que se muestra es el aviso, y no hay nada más que esperar.
   */
  private readonly datosListos = computed(() => {
    if (this.negocioInvalido() || this.planInactivo()) return !this.cargandoNegocio();
    if (!this.negocio()) return false;
    return !this.cargandoNegocio() && !this.cargandoCarta() && this.eleccionCargada();
  });

  /** Pantalla de «Procesando» encima de la carta. La vista previa del panel nunca la lleva. */
  readonly preparando = computed(
    () => !this.esVistaPrevia() && !(this.datosListos() && this.fuentesListas()),
  );

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
    if (!url || !isPlatformBrowser(this.platformId)) {
      this.hojaFuentesLista.set(true);
      return;
    }
    if (this.document.head.querySelector(`link[data-carta-fuentes="${url}"]`)) return;
    this.hojaFuentesLista.set(false);
    const enlace = this.document.createElement('link');
    enlace.onload = enlace.onerror = () => this.hojaFuentesLista.set(true);
    enlace.rel = 'stylesheet';
    enlace.href = url;
    enlace.setAttribute('data-carta-fuentes', url);
    this.document.head.appendChild(enlace);
  });

  /** La hoja de Google Fonts ya llegó. Sin diseño con fuentes que pedir no hay nada que esperar. */
  private readonly hojaFuentesLista = signal(true);

  /**
   * Con los datos ya pintados (aunque todavía tapados) se espera a las fuentes: destapar antes las
   * cambiaría a la vista. Tope de 4 s para que una fuente lenta no deje el «Procesando» puesto.
   */
  private readonly esperaFuentes = effect((onCleanup) => {
    if (!this.datosListos() || this.fuentesListas()) return;
    if (!isPlatformBrowser(this.platformId)) {
      this.fuentesListas.set(true);
      return;
    }
    const listo = () => this.fuentesListas.set(true);
    const tope = setTimeout(listo, 4000);
    onCleanup(() => clearTimeout(tope));
    // Leído aquí para que el efecto se repita cuando la hoja llegue.
    if (!this.hojaFuentesLista()) return;
    requestAnimationFrame(() => (this.document.fonts?.ready ?? Promise.resolve()).then(listo));
  });

  /**
   * Con el selector «¿Cómo quieres pedir?» abierto la carta de atrás NO se mueve: sin esto un
   * gesto fuera de las tarjetas arrastraba el fondo.
   */
  private readonly bloqueoScrollSelector = effect((onCleanup) => {
    if (!isPlatformBrowser(this.platformId) || !this.mostrarSelector()) return;
    const { documentElement, body } = this.document;
    const antes = [documentElement.style.overflow, body.style.overflow];
    documentElement.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    onCleanup(() => {
      documentElement.style.overflow = antes[0];
      body.style.overflow = antes[1];
    });
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
      this.eleccionCargada.set(false);
      this.forzarInicio.set(false);
      this.secciones.set([]);
      this.categoriaActiva.set(null);
      this.negocioId.set(id);
      this.fuentesListas.set(false);
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
    if (!this.atendiendoAhora()) return;
    // Con ingredientes que se pueden quitar, el «+» abre SIEMPRE el modal (aunque ya haya líneas
    // de ese producto): quien pide una segunda hamburguesa puede querer otra distinta. Sin
    // removibles se agrega directo, como siempre.
    if (this.removiblesDe(prod).length > 0) {
      this.abrirModalIngredientes(prod);
      return;
    }
    this.carrito.agregar({
      id_producto: prod.id_producto,
      nombre: prod.nombre,
      precio: prod.precio,
    });
  }

  quitarDelCarrito(idProducto: number): void {
    this.carrito.quitar(idProducto);
  }

  /** Suma o resta UNA línea del pre-pedido (producto + lo que se le quitó). */
  ajustarLinea(clave: string, delta: number): void {
    this.carrito.sumarALinea(clave, delta);
  }

  protected claveDe = claveLinea;

  /** «sin cebolla, sin tomate». */
  protected textoSin(exclusiones: { nombre: string }[]): string {
    return exclusiones.map((e) => `sin ${e.nombre}`).join(', ');
  }

  // ── Modal «¿quitar algún ingrediente?» ────────────────────────────────────────────────
  //
  // Se abre desde el «+» de un producto con ingredientes removibles. Todos vienen incluidos;
  // el cliente marca «quitar» en los que no quiere y confirma con un toque. SSR-safe: solo
  // toca el DOM (foco) en el navegador.

  readonly modalProducto = signal<ProductoPublico | null>(null);
  readonly quitarSel = signal<ReadonlySet<number>>(new Set());
  private readonly modalRef = viewChild<ElementRef<HTMLElement>>('modalIngredientes');
  private focoPrevio: HTMLElement | null = null;

  protected removiblesDe(prod: ProductoPublico): { id_ingrediente: number; nombre: string }[] {
    return prod.ingredientes_removibles ?? [];
  }

  private abrirModalIngredientes(prod: ProductoPublico): void {
    if (isPlatformBrowser(this.platformId)) {
      this.focoPrevio = this.document.activeElement as HTMLElement | null;
    }
    this.quitarSel.set(new Set());
    this.modalProducto.set(prod);
    if (isPlatformBrowser(this.platformId)) {
      // El foco entra al diálogo en cuanto se pinta.
      setTimeout(() => this.modalRef()?.nativeElement.querySelector<HTMLElement>('input, button')?.focus());
    }
  }

  cerrarModalIngredientes(): void {
    this.modalProducto.set(null);
    if (isPlatformBrowser(this.platformId)) {
      this.focoPrevio?.focus();
      this.focoPrevio = null;
    }
  }

  alternarQuitar(idIngrediente: number): void {
    const nuevo = new Set(this.quitarSel());
    if (nuevo.has(idIngrediente)) nuevo.delete(idIngrediente);
    else nuevo.add(idIngrediente);
    this.quitarSel.set(nuevo);
  }

  confirmarModalIngredientes(): void {
    const prod = this.modalProducto();
    if (!prod) return;
    const quitados = this.removiblesDe(prod).filter((r) => this.quitarSel().has(r.id_ingrediente));
    this.carrito.agregar(
      { id_producto: prod.id_producto, nombre: prod.nombre, precio: prod.precio },
      quitados,
    );
    this.cerrarModalIngredientes();
  }

  /** Esc cierra; Tab no sale del diálogo (foco atrapado). */
  onTeclaModal(evento: KeyboardEvent): void {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      this.cerrarModalIngredientes();
      return;
    }
    if (evento.key !== 'Tab') return;
    const foco = Array.from(
      this.modalRef()?.nativeElement.querySelectorAll<HTMLElement>('input, button:not([disabled])') ?? [],
    );
    if (foco.length === 0) return;
    const primero = foco[0];
    const ultimo = foco[foco.length - 1];
    const activo = this.document.activeElement;
    if (evento.shiftKey && activo === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && activo === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  }

  abrirPrePedido(): void {
    if (this.carrito.vacio()) return;
    this.pasoPanel.set('pedido');
    this.intentoEnvio.set(false);
    this.prePedidoAbierto.set(true);
  }

  cerrarPrePedido(): void {
    this.prePedidoAbierto.set(false);
  }

  // ── Panel «Tu pedido»: título según la modalidad y paso de datos del cliente ────────────

  /** `pedido` = la lista; `datos` = nombre, teléfono, dirección y nota antes de abrir WhatsApp. */
  readonly pasoPanel = signal<'pedido' | 'datos'>('pedido');
  /** Los errores solo se enseñan tras intentar continuar: no se le grita a quien apenas empieza. */
  readonly intentoEnvio = signal(false);

  readonly tituloPedido = computed(() => {
    switch (this.carrito.modalidad()) {
      case 'D':
        return 'Tu pedido a domicilio';
      case 'L':
        return 'Tu pedido en mesa'; // sin el nombre de la mesa
      case 'R':
        return 'Tu pedido para llevar';
      default:
        return 'Tu pedido';
    }
  });

  readonly iconoPedido = computed(() => {
    switch (this.carrito.modalidad()) {
      case 'D':
        return 'bike';
      case 'L':
        return 'armchair';
      default:
        return 'shopping-bag';
    }
  });

  readonly cliente = this.carrito.cliente;
  readonly requisitosCliente = computed(() => requisitos(this.carrito.modalidad()));

  /** Nombre y teléfono comparten renglón cuando la modalidad pide los dos: el formulario cabe. */
  readonly datosEnDosColumnas = computed(() =>
    this.requisitosCliente().some((r) => r.campo === 'telefono'),
  );
  readonly erroresCliente = computed(() => validarCliente(this.carrito.modalidad(), this.carrito.cliente()));

  protected etiquetaCampo(campo: CampoCliente): string {
    return ETIQUETAS[campo];
  }

  protected maximoCampo(campo: CampoCliente): number {
    return MAXIMOS[campo];
  }

  protected autocompletar(campo: CampoCliente): string | null {
    return { nombre: 'name', telefono: 'tel', direccion: 'street-address', nota: null }[campo];
  }

  protected mostrarError(campo: CampoCliente): boolean {
    return this.intentoEnvio() && !!this.erroresCliente()[campo];
  }

  protected cambiarCampo(campo: CampoCliente, valor: string): void {
    // El teléfono se limpia al escribir (solo dígitos y un + inicial); el resto se guarda tal cual y
    // se sanea al armar el mensaje.
    this.carrito.guardarCliente({ [campo]: campo === 'telefono' ? limpiarTelefono(valor) : valor });
  }

  /** «Continuar» del pedido: con modalidad elegida pide los datos; sin ella (caso raro) abre WhatsApp. */
  continuarDelPedido(): void {
    if (!this.carrito.modalidad()) {
      this.enviarPorWhatsApp();
      return;
    }
    this.intentoEnvio.set(false);
    this.pasoPanel.set('datos');
  }

  volverAlPedido(): void {
    this.pasoPanel.set('pedido');
  }

  /** ¿Este producto tiene ingredientes que se puedan quitar? (para «+ Otra con cambios»). */
  protected tieneRemovibles(idProducto: number): boolean {
    const prod = this.productoPorId().get(idProducto);
    return !!prod && this.removiblesDe(prod).length > 0;
  }

  /** Otra unidad DISTINTA de un producto que ya está en el pedido: abre el modal de ingredientes. */
  agregarOtraDistinta(idProducto: number): void {
    const prod = this.productoPorId().get(idProducto);
    if (prod) this.agregarAlCarrito(prod);
  }

  private readonly productoPorId = computed(() => {
    const mapa = new Map<number, ProductoPublico>();
    for (const s of this.secciones()) for (const p of s.productos) mapa.set(p.id_producto, p);
    return mapa;
  });

  /**
   * Abre WhatsApp con el pedido escrito.
   *
   * No se vacía el carrito al salir: si el cliente vuelve atrás sin enviar, encontrarlo vacío
   * sería perder su trabajo. Se marca como entregado, y con eso la próxima carga de la página
   * arranca limpia en vez de resucitar un pedido que ya salió hace días.
   */
  enviarPorWhatsApp(): void {
    // Con modalidad elegida hacen falta los datos: si falta algo se enseña qué y no se abre nada.
    if (this.carrito.modalidad()) {
      this.intentoEnvio.set(true);
      if (Object.keys(this.erroresCliente()).length > 0) {
        if (isPlatformBrowser(this.platformId)) {
          this.document.getElementById(`cli-${Object.keys(this.erroresCliente())[0]}`)?.focus();
        }
        return;
      }
    }
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
          this.cargarEleccion(idNegocio);
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
