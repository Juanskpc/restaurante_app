import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RealtimeService, parsearAvisoSse } from './realtime.service';
import { AuthService } from './auth.service';

/**
 * Los avisos en vivo.
 *
 * Dos capas, probadas aparte porque fallan por motivos distintos:
 *
 *  1. **Leer el flujo.** Por ahí entra de todo: latidos, bloques partidos por la mitad, avisos
 *     sin datos, JSON roto. Nada de eso puede tumbar la conexión — si se cae, la pantalla se
 *     queda congelada y nadie lo nota hasta que un pedido se pierde.
 *  2. **Repartir la recarga.** Es donde vive el riesgo para el servidor: doce tablets oyendo
 *     el mismo aviso no pueden convertirlo en doce consultas por cada producto que alguien
 *     añade a una comanda. Se juntan los avisos seguidos y se respeta un mínimo entre recargas
 *     del mismo tema.
 */
describe('parsearAvisoSse', () => {
  it('saca los temas de un aviso de cambio', () => {
    const bloque = 'event: cambio\ndata: {"temas":["pedidos","caja"],"en":"2026-09-11T20:00:00Z"}';
    expect(parsearAvisoSse(bloque)).toEqual(['pedidos', 'caja']);
  });

  it('ignora el latido, que es solo para mantener viva la conexión', () => {
    expect(parsearAvisoSse(': latido')).toBeNull();
  });

  it('ignora la confirmación de conexión: no anuncia ningún cambio', () => {
    expect(parsearAvisoSse('event: listo\ndata: {"canal":"restaurante","id_negocio":12}')).toBeNull();
  });

  it('aguanta lo que venga mal sin lanzar', () => {
    expect(parsearAvisoSse('')).toBeNull();
    expect(parsearAvisoSse('event: cambio')).toBeNull();
    expect(parsearAvisoSse('event: cambio\ndata: {esto no es json')).toBeNull();
    expect(parsearAvisoSse('event: cambio\ndata: {"temas":[]}')).toBeNull();
  });
});

describe('RealtimeService — reparto de recargas', () => {
  let rt: RealtimeService;

  const authStub = {
    // En falso para que el servicio NO abra conexión: aquí se prueba el reparto, y la
    // conexión de verdad ya está cubierta por el test del servidor (`eventos_sse.test.js`).
    isAuthenticated: signal(false),
    negocio: signal<{ id_negocio: number } | null>(null),
    getAccessToken: () => null,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: authStub }],
    });
    rt = TestBed.inject(RealtimeService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Deja pasar el tiempo de agrupación más la dispersión aleatoria. */
  const dejarPasarLaEspera = () => vi.advanceTimersByTime(1_000);

  it('avisa solo a quien escucha ese tema', () => {
    const enMesas = vi.fn();
    const enCocina = vi.fn();
    rt.alCambiar(['mesas'], enMesas);
    rt.alCambiar(['cocina'], enCocina);

    rt.refrescar(['mesas']);
    dejarPasarLaEspera();

    expect(enMesas).toHaveBeenCalledTimes(1);
    expect(enCocina).not.toHaveBeenCalled();
  });

  it('una pantalla apuntada a varios temas recarga una sola vez por aviso', () => {
    const recargar = vi.fn();
    rt.alCambiar(['mesas', 'pedidos'], recargar);

    rt.refrescar(['mesas']);
    dejarPasarLaEspera();

    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('junta una ráfaga de avisos en una sola recarga', () => {
    const recargar = vi.fn();
    rt.alCambiar(['pedidos'], recargar);

    // Un mesero metiendo cinco productos seguidos: cinco avisos, una consulta.
    for (let i = 0; i < 5; i += 1) rt.refrescar(['pedidos']);
    dejarPasarLaEspera();

    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('respeta un mínimo entre recargas del mismo tema, pero no se pierde ninguna', () => {
    const recargar = vi.fn();
    rt.alCambiar(['pedidos'], recargar);

    rt.refrescar(['pedidos']);
    dejarPasarLaEspera();
    expect(recargar).toHaveBeenCalledTimes(1);

    // Otro cambio inmediatamente después: se aplaza, no se descarta.
    rt.refrescar(['pedidos']);
    vi.advanceTimersByTime(700);
    expect(recargar).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(recargar).toHaveBeenCalledTimes(2);
  });

  it('darse de baja deja de recibir', () => {
    const recargar = vi.fn();
    const baja = rt.alCambiar(['caja'], recargar);

    baja();
    rt.refrescar(['caja']);
    dejarPasarLaEspera();

    expect(recargar).not.toHaveBeenCalled();
  });

  it('una pantalla que falla al recargar no deja sin avisar a las demás', () => {
    const rota = vi.fn(() => {
      throw new Error('se rompió pintando');
    });
    const sana = vi.fn();
    rt.alCambiar(['pedidos'], rota);
    rt.alCambiar(['pedidos'], sana);

    expect(() => {
      rt.refrescar(['pedidos']);
      dejarPasarLaEspera();
    }).not.toThrow();
    expect(sana).toHaveBeenCalledTimes(1);
  });
});
