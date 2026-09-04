import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
  PLATFORM_ID,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { CarritoService } from './carrito.service';
import { environment } from '../../../../environments/environment';

interface CategoriaPublica {
  id_categoria: number;
  nombre: string;
  descripcion: string | null;
  icono: string;
  imagen_url: string | null;
  total_productos: number;
}

interface ProductoPublico {
  id_producto: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  imagen_url: string | null;
  icono: string;
  es_popular: boolean;
}

interface NegocioPublico {
  id_negocio: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  url_whatsapp: string | null;
  url_facebook: string | null;
  url_instagram: string | null;
  plan_activo: boolean;
}

@Component({
  selector: 'app-menu-publico',
  imports: [LucideAngularModule],
  templateUrl: './menu-publico.html',
  styleUrl: './menu-publico.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuPublicoComponent implements OnInit, AfterViewInit {
  /**
   * El carrito del menú digital.
   *
   * Vive entero en el navegador y termina en un enlace de WhatsApp: el pedido lo crea el
   * asistente cuando el cliente escribe, con su número ya verificado por Meta. Ver
   * `carrito.service.ts` para por qué eso evita construir un chat web autenticado.
   */
  readonly carrito = inject(CarritoService);

  /** ¿Se muestra el botón de pedido? Solo si el negocio publicó un WhatsApp al que escribir. */
  readonly puedePedir = computed(() => Boolean(this.negocio()?.url_whatsapp));

  /** El panel de pre-pedido, para revisar antes de mandar. */
  readonly prePedidoAbierto = signal(false);
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  readonly negocioId = signal<number | null>(null);
  readonly negocio = signal<NegocioPublico | null>(null);
  readonly categorias = signal<CategoriaPublica[]>([]);
  readonly productos = signal<ProductoPublico[]>([]);
  readonly negocioInvalido = signal(false);
  readonly planInactivo = signal(false);

  readonly cargandoNegocio = signal(false);
  readonly cargandoCategorias = signal(false);
  readonly cargandoProductos = signal(false);
  readonly cargandoPaleta = signal(false);

  readonly categoriaActiva = signal<number | null>(null);
  readonly categoriaActivaIdx = signal(0);

  readonly currentYear = new Date().getFullYear();

  readonly appLogoPath = `${environment.assetPath}/images/escalapplogo.png`;
  readonly appSiteUrl = 'https://escalapp.cloud/admin/';
  readonly appContactEmail = 'escalappsystem@gmail.com';

  /**
   * Las políticas viven en la app de administración, que se sirve bajo `/admin/` — de ahí que la
   * URL no sea `escalapp.cloud/privacidad`. Son absolutas a propósito: este menú es otra
   * aplicación y no comparte router con aquella.
   *
   * Este menú es **el punto más expuesto de toda la plataforma**: lo abre alguien que no es
   * cliente nuestro ni tiene cuenta, y al pulsar «Continuar por WhatsApp» su número pasa a
   * nuestros servidores —que están en Estados Unidos—. Por eso el aviso no está solo en el pie
   * sino junto al botón que inicia ese envío.
   */
  readonly urlTerminos = 'https://escalapp.cloud/admin/terminos';
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
  readonly tieneTelefono = computed(() => Boolean(this.negocio()?.telefono));
  readonly tieneDireccion = computed(() => Boolean(this.negocio()?.direccion));

  readonly categoriasScroll = viewChild<ElementRef<HTMLElement>>('catScroll');
  readonly puedeScrollIzq = signal(false);
  readonly puedeScrollDer = signal(false);

  private readonly priceFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (!id) return;
      this.negocioInvalido.set(false);
      this.planInactivo.set(false);
      this.negocio.set(null);
      this.categorias.set([]);
      this.productos.set([]);
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
  }

  private _onResize = (): void => this.actualizarFlechas();

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

  selectCategoria(idCategoria: number, idx: number): void {
    this.categoriaActiva.set(idCategoria);
    this.categoriaActivaIdx.set(idx);
    this.cargarProductos(idCategoria);

    const el = this.categoriasScroll()?.nativeElement;
    if (!el) return;
    const chip = el.children[idx] as HTMLElement | undefined;
    if (chip) {
      chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  agregarAlCarrito(prod: ProductoPublico): void {
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

          this.cargarCategorias(idNegocio);
          this.cargarPaleta(idNegocio);
        },
        error: () => {
          this.negocioInvalido.set(true);
          this.cargandoNegocio.set(false);
        },
      });
  }

  private cargarPaleta(idNegocio: number): void {
    this.cargandoPaleta.set(true);
    this.http
      .get<{ success: boolean; data: { id_paleta: number; nombre: string; colores: Record<string, string> } }>(
        `${environment.apiUrl}/public/negocios/${idNegocio}/paleta`,
      )
      .subscribe({
        next: (res) => {
          if (res?.data?.colores) {
            this.aplicarPaleta(res.data.colores);
          }
          this.cargandoPaleta.set(false);
        },
        error: () => {
          this.cargandoPaleta.set(false);
        },
      });
  }

  private aplicarPaleta(colores: Record<string, string>): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const root = this.document.documentElement;
    Object.entries(colores).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });
  }

  private cargarCategorias(idNegocio: number): void {
    if (this.negocioInvalido() || this.planInactivo()) return;
    this.cargandoCategorias.set(true);
    this.http
      .get<{ success: boolean; data: CategoriaPublica[] }>(
        `${environment.apiUrl}/public/carta/categorias?id_negocio=${idNegocio}`,
      )
      .subscribe({
        next: (res) => {
          const cats = res?.data ?? [];
          this.categorias.set(cats);
          this.cargandoCategorias.set(false);
          if (cats.length > 0) {
            this.selectCategoria(cats[0].id_categoria, 0);
          } else {
            this.productos.set([]);
          }
          setTimeout(() => this.actualizarFlechas(), 50);
        },
        error: (err) => {
          this.cargandoCategorias.set(false);
          if (err?.status === 402) {
            this.planInactivo.set(true);
            this.categorias.set([]);
          }
        },
      });
  }

  private cargarProductos(idCategoria: number): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;
    this.cargandoProductos.set(true);
    this.http
      .get<{ success: boolean; data: ProductoPublico[] }>(
        `${environment.apiUrl}/public/carta/productos?id_negocio=${idNegocio}&id_categoria=${idCategoria}`,
      )
      .subscribe({
        next: (res) => {
          this.productos.set(res?.data ?? []);
          this.cargandoProductos.set(false);
        },
        error: () => this.cargandoProductos.set(false),
      });
  }
}
