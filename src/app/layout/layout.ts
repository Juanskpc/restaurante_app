import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

import { SidebarComponent } from './sidebar/sidebar';
import { HeaderComponent } from './header/header';
import { AuthService } from '../core/services/auth.service';

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
  imports: [RouterOutlet, SidebarComponent, HeaderComponent],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class LayoutComponent {
  private readonly defaultTitle = 'Dashboard';
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null),
      map(() => {
        void this.auth.refreshPerfilIfStale();
        return this.resolveHeaderTitle();
      }),
    ),
    { initialValue: this.defaultTitle },
  );

  private resolveHeaderTitle(): string {
    let currentRoute = this.router.routerState.snapshot.root;
    while (currentRoute.firstChild) {
      currentRoute = currentRoute.firstChild;
    }

    return currentRoute.title ?? this.defaultTitle;
  }
}
