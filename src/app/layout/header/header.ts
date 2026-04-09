import { Component, inject, input, signal, computed } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService, NegocioRestaurante } from '../../core/services/auth.service';
import { ThemeService } from '../../core/theme/theme.service';

/**
 * HeaderComponent — Barra superior de la app.
 *
 * Muestra:
 *  • Título dinámico de la página
 *  • Selector de negocio / sede (si tiene más de uno)
 *  • Toggle de tema claro/oscuro
 *  • Campana de notificaciones
 */
@Component({
  selector: 'app-header',
  imports: [LucideAngularModule],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);

  /** Título mostrado. Puede sobreescribirse por la ruta activa. */
  readonly pageTitle = input<string>('Dashboard');

  /** Lista de negocios del usuario. */
  readonly negocios = computed(() => this.auth.negocios());

  /** Dropdown abierto. */
  readonly selectorOpen = signal(false);

  /** Fecha formateada (ej: "Jueves 10 de Julio, 2025"). */
  get formattedDate(): string {
    const now = new Date();
    return now.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  toggleTheme(): void {
    const current = this.theme.theme();
    this.theme.setTheme(current === 'dark' ? 'light' : 'dark');
  }

  toggleSelector(): void {
    this.selectorOpen.update(v => !v);
  }

  selectNegocio(id: number): void {
    this.auth.setNegocioActivo(id);
    this.selectorOpen.set(false);
  }
}
