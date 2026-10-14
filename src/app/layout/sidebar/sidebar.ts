import { Component, computed, inject, signal, HostListener } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
import { SECCIONES, rutaDisponible } from '../secciones';
import { ConversacionesPendientesService } from '../../core/services/conversaciones-pendientes.service';
import { SidebarService } from '../../core/services/sidebar.service';
import { UiFeedbackService } from '../../core/ui-feedback/ui-feedback.service';

/**
 * Cuántos accesos caben en la barra inferior del móvil sin apretujarse.
 *
 * Cuando el rol no llega a esa cifra no hay nada que esconder, así que la barra los
 * muestra todos y el botón «Más» desaparece. Antes, un cajero con dos permisos veía
 * uno en la barra y el otro escondido detrás de «Más», que es un toque de más para
 * llegar a la mitad de lo que puede hacer.
 */
const ATAJOS_MOVIL = 4;

export interface NavItem {
  icon: string;
  label: string;
  route: string;
  badge?: number;
  /**
   * La burbuja va en rojo y no en el color de marca.
   *
   * Se usa cuando lo que cuenta es gente esperando, no cosas pendientes: «4 clientes sin
   * respuesta» es urgencia, y con la paleta del inquilino podría salir en un verde que invita
   * a no mirarlo. Las cuentas neutras que vengan después se quedan con el estilo de siempre.
   */
  badgeAlerta?: boolean;
  /** 'main' aparece en el bottom nav móvil; 'secondary' solo en sidebar/menú "Más" */
  section: 'main' | 'secondary';
  /**
   * Las pantallas que esta entrada agrupa (`../secciones.ts`). La entrada se ve si la persona
   * puede abrir CUALQUIERA de ellas, lleva a la primera que pueda abrir, y queda marcada como
   * activa en todas. Sin esto, solo la propia `route`.
   */
  rutas?: string[];
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, LucideAngularModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  private readonly pendientes = inject(ConversacionesPendientesService);
  private readonly ui = inject(UiFeedbackService);
  private readonly sidebar = inject(SidebarService);
  private readonly router = inject(Router);

  /**
   * Menú plegado a riel de iconos.
   *
   * Solo manda en escritorio: en tablet el menú ya es un riel por ancho, y en móvil no hay
   * menú lateral sino barra inferior. En esos dos, plegarlo no significa nada y el CSS lo
   * ignora.
   */
  readonly colapsado = this.sidebar.colapsado;

  alternarColapso(): void {
    this.sidebar.alternar();
  }

  /**
   * Items de navegación.
   * Los 4 primeros (section: 'main') aparecen siempre en el bottom bar móvil.
   * El resto aparece en el panel "Más" en móvil y en la sección gestión del sidebar desktop.
   */
  readonly navItems: NavItem[] = [
    { icon: 'layout-dashboard',  label: 'Dashboard',      route: '/dashboard',      section: 'main' },
    { icon: 'clipboard-list',    label: 'Pedidos',         route: '/pedidos',         badge: 0, section: 'main' },
    { icon: 'bike',              label: 'Despacho',        route: '/despacho',        section: 'main' },
    { icon: 'flame',             label: 'Cocina',          route: '/cocina',          section: 'main' },
    { icon: 'mesa',              label: 'Mesas',           route: '/mesas',           section: 'main' },
    { icon: 'utensils-crossed',  label: 'Menú',            route: '/menu',            section: 'secondary' },
    // Conversaciones y Promociones, bajo un nombre que el dueño reconoce (2026-10-13).
    { icon: 'message-circle',    label: 'WhatsApp',        route: '/conversaciones',  section: 'main',
      rutas: SECCIONES.whatsapp.map((p) => p.route) },
    { icon: 'users',             label: 'Clientes',        route: '/clientes',        section: 'secondary' },
    { icon: 'wallet',            label: 'Caja',            route: '/caja',            section: 'secondary' },
    { icon: 'package',           label: 'Inventario',      route: '/inventario',      section: 'secondary',
      rutas: SECCIONES.inventario.map((p) => p.route) },
    { icon: 'users',             label: 'Personal',        route: '/usuarios',        section: 'secondary' },
    { icon: 'chart-bar',          label: 'Reportes',        route: '/reportes',        section: 'secondary' },
    // Horarios es una pestaña de Configuración (2026-10-13).
    { icon: 'settings',          label: 'Configuración',   route: '/configuracion',   section: 'secondary',
      rutas: ['/configuracion', '/horarios'] },
  ];

  /**
   * Contadores que se pintan como burbuja sobre el icono del menú.
   *
   * Son de la app entera y no de una pantalla: la gracia de la burbuja de Conversaciones es
   * que se vea desde Pedidos o desde Caja, que es donde está el cajero cuando un cliente
   * escribe. Al ser un `computed` sobre un signal, sube y baja sola.
   */
  private readonly badgePorRuta = computed<Record<string, number>>(() => ({
    '/conversaciones': this.pendientes.total(),
  }));

