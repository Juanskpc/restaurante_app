import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
import { IdSeccion, pestanasDisponibles } from '../secciones';

/**
 * SeccionPestanasComponent — la barra que une varias pantallas bajo una entrada del menú.
 *
 * ```html
 * <app-seccion-pestanas seccion="whatsapp" />
 * ```
 *
 * Cada pestaña es un enlace a su ruta, no un estado en memoria: ver `../secciones.ts`. Con una
 * sola pestaña disponible no se pinta nada — una barra con una opción no lleva a ningún sitio y
 * le quita alto a la pantalla (en Conversaciones, a los mensajes).
 */
@Component({
  selector: 'app-seccion-pestanas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  template: `
    @if (pestanas().length > 1) {
      <nav class="sp" [attr.aria-label]="etiqueta()">
        @for (p of pestanas(); track p.route) {
          <a
            class="sp__tab"
            [routerLink]="p.route"
            routerLinkActive="sp__tab--on"
            #rla="routerLinkActive"
            [attr.aria-current]="rla.isActive ? 'page' : null"
          >
            <lucide-icon [name]="p.icon" [size]="16" aria-hidden="true" />
            {{ p.label }}
          </a>
        }
      </nav>
    }
  `,
  styles: `
    :host { display: block; flex: none; }

    /* Alto fijo: la Bandeja lo descuenta de su altura (\`--bdj-extra\` en Conversaciones). */
    .sp {
      display: flex;
      gap: 0.25rem;
      height: 2.75rem;
      border-bottom: 1px solid var(--color-border);
      overflow-x: auto;
      scrollbar-width: none;
    }

    .sp__tab {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0 0.875rem;
      margin-bottom: -1px;
      border-bottom: 2px solid transparent;
      color: var(--color-text-secondary);
      font-size: 0.9375rem;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
      transition: color var(--transition-fast), border-color var(--transition-fast);
    }

    .sp__tab:hover { color: var(--color-text-primary); }

    .sp__tab:focus-visible {
      outline: none;
      box-shadow: var(--focus-ring);
      border-radius: var(--radius-md);
    }

    .sp__tab--on {
      border-bottom-color: var(--color-primary);
      color: var(--color-primary);
    }
  `,
})
export class SeccionPestanasComponent {
  private readonly auth = inject(AuthService);

  readonly seccion = input.required<IdSeccion>();

  readonly pestanas = computed(() => pestanasDisponibles(this.auth, this.seccion()));

  readonly etiqueta = computed(() =>
    this.seccion() === 'whatsapp' ? 'Secciones de WhatsApp' : 'Secciones de inventario',
  );
}
