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
    localStorage.setItem('app_token', 'token-de-ayer');
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
