import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AuthService, SesionRestaurante } from './auth.service';
import { environment } from '../../../environments/environment';

/**
 * La sesión que se guarda en `localStorage` es una FOTO, y las fotos envejecen.
 *
 * Si a alguien le dan o le quitan un permiso —o el negocio enciende una función en
 * Configuración—, esa copia no se entera. Por eso `sesionValidada()` existe: dice si lo que
 * hay en memoria lo confirmó el servidor en esta carga de la página, y es lo que hace que los
 * guardias pregunten antes de decidir. Sin eso había que cerrar sesión para ver un cambio.
 *
 * Lo otro que se prueba aquí es la diferencia entre «tu token ya no vale» y «ahora mismo no
 * puedo preguntar»: confundirlas echaba de la app a quien recargara con mala conexión.
 */

/**
 * Un JWT con la forma que de verdad emite el backend: `{ id_usuario }` en el cuerpo.
 *
 * La firma es de adorno porque aquí nadie la valida —eso es del servidor—, pero las tres
 * partes y el cuerpo en base64url tienen que estar: `restoreSession()` lee el `id_usuario` de
 * ahí para comprobar que la sesión guardada es de la misma persona que el token.
 */
function jwtDe(idUsuario: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id_usuario: idUsuario })}.firma`;
}

describe('AuthService — frescura de la sesión', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  const sesion = (permisos: string[]): SesionRestaurante => ({
    usuario: {
      id_usuario: 7,
      nombre_completo: 'Ana Cajera',
      primer_nombre: 'Ana',
      primer_apellido: 'Cajera',
      email: 'ana@demo.co',
    },
    permisos_cargados: true,
    negocio: null,
    negocios: [
      {
        id_negocio: 1,
        nombre: 'Restaurante Demo',
        tipo_negocio: 'RESTAURANTE',
        paleta: null,
        roles: [{ id_rol: 2, descripcion: 'CAJERO' }],
        permisos_vista: permisos.map((url, i) => ({
          id_nivel: i + 1,
          vista: url,
          url,
          roles: ['CAJERO'],
          puede_ver: true,
          puede_crear: false,
          puede_editar: false,
          puede_eliminar: false,
        })),
        permisos_subnivel: [],
      },
    ],
    roles: [{ id_rol: 2, descripcion: 'CAJERO' }],
    roles_globales: [],
  });

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  it('una sesión sacada de localStorage NO cuenta como validada', () => {
    // El token es de la MISMA persona que la sesión (usuario 7): es el caso normal, recargar
    // la página. Lo que se afirma es que la sesión se restaura pero sin el sello de validada.
    localStorage.setItem('app_token', jwtDe(7));
    localStorage.setItem('app_session', JSON.stringify(sesion(['/pedidos'])));

    // Nueva instancia: es lo que pasa al recargar la página.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const recargado = TestBed.inject(AuthService);
    const httpRecargado = TestBed.inject(HttpTestingController);

    expect(recargado.isAuthenticated()).toBe(true);
    expect(recargado.sesionValidada()).toBe(false);

    httpRecargado.verify();
  });

  it('tras revalidar contra el backend, la sesión queda validada y con los permisos nuevos', async () => {
    localStorage.setItem('app_token', 'token');
    const promesa = auth.revalidarToken('token');

    http
      .expectOne(`${environment.apiUrl}/auth/verificar-token`)
      .flush({ success: true, data: sesion(['/pedidos', '/caja']) });

    expect(await promesa).toBe('ok');
    expect(auth.sesionValidada()).toBe(true);
    // El permiso que acaban de conceder ya se ve, sin cerrar sesión.
    expect(auth.canAccessRoute('/caja')).toBe(true);
  });

  it('un permiso retirado deja de dar acceso en cuanto vuelve el perfil', async () => {
    localStorage.setItem('app_token', 'token');
    const primera = auth.revalidarToken('token');
    http
      .expectOne(`${environment.apiUrl}/auth/verificar-token`)
      .flush({ success: true, data: sesion(['/pedidos', '/caja']) });
    await primera;
    expect(auth.canAccessRoute('/caja')).toBe(true);

    const refresco = auth.refrescarSesion();
    http
      .expectOne((r) => r.url.startsWith(`${environment.apiUrl}/perfil`))
      .flush({ success: true, data: sesion(['/pedidos']) });
    await refresco;

    expect(auth.canAccessRoute('/caja')).toBe(false);
    expect(auth.canAccessRoute('/pedidos')).toBe(true);
  });

  it('un 401 invalida la sesión; un fallo de red NO', async () => {
    localStorage.setItem('app_token', 'token');

    const caducado = auth.revalidarToken('token');
    http
      .expectOne(`${environment.apiUrl}/auth/verificar-token`)
      .flush({ success: false, message: 'Token inválido' }, { status: 401, statusText: 'Unauthorized' });
    expect(await caducado).toBe('invalida');

    const sinRed = auth.revalidarToken('token');
    http
      .expectOne(`${environment.apiUrl}/auth/verificar-token`)
      .error(new ProgressEvent('error'));
    expect(await sinRed).toBe('sin-conexion');
  });
});

/**
 * El token y la sesión pueden ser de personas distintas, y en producción lo fueron.
 *
 * Las tres apps comparten origen (`escalapp.cloud/admin`, `/restaurante`, `/reserva`) y por
 * tanto un solo `localStorage`, y `admin_app_v21` guarda su token bajo la MISMA clave
 * `app_token` que esta app. Iniciar sesión en el panel y abrir `/restaurante` dejaba el token
 * de uno junto a la sesión guardada de otro: la app arrancaba con el negocio equivocado y el
 * encabezado se ponía a consultar su inventario cada 60 s. La auditoría del backend registró
 * 1.705 peticiones así (2026-10-04, módulo `authz`).
 */
describe('AuthService — token y sesión de personas distintas', () => {
  function recargar() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    return {
      auth: TestBed.inject(AuthService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  const sesionDe = (idUsuario: number, idNegocio: number): SesionRestaurante => ({
    usuario: {
      id_usuario: idUsuario,
      nombre_completo: 'Quien sea',
      primer_nombre: 'Quien',
      primer_apellido: 'Sea',
      email: 'quien@demo.co',
    },
    negocio: null,
    negocios: [
      {
        id_negocio: idNegocio,
        nombre: `Negocio ${idNegocio}`,
        tipo_negocio: 'RESTAURANTE',
        paleta: null,
        roles: [{ id_rol: 2, descripcion: 'ADMINISTRADOR' }],
        permisos_vista: [],
        permisos_subnivel: [],
      },
    ],
    roles: [{ id_rol: 2, descripcion: 'ADMINISTRADOR' }],
    roles_globales: [],
  });

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('descarta la sesión ajena en vez de arrancar con el negocio de otro', () => {
    // El escenario medido: token del usuario 36 (negocio 16), sesión guardada del negocio 12.
    localStorage.setItem('app_token', jwtDe(36));
    localStorage.setItem('app_session', JSON.stringify(sesionDe(19, 12)));
    localStorage.setItem('app_negocio_activo', '12');

    const { auth, http } = recargar();

    expect(auth.isAuthenticated()).toBe(false);
    // Lo que importa: nadie puede leer el negocio 12 de una sesión que no es suya.
    expect(auth.negocio()).toBeNull();
    http.verify();
  });

  it('conserva el token al descartarla: el guardia lo revalida y trae la sesión buena', () => {
    const token = jwtDe(36);
    localStorage.setItem('app_token', token);
    localStorage.setItem('app_session', JSON.stringify(sesionDe(19, 12)));

    const { auth, http } = recargar();

    // Borrar el token aquí cerraría la sesión de quien acaba de entrar por el panel.
    expect(auth.getAccessToken()).toBe(token);
    expect(localStorage.getItem('app_session')).toBeNull();
    expect(localStorage.getItem('app_negocio_activo')).toBeNull();
    http.verify();
  });

  it('un token ilegible tampoco restaura: ante la duda, no se adivina', () => {
    localStorage.setItem('app_token', 'esto-no-es-un-jwt');
    localStorage.setItem('app_session', JSON.stringify(sesionDe(19, 12)));

    const { auth, http } = recargar();

    expect(auth.isAuthenticated()).toBe(false);
    http.verify();
  });

  it('cuando sí corresponden, la sesión se restaura con su negocio', () => {
    localStorage.setItem('app_token', jwtDe(19));
    localStorage.setItem('app_session', JSON.stringify(sesionDe(19, 12)));
    localStorage.setItem('app_negocio_activo', '12');

    const { auth, http } = recargar();

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.negocio()?.id_negocio).toBe(12);
    http.verify();
  });
});
