import {
  Component, ChangeDetectionStrategy, inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError, Event as RouterEvent,
} from '@angular/router';
import { filter, map } from 'rxjs';

/**
 * NavProgressComponent — indicador global de navegación entre vistas.
 *
 * Escucha los eventos del Router y muestra una barra de progreso superior
 * + un texto "Cargando…" mientras la transición está en curso. Cubre:
 *  • descarga del chunk lazy (loadComponent) en la primera visita a una vista,
 *  • ejecución de guards (auth/permission/plan),
 *  • el gap hasta que el componente destino se instancia.
 *
 * Se apaga en NavigationEnd / Cancel / Error para no dejar la UI "colgada".
 */
@Component({
  selector: 'app-nav-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="nav-progress" role="status" aria-live="polite" aria-label="Cargando vista">
        <div class="nav-progress__bar"></div>
        <span class="nav-progress__label">Cargando…</span>
      </div>
    }
  `,
  styles: [`
    .nav-progress {
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 2000;
      pointer-events: none;
    }

    .nav-progress__bar {
      height: 3px;
      width: 100%;
      transform-origin: 0 50%;
      background: linear-gradient(90deg, var(--color-primary), var(--color-primary-hover));
      animation: nav-progress-indeterminate 1.1s ease-in-out infinite;
    }

    .nav-progress__label {
      position: absolute;
      top: 10px;
      right: 16px;
      padding: .2rem .6rem;
      font-size: .72rem;
      font-weight: 600;
      color: var(--color-on-primary);
      background: color-mix(in srgb, var(--color-primary) 88%, #000 12%);
      border-radius: var(--radius-full, 999px);
      box-shadow: var(--shadow-sm);
    }

    @keyframes nav-progress-indeterminate {
      0%   { transform: scaleX(.05); opacity: .7; }
      50%  { transform: scaleX(.7);  opacity: 1;  }
      100% { transform: scaleX(1);   opacity: .7; }
    }

    @media (prefers-reduced-motion: reduce) {
      .nav-progress__bar { animation: none; transform: scaleX(1); }
    }
  `],
})
export class NavProgressComponent {
  private readonly router = inject(Router);

  readonly loading = toSignal(
    this.router.events.pipe(
      filter((e: RouterEvent): e is NavigationStart | NavigationEnd | NavigationCancel | NavigationError =>
        e instanceof NavigationStart ||
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError,
      ),
      map((e) => e instanceof NavigationStart),
    ),
    { initialValue: false },
  );
}
