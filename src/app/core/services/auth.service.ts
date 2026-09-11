import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
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

/**
 * Estado del plan del negocio, tal como lo calcula `planHelper` en el backend.
 *
 * Un plan vencido no corta el acceso de inmediato: hay 5 días de gracia
 * (`estado: 'GRACIA'`, `activo: true`) durante los cuales el negocio sigue
 * trabajando mientras la app le avisa cuántos días le quedan para pagar.
 */
export interface EstadoPlan {
  estado: 'ACTIVO' | 'GRACIA' | 'VENCIDO' | 'SIN_PLAN';
  /** ¿Puede operar? Incluye los días de gracia. Es lo que mira el guardia. */
  activo: boolean;
  en_gracia: boolean;
  dias_gracia_restantes: number | null;
  fecha_fin: string | null;
  fecha_limite_gracia: string | null;
}

export interface NegocioRestaurante {
  id_negocio: number;
  nombre: string;
  tipo_negocio: string | null;
  paleta: { id_paleta: number; nombre: string; colores: Record<string, string> } | null;
  permite_multipago?: boolean;
  permite_pago_domicilio?: boolean;
  permite_descuento?: boolean;
  pregunta_cobro_envio?: boolean;
  permite_cuentas_cliente?: boolean;
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
  /** Detalle del plan del negocio activo (vencimiento y días de gracia). */
  plan?: EstadoPlan | null;
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
  '/clientes',
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
  '/clientes': ['/clientes'],
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
  private lastPerfilRefresh = 0;

  /** Señal de sesión activa. */
  readonly session = signal<SesionRestaurante | null>(null);

  /** Índice del negocio activo (seleccionado por el usuario). */
  private readonly _negocioIdx = signal<number>(0);

  /** ¿Está autenticado? */
  readonly isAuthenticated = computed(() => this.session() !== null);

  /**
   * ¿La sesión que hay en memoria la confirmó el servidor en ESTA carga de página?
   *
   * `restoreSession()` la saca de `localStorage`, y ahí pueden quedar permisos y
   * ajustes de hace horas: si a alguien le dieron o le quitaron un permiso, o el
   * negocio encendió una función, esa copia no se ha enterado. Mientras valga
   * `false`, los guardias tienen que preguntarle al backend antes de decidir —
   * que es lo que hace que **recargar la página** baste y no haya que cerrar sesión.
   */
  private readonly sesionConfirmada = signal(false);
  readonly sesionValidada = this.sesionConfirmada.asReadonly();

  /** ¿El negocio activo puede operar? (plan vigente o dentro de la gracia). */
  readonly planActivo = computed(() => this.session()?.plan_activo ?? false);

  /** Detalle del plan: vencimiento y días de gracia restantes. */
  readonly plan = computed<EstadoPlan | null>(() => this.session()?.plan ?? null);

  /**
   * El plan venció pero el negocio sigue operando dentro de los días de gracia.
   * Es la condición del aviso «tienes N días para pagar».
   */
  readonly planEnGracia = computed(() => this.plan()?.en_gracia === true);

  /** Días que quedan de gracia (0 si no aplica). */
  readonly diasGraciaPlan = computed(() => this.plan()?.dias_gracia_restantes ?? 0);

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

  /** ¿El negocio activo tiene habilitado el Multipago (varias formas de pago)? */
  readonly permiteMultipago = computed(() => !!this.negocio()?.permite_multipago);

  /**
   * ¿El negocio activo cobra el domicilio y lo paga al domiciliario desde caja?
   * Opt-in: nace apagado, así que un negocio que no lo activó no ve la casilla.
   */
  readonly permitePagoDomicilio = computed(() => !!this.negocio()?.permite_pago_domicilio);

  /**
   * ¿El negocio permite rebajar el pedido con un descuento?
   * Opt-in: nace apagado, así que quien no lo activó no ve el campo en el POS.
   */
  readonly permiteDescuento = computed(() => !!this.negocio()?.permite_descuento);

  /**
   * ¿Al enviar un pedido se pregunta "Cobrar ahora" / "Enviar sin cobrar"?
   * Opt-in: apagado (el default) el pedido sale sin cobrar y sin interrumpir.
   */
  readonly preguntaCobroEnvio = computed(() => !!this.negocio()?.pregunta_cobro_envio);

