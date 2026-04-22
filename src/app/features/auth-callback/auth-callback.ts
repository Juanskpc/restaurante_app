import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

/**
 * Callback de login cross-origin.
 *
 * El admin_app redirige a `/auth/callback?code=<uuid>` después de pedirle
 * al backend un código de un solo uso. Este componente canjea el código
 * por la sesión y navega al dashboard.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div class="callback">
      @if (error()) {
        <div class="callback__card">
          <span class="callback__icon callback__icon--error">!</span>
          <h2>No se pudo entrar al restaurante</h2>
          <p>{{ error() }}</p>
          <button type="button" class="btn" (click)="volverAlAdmin()">Volver al inicio</button>
        </div>
      } @else {
        <div class="callback__card">
          <div class="callback__spinner"></div>
          <p>Verificando acceso al restaurante…</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .callback { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-bg, #f5f5f5); padding: 1rem; }
    .callback__card { display: flex; flex-direction: column; gap: 1rem; align-items: center; text-align: center; padding: 2.5rem 2rem; background: #fff; border-radius: 1rem; box-shadow: 0 2px 8px rgba(0,0,0,.08); max-width: 360px; width: 100%; }
    .callback__card h2 { margin: 0; font-size: 1.1rem; }
    .callback__card p  { margin: 0; color: #6b7280; font-size: .9rem; }
    .callback__icon--error { width: 44px; height: 44px; border-radius: 50%; background: #ef4444; color: #fff; font-size: 1.25rem; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .callback__spinner { width: 40px; height: 40px; border: 4px solid #e5e7eb; border-top-color: #1f6feb; border-radius: 50%; animation: spin .8s linear infinite; }
    .btn { padding: .55rem 1rem; background: #1f6feb; color: #fff; border: none; border-radius: .5rem; cursor: pointer; font-weight: 600; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    const code = this.route.snapshot.queryParamMap.get('code');
    if (!code) {
      this.error.set('No se recibió un código de acceso válido.');
      return;
    }

    const ok = await this.auth.canjearCodigo(code);
    if (ok) {
      await this.router.navigateByUrl('/dashboard', { replaceUrl: true });
    } else {
      this.error.set('Código inválido o expirado. Vuelve al panel y reintenta.');
    }
  }

  volverAlAdmin(): void {
    this.auth.logout();
  }
}