  /**
   * Lo que esta persona puede ver del menú.
   *
   * Quién entra a qué pantalla lo decide `rutaDisponible` (permiso, bandera de EscalApp y
   * subnivel), la misma función que usan las pestañas de cada sección: así el menú y las pestañas
   * no pueden contradecirse. Una entrada agrupada lleva a la primera de sus pantallas que se pueda
   * abrir — a quien solo tiene Proveedores, «Inventario» lo lleva a Proveedores.
   */
  readonly navItemsPermitidos = computed(() => {
    const badges = this.badgePorRuta();
    const visibles: NavItem[] = [];
    for (const item of this.navItems) {
      const destino = (item.rutas ?? [item.route]).find((r) => rutaDisponible(this.auth, r));
      if (!destino) continue;
      // La burbuja va por la entrada (su `route` original), no por el destino resuelto.
      const badge = badges[item.route];
      visibles.push({
        ...item,
        route: destino,
        ...(badge === undefined ? {} : { badge, badgeAlerta: true }),
      });
    }
    return visibles;
  });

  /** La ruta en la que se está, sin parámetros. Con ella se marca la entrada activa. */
  private readonly urlActual = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * ¿Está activa esta entrada?
   *
   * Se calcula aquí y no con `routerLinkActive`, que solo compara con su propio enlace: en
   * Proveedores, «Inventario» se quedaba apagado aunque fuera su sección.
   */
  estaActivo(item: NavItem): boolean {
    const ruta = (this.urlActual() ?? '').split(/[?#]/)[0];
    if (item.route === '/dashboard') return ruta === '/dashboard';
    return (item.rutas ?? [item.route]).some((r) => ruta === r || ruta.startsWith(`${r}/`));
  }

  /** Items principales (bottom nav). */
  readonly mainItems = computed(() => this.navItemsPermitidos().filter(i => i.section === 'main'));

  /** Items secundarios (gestión). */
  readonly secondaryItems = computed(() => this.navItemsPermitidos().filter(i => i.section === 'secondary'));

  /**
   * ¿Cabe todo lo que el rol puede ver en la barra inferior?
   *
   * Es la pregunta que decide la forma de la barra en móvil. Con pocos permisos no
   * hay motivo para un desplegable, y el hueco que deja «Más» se aprovecha para el
   * cierre de sesión, que en esa situación estaba enterrado dentro del panel.
   */
  readonly cabenTodosEnBarra = computed(
    () => this.navItemsPermitidos().length <= ATAJOS_MOVIL,
  );

  /**
   * Lo que se pinta en la barra inferior.
   *
   * Con muchos permisos se respeta el reparto de siempre —los de `section: 'main'`—
   * para no moverle los iconos de sitio a quien ya tiene la app aprendida. Solo cuando
   * caben todos se ignora esa división, que es cuando estorbaba.
   */
  readonly bottomItems = computed(
    () => (this.cabenTodosEnBarra() ? this.navItemsPermitidos() : this.mainItems()),
  );

  /** El botón «Más» sobra si en la barra ya está todo. */
  readonly mostrarBotonMas = computed(() => !this.cabenTodosEnBarra());

  /**
   * El cierre de sesión solo sale en la barra cuando no hay panel «Más» donde vivir.
   * Si estuviera en los dos sitios, habría dos formas de salir a un toque de distancia
   * de los accesos que más se usan.
   */
  readonly mostrarLogoutEnBarra = computed(() => this.cabenTodosEnBarra());


  /** Panel "Más" abierto en móvil. */
  readonly moreMenuOpen = signal(false);

  toggleMoreMenu(): void {
    this.moreMenuOpen.update(v => !v);
  }

  closeMoreMenu(): void {
    this.moreMenuOpen.set(false);
  }

  onLogout(): void {
    this.auth.logout();
  }

  /**
   * Cierre de sesión desde la barra inferior del móvil.
   *
   * Este sí pregunta antes, y el del sidebar y el del panel «Más» no: aquí el botón
   * queda pegado a los accesos que más se tocan, al alcance del pulgar, y un roce
   * echaría al cajero en mitad de un turno. En el escritorio hay que ir al pie de la
   * barra lateral a propósito, y en el panel «Más» hay que abrirlo primero.
   */
  async onLogoutBarra(): Promise<void> {
    const confirmado = await this.ui.confirm({
      title: 'Cerrar sesión',
      message: '¿Deseas salir de tu cuenta?',
      confirmText: 'Cerrar sesión',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (confirmado) this.auth.logout();
  }

  /** Cerrar menú "Más" al presionar Escape. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.moreMenuOpen()) {
      this.closeMoreMenu();
    }
  }
}