  /**
   * ¿El negocio maneja tiqueteras y fiado?
   *
   * Opt-in: nace apagado. Mientras lo esté, el módulo de Clientes no existe para él —ni menú,
   * ni ruta, ni forma de pago en el cobro— para no meterle una función que no pidió.
   */
  readonly permiteCuentasCliente = computed(() => !!this.negocio()?.permite_cuentas_cliente);

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
   * Revalida un token contra el backend y, si vale, reemplaza la sesión con lo que
   * diga el servidor (permisos y ajustes incluidos).
   *
   * Distingue **token inválido** de **servidor inalcanzable**, y esa diferencia importa:
   * lo primero obliga a cerrar sesión, lo segundo no. Tratar un corte de red como un
   * token caducado echaría de la app a un cajero por recargar la página con mala
   * conexión, y su sesión sigue siendo perfectamente válida.
   */
  async revalidarToken(token: string): Promise<'ok' | 'invalida' | 'sin-conexion'> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; data: SesionRestaurante }>(
          `${environment.apiUrl}/auth/verificar-token`,
          { token }
        )
      );

      if (res?.success && res.data) {
        this.setSession(token, res.data);
        return 'ok';
      }
      return 'invalida';
    } catch (err) {
      const status = (err as HttpErrorResponse)?.status ?? 0;
      // 401/403 los manda el backend cuando el token ya no sirve. Un 0 (sin red) o un
      // 5xx no dicen nada del token: dicen que ahora mismo no se puede preguntar.
      return status === 401 || status === 403 ? 'invalida' : 'sin-conexion';
    }
  }

  /**
   * Valida un token contra el backend y establece la sesión.
    * Se usa para revalidar el token persistido en localStorage.
   */
  async validateAndSetToken(token: string): Promise<boolean> {
    return (await this.revalidarToken(token)) === 'ok';
  }

  /**
   * Relee permisos y ajustes AHORA, sin esperar el límite de los 60 s.
   *
   * Para después de una acción que los cambia (guardar los permisos de un rol,
   * encender una función del negocio): quien la hizo debe ver el efecto en el acto,
   * no en la siguiente navegación.
   */
  async refrescarSesion(): Promise<void> {
    this.lastPerfilRefresh = 0;
    await this.refreshPerfilIfStale(0);
  }

  /**
   * Refresca permisos del perfil si han pasado al menos `maxAgeMs`.
   * Esto permite que los cambios hechos en Personal se reflejen sin cerrar sesion.
   */
  async refreshPerfilIfStale(maxAgeMs = 60_000): Promise<void> {
    const current = this.session();
    if (!current) return;
    const token = this.getAccessToken();
    if (!token) return;

    const now = Date.now();
    if (now - this.lastPerfilRefresh < maxAgeMs) return;
    this.lastPerfilRefresh = now;

    // `/perfil` devuelve como negocio principal el primero de la lista. Si el usuario
    // tiene varios y estaba en el segundo, hay que devolverle el suyo después de guardar
    // la sesión; si no, cada refresco lo cambiaba de negocio por debajo.
    const idNegocioActivo = this.negocio()?.id_negocio ?? null;

    try {
      // Se manda el negocio activo para que el estado del plan que vuelve sea el suyo
      // y no el del primero de la lista.
      const url = idNegocioActivo !== null
        ? `${environment.apiUrl}/perfil?id_negocio=${idNegocioActivo}`
        : `${environment.apiUrl}/perfil`;

      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: SesionRestaurante }>(url)
      );

      if (res?.success && res.data) {
        // El perfil trae el estado del plan recalculado; si por lo que sea no viniera,
        // se conserva el de la sesión en curso en vez de dar el negocio por bloqueado.
        const next = {
          ...res.data,
          plan_activo: res.data.plan_activo ?? current.plan_activo,
          plan: res.data.plan ?? current.plan ?? null,
          permisos_cargados: true,
        } as SesionRestaurante;
        this.setSession(token, next);
        if (idNegocioActivo !== null) this.setNegocioActivo(idNegocioActivo);
      }
    } catch {
      // No-op: si falla, se mantiene la sesion actual.
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

  /**
   * Vuelve al dashboard del admin_app (portal central del SaaS) sin cerrar la
   * sesión del negocio. Útil cuando el usuario tiene varios negocios y quiere
   * elegir otro desde el "home" de la plataforma.
   *
   * Como admin_app corre en otro origen (no comparte token), se hace un SSO de
   * salida: se pide un código de un solo uso y se entra por `/auth/callback`,
   * que rehidrata la sesión del admin_app. Así se evita caer en el login.
   */
  async irAlInicio(): Promise<void> {
    const adminUrl = environment.adminUrl ?? 'http://localhost:4002';
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this.getAccessToken();
    if (token) {
      try {
        const res = await firstValueFrom(
          this.http.post<{ success: boolean; data: { code: string } }>(
            `${environment.apiUrl}/auth/generar-codigo`,
            { token }
          )
        );
        const code = res?.data?.code;
        if (code) {
          window.location.href = `${adminUrl}/auth/callback?code=${encodeURIComponent(code)}`;
          return;
        }
      } catch {
        // Si falla la generación del código, se cae al dashboard directo
        // (admin_app pedirá login si no encuentra sesión propia).
      }
    }
    window.location.href = `${adminUrl}/admin/dashboard`;
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

  /**
   * Manda el negocio que eligió el backend, no el que quedó de la sesión anterior.
   *
   * `data.negocio` viene de canjear el código SSO: el admin dice a qué negocio se entra. Antes
   * esto no tocaba `_negocioIdx`, así que se quedaba el que `restoreSession()` había leído de
   * `localStorage` al arrancar — y con dos negocios del mismo tipo se entraba a uno y se
   * aterrizaba en el otro. Con uno solo el fallo es invisible, porque el guardado coincide.
   */
  private setSession(token: string, data: SesionRestaurante): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    this.session.set(data);
    // Esta sí viene del servidor: los guardias ya pueden fiarse de ella.
    this.sesionConfirmada.set(true);

    const elegido = data.negocio?.id_negocio ?? null;
    const idx = elegido !== null
      ? (data.negocios?.findIndex((n: NegocioRestaurante) => n.id_negocio === elegido) ?? -1)
      : -1;
    if (idx >= 0) {
      this._negocioIdx.set(idx);
      localStorage.setItem(NEGOCIO_KEY, String(elegido));
    }
  }

  private clearSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(NEGOCIO_KEY);
    this.session.set(null);
    this.sesionConfirmada.set(false);
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
