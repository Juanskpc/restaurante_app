import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { AuthService } from '../../../core/services/auth.service';
import { CajaService } from '../../../core/services/caja.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { ClientesService } from '../../../core/services/clientes.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { DespachoComponent, PedidoDespacho } from './despacho';

/**
 * Confirmar un pedido que tomó el asistente de WhatsApp.
 *
 * El pedido nace «pendiente de confirmar» hasta que alguien del negocio lo da por visto. Lo que se
 * sostiene aquí: mientras esté pendiente la acción principal de la tarjeta es confirmar; confirmar
 * llama al servidor y SOLO después pregunta por la comanda; y las dos respuestas —imprimir u
 * omitir— dejan el pedido confirmado.
 */
describe('DespachoComponent — confirmar pedidos del asistente', () => {
  let comp: DespachoComponent;
  let http: HttpTestingController;
  let confirmar: ReturnType<typeof vi.fn>;
  const ui = { confirm: vi.fn(), success: vi.fn(), error: vi.fn(), alert: vi.fn() };

  const pedido = (extra: Partial<PedidoDespacho> = {}): PedidoDespacho =>
    ({
      id_orden: 7,
      numero_orden: 'ORD-0007',
      tipo_pedido: 'LLEVAR',
      total: 25000,
      estado: 'ABIERTA',
      estado_pago: 'pendiente_pago',
      de_whatsapp: true,
      pendiente_confirmar: true,
      puede_avisar_listo: true,
      fecha_creacion: '2026-09-28T12:00:00',
      ...extra,
    }) as PedidoDespacho;

  beforeEach(() => {
    vi.clearAllMocks();
    confirmar = ui.confirm;
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthService,
          useValue: {
            negocio: signal({ id_negocio: 12, roles: [{ descripcion: 'ADMINISTRADOR' }] }),
            session: signal({ roles_globales: [] }),
            canAccessSubnivel: () => true,
            canAccessRoute: () => true,
            permiteMultipago: () => false,
            permitePagoDomicilio: () => false,
            permiteDescuento: () => false,
            permiteCuentasCliente: () => false,
            usuario: () => ({ nombre_completo: 'Ana' }),
          },
        },
        { provide: CajaService, useValue: { cajaAbierta: signal(null), variasCajas: signal(false) } },
        { provide: CatalogoCacheService, useValue: {} },
        { provide: ClientesService, useValue: {} },
        { provide: RealtimeService, useValue: { alCambiar: () => () => undefined } },
        { provide: UiFeedbackService, useValue: ui },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    comp = TestBed.runInInjectionContext(() => new DespachoComponent());
    comp.pedidos.set([pedido(), pedido({ id_orden: 8, numero_orden: 'ORD-0008', pendiente_confirmar: false })]);
  });

  afterEach(() => http.verify());

  it('pendiente: la acción principal es confirmar, antes que avisar o cobrar', () => {
    expect(comp.accionPrincipal(pedido())).toBe('confirmar');
  });

  it('ya confirmado: vuelve a lo de siempre (avisar, y luego cobrar)', () => {
    expect(comp.accionPrincipal(pedido({ pendiente_confirmar: false }))).toBe('avisar');
    expect(
      comp.accionPrincipal(pedido({ pendiente_confirmar: false, puede_avisar_listo: false })),
    ).toBe('cobrar');
  });

  it('cuenta los pendientes para el punto del chip de WhatsApp', () => {
    expect(comp.countPorConfirmar()).toBe(1);
  });

  it('confirmar llama al servidor y marca la tarjeta como confirmada', async () => {
    ui.confirm.mockResolvedValue(false);
    comp.confirmarPedido(pedido());

    const req = http.expectOne((r) => r.url.endsWith('/despacho/7/confirmar'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ id_negocio: 12 });
    req.flush({ success: true });

    expect(comp.pedidos().find((p) => p.id_orden === 7)?.pendiente_confirmar).toBe(false);
    expect(comp.countPorConfirmar()).toBe(0);
    expect(comp.confirmandoId()).toBeNull();
  });

  it('después de confirmar pregunta por la comanda: «Imprimir» imprime', async () => {
    ui.confirm.mockResolvedValue(true);
    const imprimir = vi.spyOn(comp, 'imprimirTicket').mockImplementation(() => undefined);

    comp.confirmarPedido(pedido());
    http.expectOne((r) => r.url.endsWith('/despacho/7/confirmar')).flush({ success: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar.mock.calls[0][0]).toMatchObject({
      confirmText: 'Imprimir comanda',
      cancelText: 'Omitir',
    });
    expect(imprimir).toHaveBeenCalledTimes(1);
  });

  it('«Omitir» no imprime, y el pedido queda confirmado igual', async () => {
    ui.confirm.mockResolvedValue(false);
    const imprimir = vi.spyOn(comp, 'imprimirTicket').mockImplementation(() => undefined);

    comp.confirmarPedido(pedido());
    http.expectOne((r) => r.url.endsWith('/despacho/7/confirmar')).flush({ success: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(imprimir).not.toHaveBeenCalled();
    expect(comp.pedidos().find((p) => p.id_orden === 7)?.pendiente_confirmar).toBe(false);
  });

  it('dos clics seguidos no mandan dos peticiones', () => {
    ui.confirm.mockResolvedValue(false);
    comp.confirmarPedido(pedido());
    comp.confirmarPedido(pedido());

    // `expectOne` falla si hubiera dos.
    http.expectOne((r) => r.url.endsWith('/despacho/7/confirmar')).flush({ success: true });
  });

  it('si falla, no pregunta por la comanda y recarga la lista', () => {
    comp.confirmarPedido(pedido());
    http
      .expectOne((r) => r.url.endsWith('/despacho/7/confirmar'))
      .flush({ success: false, message: 'Este pedido ya no está abierto.' }, { status: 409, statusText: 'Conflict' });

    expect(ui.error).toHaveBeenCalledWith('Este pedido ya no está abierto.');
    expect(confirmar).not.toHaveBeenCalled();
    expect(comp.pedidos().find((p) => p.id_orden === 7)?.pendiente_confirmar).toBe(true);
    // `cargar()` vuelve a pedir la lista para no quedarse con una pantalla vieja.
    http.expectOne((r) => r.url.includes('/despacho?id_negocio=12')).flush({ success: true, data: [] });
  });

  it('un pedido que no está pendiente no llama al servidor', () => {
    comp.confirmarPedido(pedido({ pendiente_confirmar: false }));
    http.expectNone((r) => r.url.endsWith('/confirmar'));
  });
});
