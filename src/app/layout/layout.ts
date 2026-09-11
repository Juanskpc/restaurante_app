import { Component, DestroyRef, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { SidebarComponent } from './sidebar/sidebar';
import { HeaderComponent } from './header/header';
import { NavProgressComponent } from './nav-progress/nav-progress';
import { PlanAvisoComponent } from './plan-aviso/plan-aviso';
import { AuthService } from '../core/services/auth.service';

/** Rutas de sistema: existen precisamente para quien no tiene permisos. */
const RUTAS_SIEMPRE_PERMITIDAS = new Set(['/sin-acceso', '/sin-plan']);

/**
 * LayoutComponent — Shell principal de la app de negocio.
 *
 * Estructura:
 *  ┌──────────┬──────────────────────────────┐
 *  │ SIDEBAR  │  HEADER                      │
 *  │          ├──────────────────────────────┤
 *  │          │  <router-outlet> (content)   │
 *  │          │                              │
 *  └──────────┴──────────────────────────────┘
 *
 * En móvil:
 *  ┌───────────────────────────────────────┐
 *  │  HEADER                               │
 *  ├───────────────────────────────────────┤
 *  │  <router-outlet> (content)            │
 *  │                                       │
 *  ├───────────────────────────────────────┤
 *  │  BOTTOM NAV (sidebar colapsado)       │
 *  └───────────────────────────────────────┘
 */
@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, SidebarComponent, HeaderComponent, NavProgressComponent, PlanAvisoComponent],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class LayoutComponent {
  private readonly defaultTitle = 'Dashboard';
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
      map(() => {
        void this.sincronizarSesion();
        return this.resolveHeaderTitle();
      }),
    ),
    { initialValue: this.defaultTitle },
  );

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;

    // Un cajero puede pasarse el turno entero en la misma pantalla, sin navegar: sin esto,
    // un permiso concedido o una función encendida no llegaban hasta la siguiente navegación.
    // Al volver a la pestaña se reconsulta (con el mismo límite de 60 s, así que alternar
    // entre ventanas no dispara peticiones en cadena).
    document.addEventListener('visibilitychange', this.alVolverALaPestana);
    this.destroyRef.onDestroy(() =>
      document.removeEventListener('visibilitychange', this.alVolverALaPestana),
    );
  }

  private readonly alVolverALaPestana = (): void => {
    if (document.visibilityState === 'visible') void this.sincronizarSesion();
  };

  /**
   * Relee permisos y ajustes del negocio y, si al usuario le quitaron el acceso a la vista
   * que tiene abierta, lo saca de ahí.
   *
   * Sin lo segundo, quitar un permiso solo actualizaba el menú: la pantalla prohibida seguía
   * en pantalla —y funcionando— hasta que el usuario navegara a otro sitio.
   */
  private async sincronizarSesion(): Promise<void> {
    await this.auth.refreshPerfilIfStale();
    if (!this.auth.isAuthenticated()) return;

    const rutaActual = this.router.url.split('?')[0];
    // Las pantallas de diagnóstico no se evalúan: son justo el sitio al que se manda a quien
    // no tiene permisos, y comprobarlas daría vueltas sobre sí mismo.
    if (RUTAS_SIEMPRE_PERMITIDAS.has(rutaActual)) return;
    if (this.auth.canAccessRoute(rutaActual)) return;

    const destino = this.auth.getFirstAccessibleRoute() ?? '/sin-acceso';
    if (destino === rutaActual) return;
    void this.router.navigateByUrl(destino);
  }

  private resolveHeaderTitle(): string {
    let currentRoute = this.router.routerState.snapshot.root;
    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
    }

    return currentRoute.title ?? this.defaultTitle;
  }
}
