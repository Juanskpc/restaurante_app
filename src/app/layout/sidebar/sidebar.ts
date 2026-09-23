import { Component, computed, inject, signal, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, IsActiveMatchOptions } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
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
  /** 'main' aparece en el bottom nav móvil; 'secondary' solo en sidebar/menú "Más" */
  section: 'main' | 'secondary';
}

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
})
export class SidebarComponent {
  readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);
  private readonly sidebar = inject(SidebarService);

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
    { icon: 'utensils-crossed',  label: 'Menú',            route: '/menu',            section: 'main' },
    { icon: 'armchair',          label: 'Mesas',           route: '/mesas',           section: 'secondary' },
    { icon: 'users',             label: 'Clientes',        route: '/clientes',        section: 'secondary' },
    { icon: 'wallet',            label: 'Caja',            route: '/caja',            section: 'secondary' },
    { icon: 'package',           label: 'Inventario',      route: '/inventario',      section: 'secondary' },
    { icon: 'users',             label: 'Personal',        route: '/usuarios',        section: 'secondary' },
    { icon: 'chart-bar',          label: 'Reportes',        route: '/reportes',        section: 'secondary' },
    { icon: 'settings',          label: 'Configuración',   route: '/configuracion',   section: 'secondary' },
  ];

  /**
   * Subnivel que además del permiso de módulo debe estar activo para mostrar el item.
   * Un negocio que solo vende para llevar apaga "En mesa" y el salón desaparece del menú.
   */
  private readonly subnivelPorRuta: Record<string, string> = {
    '/mesas': 'pedidos_en_mesa',
  };

  readonly navItemsPermitidos = computed(() =>
    this.navItems.filter((item) => {
      if (!this.auth.canAccessRoute(item.route)) return false;
      // Tiqueteras y fiado son opt-in del negocio: sin encenderlas, el menú no aparece.
      if (item.route === '/clientes' && !this.auth.permiteCuentasCliente()) return false;
      const subnivel = this.subnivelPorRuta[item.route];
      return !subnivel || this.auth.canAccessSubnivel(subnivel);
    })
  );

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

  /** Match options: compara solo el path, ignora queryParams y fragment. */
  readonly exactMatchOptions: IsActiveMatchOptions = {
    paths: 'exact', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored',
  };
  readonly prefixMatchOptions: IsActiveMatchOptions = {
    paths: 'subset', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored',
  };

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
