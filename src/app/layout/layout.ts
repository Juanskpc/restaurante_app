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
import { SidebarService } from '../core/services/sidebar.service';
import { RealtimeService } from '../core/services/realtime.service';
import { SonidoAlertaService } from '../core/services/sonido-alerta.service';
import { UiFeedbackService } from '../core/ui-feedback/ui-feedback.service';

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
  private readonly realtime = inject(RealtimeService);
  private readonly sonido = inject(SonidoAlertaService);
  private readonly ui = inject(UiFeedbackService);

  /** Lo decide el botón del sidebar; aquí solo se usa para correr el contenido. */
  readonly sidebarColapsado = inject(SidebarService).colapsado;

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

    // Vive aquí y no en Despacho porque el aviso hace falta justo cuando NO se está mirando
    // Despacho: el cajero está en Caja, el mesero en Mesas. El pedido lo tomó un bot, así que
    // nadie del negocio sabe que existe hasta que suene.
    this.destroyRef.onDestroy(
      this.realtime.alAvisar('whatsapp', () => this.alLlegarPedidoDeWhatsapp()),
    );

    // Lo mismo, por el mismo motivo, para la conversación que el asistente no supo contestar.
    // Hasta 2026-10-05 esto era un correo: llegaba tarde —nadie revisa el buzón mientras
    // atiende— y llenaba la bandeja. Ahora suena aquí, con un sonido que no se confunde con el
    // de un pedido nuevo, porque lo que pide no es lo mismo: hay un cliente escribiendo.
    this.destroyRef.onDestroy(
      this.realtime.alAvisar('escalada', () => this.alEscalarseUnaConversacion()),
    );
  }

  /**
   * Suena y avisa, pero solo a quien de verdad va a atender ese pedido: el repartidor —que ve
   * únicamente lo asignado a él— o un cocinero no tienen nada que confirmar, y una alerta que no
   * les toca se aprende a ignorar.
   */
  private alLlegarPedidoDeWhatsapp(): void {
    if (!this.auth.canAccessRoute('/despacho') || !this.auth.canAccessSubnivel('despacho_ver_todos')) return;

    this.sonido.sonarNuevoPedido();
    // Dentro de Despacho la tarjeta ya se enciende sola: el aviso solo estorbaría.
    if (!this.router.url.startsWith('/despacho')) {
      this.ui.info('Llegó un pedido por WhatsApp. Confírmalo en Despacho.', 'Nuevo pedido');
    }
  }

  /**
   * Suena y avisa de que una conversación quedó esperando a una persona.
   *
   * Solo a quien puede contestarla: el dueño del negocio y el cajero, que es la misma regla con
   * la que `whatsappGuard` protege la Bandeja en el panel. Un mesero o un domiciliario no tienen
   * dónde responder, y un aviso que no se puede atender se aprende a ignorar —el del pedido ya
   * se acota igual unas líneas más arriba.
   *
   * La Bandeja vive en el panel (`/admin/whatsapp`), que es otro origen, así que el aviso no
   * navega: lleva un botón que sale por el SSO de `irAConversaciones`.
   */
  private alEscalarseUnaConversacion(): void {
    if (!this.atiendeConversaciones()) return;

    this.sonido.sonarConversacionEscalada();
    // Más tiempo en pantalla que un aviso normal, y con botón: al otro lado hay alguien
    // esperando, y el gesto que pide —salir al panel— no se hace en los tres segundos de un
    // toast corriente ni se adivina leyendo una ruta.
    this.ui.toast({
      tone: 'warning',
      title: 'Una conversación te espera',
      message: 'El asistente no supo qué responder y hay un cliente escribiendo.',
      durationMs: 12000,
      accion: { texto: 'Abrir conversaciones', ejecutar: () => void this.auth.irAConversaciones() },
    });
  }

  /** ¿Esta persona puede responder la Bandeja? Administrador (o super) y cajero. */
  private atiendeConversaciones(): boolean {
    const sesion = this.auth.session();
    if (!sesion) return false;

    const roles = [
      ...(sesion.roles_globales ?? []),
      ...(sesion.roles ?? []),
      ...(this.auth.negocio()?.roles ?? []),
    ].map((rol) => rol.descripcion.trim().toUpperCase());

    return roles.some(
      (rol) => rol === 'ADMINISTRADOR' || rol === 'SUPER ADMINISTRADOR' || rol === 'CAJERO',
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
