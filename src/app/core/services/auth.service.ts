import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';

// ============================================================
// Interfaces de sesión
// ============================================================

export interface UsuarioRestaurante {
  id_usuario: number;
  nombre_completo: string;
  primer_nombre: string;
  primer_apellido: string;
  email: string;
}

export interface PermisoVistaRestaurante {
  id_nivel: number;
  vista: string;
  url: string;
  roles: string[];
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface PermisoSubnivelRestaurante {
  id_nivel: number;
  codigo: string;
  accion: string;
  modulo_url: string;
  roles: string[];
  puede_ver: boolean;
}

export interface NegocioRestaurante {
  id_negocio: number;
  nombre: string;
  tipo_negocio: string | null;
  paleta: { id_paleta: number; nombre: string; colores: Record<string, string> } | null;
  roles: { id_rol: number; descripcion: string }[];
  permisos_vista: PermisoVistaRestaurante[];
  permisos_subnivel: PermisoSubnivelRestaurante[];
}

export interface SesionRestaurante {
  usuario: UsuarioRestaurante;
  permisos_cargados?: boolean;
  negocio: NegocioRestaurante | null;
  negocios: NegocioRestaurante[];
  roles: { id_rol: number; descripcion: string }[];
  roles_globales: { id_rol: number; descripcion: string }[];
  permisos_vista?: PermisoVistaRestaurante[];
  permisos_subnivel?: PermisoSubnivelRestaurante[];
  plan_activo?: boolean;
}

const TOKEN_KEY    = 'app_token';
const SESSION_KEY  = 'app_session';
const NEGOCIO_KEY  = 'app_negocio_activo';

const APP_ROUTE_PRIORITY = [
  '/dashboard',
  '/pedidos',
  '/despacho',
  '/cocina',
  '/menu',
  '/mesas',
  '/caja',
  '/inventario',
  '/usuarios',
  '/reportes',
  '/configuracion',
];

const ROUTE_PERMISSION_ALIASES: Record<string, string[]> = {
  '/dashboard': ['/dashboard'],
  '/pedidos': ['/pedidos', '/pos', '/pos/pedidos'],
  '/despacho': ['/despacho'],
  '/cocina': ['/cocina'],
  '/menu': ['/menu', '/inventario/productos', '/inventario'],
  '/mesas': ['/mesas', '/pos', '/pos/pedidos'],
  '/caja': ['/caja'],
  '/inventario': ['/inventario'],
  '/usuarios': ['/usuarios'],
  '/reportes': ['/reportes'],
  '/configuracion': ['/configuracion'],
};

function normalizeRoutePath(rawPath: string): string {
  if (!rawPath) return '/';
  const withoutQuery = rawPath.split('?')[0]?.split('#')[0]?.trim() ?? '';
  if (!withoutQuery) return '/';

  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const normalized = withLeadingSlash.replace(/\/+/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function normalizePermissionCode(rawCode: string): string {
  return String(rawCode || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/\//g, '_');
}

/**
 * AuthService — Gestiona autenticación y sesión para la app de negocio.
 *
 * Flujo:
 *  1. La app restaura sesión desde localStorage propio al iniciar.
 *  2. Si existe token almacenado, este servicio lo valida contra POST /auth/verificar-token.
 *  3. Si es válido, actualiza token y datos de sesión en localStorage.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);

  /** Señal de sesión activa. */
  readonly session = signal<SesionRestaurante | null>(null);

  /** Índice del negocio activo (seleccionado por el usuario). */
  private readonly _negocioIdx = signal<number>(0);

  /** ¿Está autenticado? */
  readonly isAuthenticated = computed(() => this.session() !== null);

  /** ¿El negocio activo tiene plan activo? */
  readonly planActivo = computed(() => this.session()?.plan_activo ?? false);

  /** Usuario actual. */
  readonly usuario = computed(() => this.session()?.usuario ?? null);

  /** Lista completa de negocios del usuario. */
  readonly negocios = computed(() => this.session()?.negocios ?? []);

  /** Negocio activo (el que seleccionó el usuario). */
  readonly negocio = computed(() => {
    const s = this.session();
    if (!s || !s.negocios?.length) return null;
    const idx = this._negocioIdx();
    return s.negocios[idx] ?? s.negocios[0];
  });

  /** Rol principal (para mostrar en sidebar). */
  readonly rolPrincipal = computed(() => {
    const s = this.session();
    if (!s) return '';
    if (s.roles_globales?.length > 0) return s.roles_globales[0].descripcion;
    if (s.roles?.length > 0) return s.roles[0].descripcion;
    return 'Usuario';
  });

  readonly permisosVistaActivos = computed<PermisoVistaRestaurante[]>(() => {
    const negocio = this.negocio();
    if (negocio?.permisos_vista?.length) {
      return negocio.permisos_vista;
    }
    return this.session()?.permisos_vista ?? [];
  });

  readonly permisosSubnivelActivos = computed<PermisoSubnivelRestaurante[]>(() => {
    const negocio = this.negocio();
    if (negocio?.permisos_subnivel?.length) {
      return negocio.permisos_subnivel;
    }
    return this.session()?.permisos_subnivel ?? [];
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.restoreSession();
    }
  }

  // ============================================================
  // API pública
  // ============================================================

  /** Cambia el negocio activo. */
  setNegocioActivo(idNegocio: number): void {
    const negocios = this.negocios();
    const idx = negocios.findIndex(n => n.id_negocio === idNegocio);
    if (idx >= 0) {
      this._negocioIdx.set(idx);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem(NEGOCIO_KEY, String(idNegocio));
      }
    }
  }

  /** JWT almacenado. */
  getAccessToken(): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    return localStorage.getItem(TOKEN_KEY);
  }

  /**
   * Valida un token contra el backend y establece la sesión.
    * Se usa para revalidar el token persistido en localStorage.
   */
  async validateAndSetToken(token: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: SesionRestaurante }>(
          `${environment.apiUrl}/auth/verificar-token`,
          { token }
        )
      );

