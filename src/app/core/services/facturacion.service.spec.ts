import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { EstadoFe, FacturacionService, tonoDeFactura } from './facturacion.service';

const estado = (extra: Partial<EstadoFe> = {}): EstadoFe => ({
  activa: false,
  modo: 'NINGUNO',
  ambiente: null,
  tope_identificacion: 261870,
  motivo: 'MODO_NINGUNO',
  medios_pago: [],
  impuestos: [],
  alertas: [],
  ...extra,
});

/**
 * `activa()` y `configurable()` son los dos interruptores de los que cuelga TODO lo que la
 * facturación electrónica pinta en el restaurante. Para el negocio que no factura —casi todos—
 * los dos tienen que ser falsos, también mientras carga y también si la consulta falla.
 */
describe('FacturacionService', () => {
  const negocio = signal<{ id_negocio: number } | null>({ id_negocio: 17 });
  let http: HttpTestingController;
  let servicio: FacturacionService;
  const url = (id: number) => `${environment.apiUrl}/facturacion/estado?id_negocio=${id}`;

  beforeEach(() => {
    negocio.set({ id_negocio: 17 });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { negocio } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    servicio = TestBed.inject(FacturacionService);
    TestBed.tick();
  });

  it('mientras carga, el negocio se trata como que no factura', () => {
    expect(servicio.activa()).toBe(false);
    expect(servicio.configurable()).toBe(false);
    http.expectOne(url(17)).flush({ success: true, data: estado() });
  });

  it('un negocio en modo NINGUNO no ve nada de facturación', () => {
    http.expectOne(url(17)).flush({ success: true, data: estado() });
    expect(servicio.activa()).toBe(false);
    expect(servicio.configurable()).toBe(false);
  });

  it('un negocio que ya eligió facturar puede preparar su carta aunque todavía no emita', () => {
    http.expectOne(url(17)).flush({ success: true, data: estado({ modo: 'POS', motivo: 'NO_ACTIVO' }) });
    expect(servicio.activa()).toBe(false);
    expect(servicio.configurable()).toBe(true);
  });

  it('un negocio que emite: activa, con su tope', () => {
    http.expectOne(url(17)).flush({ success: true, data: estado({ activa: true, modo: 'POS', motivo: null }) });
    expect(servicio.activa()).toBe(true);
    expect(servicio.tope()).toBe(261870);
  });

  it('si la consulta falla, no factura (y el cobro no se entera)', () => {
    http.expectOne(url(17)).flush('boom', { status: 500, statusText: 'Error' });
    expect(servicio.activa()).toBe(false);
  });

  it('al cambiar de negocio olvida el estado del anterior antes de saber el del nuevo', () => {
    http.expectOne(url(17)).flush({ success: true, data: estado({ activa: true, modo: 'POS' }) });
    expect(servicio.activa()).toBe(true);
    negocio.set({ id_negocio: 18 });
    TestBed.tick();
    expect(servicio.activa()).toBe(false);
    http.expectOne(url(18)).flush({ success: true, data: estado() });
    expect(servicio.activa()).toBe(false);
  });

  it('el tono del aviso según cómo quedó la factura', () => {
    const f = (e: string) => ({ estado: e }) as Parameters<typeof tonoDeFactura>[0];
    expect(tonoDeFactura(null)).toBeNull();
    expect(tonoDeFactura(f('ACEPTADO'))).toBe('success');
    expect(tonoDeFactura(f('PENDIENTE_DATOS'))).toBe('warning');
    expect(tonoDeFactura(f('EN_COLA'))).toBe('info');
  });
});
