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
      <nav class="ui-pestanas" [attr.aria-label]="etiqueta()">
        @for (p of pestanas(); track p.route) {
          <a
            class="ui-pestana"
            [routerLink]="p.route"
            routerLinkActive="ui-pestana--on"
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
  // El aspecto es el estándar global de pestañas (`src/styles/_pestanas.scss`), el mismo de
  // Caja, Configuración o Clientes. Alto fijo de 2,75 rem: la Bandeja lo descuenta (`--bdj-extra`).
  styles: `:host { display: block; flex: none; }`,
})
export class SeccionPestanasComponent {
  private readonly auth = inject(AuthService);

  readonly seccion = input.required<IdSeccion>();

  readonly pestanas = computed(() => pestanasDisponibles(this.auth, this.seccion()));

  readonly etiqueta = computed(() =>
    this.seccion() === 'whatsapp' ? 'Secciones de WhatsApp' : 'Secciones de inventario',
  );
}
