import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'restaurante-sin-plan',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  template: `
    <section class="sp-page">
      <div class="sp-icon">
        <lucide-icon name="credit-card" [size]="48" aria-hidden="true" />
      </div>

      <h1 class="sp-title">Plan requerido</h1>
      <p class="sp-desc">
        Tu negocio no tiene un plan activo. Para acceder a las funcionalidades
        de EscalApp Restaurante necesitas contratar un plan.
      </p>

      <div class="sp-actions">
        <a routerLink="/dashboard" class="btn btn-outline">
          <lucide-icon name="arrow-left" [size]="16" aria-hidden="true" />
          Ir al dashboard
        </a>
        <button type="button" class="btn btn-primary" (click)="auth.logout()">
          <lucide-icon name="log-out" [size]="16" aria-hidden="true" />
          Volver al admin
        </button>
      </div>

      <p class="sp-contact">
        ¿Necesitas ayuda? Contacta a soporte en
        <a href="mailto:soporte@escalapp.cloud">soporte&#64;escalapp.cloud</a>
      </p>
    </section>
  `,
  styles: [`
    .sp-page {
      max-width: 480px;
      margin: 5rem auto;
      padding: 2.5rem;
      text-align: center;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-md);
    }
    .sp-icon {
      display: flex;
      justify-content: center;
      margin-bottom: 1.25rem;
      color: var(--color-warning, #d97706);
    }
    .sp-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 .75rem;
      color: var(--color-text-primary);
    }
    .sp-desc {
      color: var(--color-text-secondary);
      margin: 0 0 1.75rem;
      line-height: 1.6;
    }
    .sp-actions {
      display: flex;
      gap: .75rem;
      justify-content: center;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
    }
    .sp-contact {
      font-size: .8rem;
      color: var(--color-text-muted);
      margin: 0;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: .5rem;
      padding: .5rem 1.25rem;
      border-radius: var(--radius-md);
      font-size: .875rem;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--color-primary);
      color: var(--color-on-primary);
    }
    .btn-outline {
      border-color: var(--color-border);
      color: var(--color-text-primary);
      background: transparent;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SinPlanComponent {
  readonly auth = inject(AuthService);
}