      if (res?.success && res.data) {
        this.setSession(token, res.data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Canjea un código de acceso de un solo uso (emitido por el admin_app)
   * y persiste la sesión local.
   */
  async canjearCodigo(code: string): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: SesionRestaurante & { token: string } }>(
          `${environment.apiUrl}/auth/canjear-codigo`,
          { code }
        )
      );
      if (res?.success && res.data?.token) {
        const { token, ...sessionData } = res.data;
        this.setSession(token, sessionData as SesionRestaurante);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** Cierra sesión y redirige al admin_app. */
  logout(): void {
    this.clearSession();
    const adminUrl = environment.adminUrl ?? 'http://localhost:4002';
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `${adminUrl}/auth/login`;
    }
  }

  canAccessRoute(routePath: string): boolean {
    const session = this.session();
    if (!session) return false;

    // Compatibilidad con sesiones antiguas que no incluyen permisos.
    if (session.permisos_cargados !== true) {
      return true;
    }

    const allowedPaths = this.getAllowedPermissionPaths();
    if (allowedPaths.size === 0) {
      return false;
    }

    const normalizedRoute = normalizeRoutePath(routePath);
    const candidates = ROUTE_PERMISSION_ALIASES[normalizedRoute] ?? [normalizedRoute];

    return candidates.some((candidate) => {
      const normalizedCandidate = normalizeRoutePath(candidate);

      for (const allowed of allowedPaths) {
        if (allowed === normalizedCandidate) return true;
        if (allowed.startsWith(`${normalizedCandidate}/`)) return true;
        if (normalizedCandidate.startsWith(`${allowed}/`)) return true;
      }

      return false;
    });
  }

  getFirstAccessibleRoute(preferredRoutes: string[] = APP_ROUTE_PRIORITY): string | null {
    for (const route of preferredRoutes) {
      if (this.canAccessRoute(route)) {
        return route;
      }
    }
    return null;
  }

  getPermittedRoutesForSidebar(): string[] {
    return APP_ROUTE_PRIORITY.filter((route) => this.canAccessRoute(route));
  }

  canAccessSubnivel(code: string): boolean {
    const session = this.session();
    if (!session) return false;

    if (session.permisos_cargados !== true) {
      return true;
    }

    const normalizedCode = normalizePermissionCode(code);
    if (!normalizedCode) return false;

    const permisos = this.permisosSubnivelActivos();
    return permisos.some((permiso) =>
      permiso?.puede_ver && normalizePermissionCode(permiso.codigo) === normalizedCode
    );
  }

  // ============================================================
  // Interno
  // ============================================================

  /** Restaura sesión desde localStorage al iniciar. */
  private restoreSession(): void {
    const token = localStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(SESSION_KEY);
    if (token && raw) {
      try {
        const parsed = JSON.parse(raw) as SesionRestaurante;
        // Validar que tenga las propiedades mínimas esperadas
        if (!parsed?.usuario || !Array.isArray(parsed.roles_globales)) {
          this.clearSession();
          return;
        }
        this.session.set(parsed);
        // Restaurar negocio activo
        const savedNegocio = localStorage.getItem(NEGOCIO_KEY);
        if (savedNegocio && parsed.negocios) {
          const idx = parsed.negocios.findIndex(
            (n: NegocioRestaurante) => n.id_negocio === Number(savedNegocio)
          );
          if (idx >= 0) this._negocioIdx.set(idx);
        }
      } catch {
        this.clearSession();
      }
    }
  }

  private setSession(token: string, data: SesionRestaurante): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    this.session.set(data);
  }

  private clearSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(NEGOCIO_KEY);
    this.session.set(null);
    this._negocioIdx.set(0);
  }

  private getAllowedPermissionPaths(): Set<string> {
    const permisos = this.permisosVistaActivos();
    const result = new Set<string>();

    for (const permiso of permisos) {
      if (!permiso?.puede_ver || !permiso.url) continue;
      result.add(normalizeRoutePath(permiso.url));
    }

    return result;
  }
}
