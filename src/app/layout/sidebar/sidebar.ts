import { Component, inject, signal, HostListener } from '@angular/core';
import { RouterLink, RouterLinkActive, IsActiveMatchOptions } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';

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

  /**
   * Items de navegación.
   * Los 4 primeros (section: 'main') aparecen siempre en el bottom bar móvil.
   * El resto aparece en el panel "Más" en móvil y en la sección gestión del sidebar desktop.
   */
  readonly navItems: NavItem[] = [
    { icon: 'layout-dashboard',  label: 'Dashboard',      route: '/dashboard',      section: 'main' },
    { icon: 'clipboard-list',    label: 'Pedidos',         route: '/pedidos',         badge: 0, section: 'main' },
    { icon: 'flame',             label: 'Cocina',          route: '/cocina',          section: 'main' },
    { icon: 'utensils-crossed',  label: 'Menú',            route: '/menu',            section: 'main' },
    { icon: 'armchair',          label: 'Mesas',           route: '/mesas',           section: 'secondary' },
    { icon: 'package',           label: 'Inventario',      route: '/inventario',      section: 'secondary' },
    { icon: 'users',             label: 'Personal',        route: '/usuarios',        section: 'secondary' },
    { icon: 'chart-bar',          label: 'Reportes',        route: '/reportes',        section: 'secondary' },
    { icon: 'settings',          label: 'Configuración',   route: '/configuracion',   section: 'secondary' },
  ];

  /** Items principales (bottom nav). */
  readonly mainItems = this.navItems.filter(i => i.section === 'main');

  /** Items secundarios (gestión). */
  readonly secondaryItems = this.navItems.filter(i => i.section === 'secondary');

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

  /** Cerrar menú "Más" al presionar Escape. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.moreMenuOpen()) {
      this.closeMoreMenu();
    }
  }
}
