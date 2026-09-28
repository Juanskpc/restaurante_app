import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';

import { AuthService } from '../../../core/services/auth.service';
import { CajaService, MovimientoCaja } from '../../../core/services/caja.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { CajaComponent } from './caja';

/**
 * Orden de la tabla de movimientos del turno.
 *
 * Cada encabezado ordena: primer clic ascendente, segundo descendente, tercero vuelve al orden
 * del servidor. Se prueba la lógica sin pintar la pantalla —la tabla es solo un `@for` sobre
 * `movimientosFiltrados()`—, y lo que importa es que ordene por lo que el usuario LEE en la celda.
 */
describe('CajaComponent — orden de la tabla de movimientos', () => {
  let comp: CajaComponent;

  const mov = (id: number, extra: Partial<MovimientoCaja> = {}): MovimientoCaja =>
    ({
      id_movimiento: id,
      tipo: 'INGRESO',
      monto: 0,
      fecha: '2026-09-28T10:00:00',
      concepto: null,
      orden: null,
      usuario: { primer_nombre: 'Ana', primer_apellido: 'Ruiz' },
      formas_pago: [],
      ...extra,
    }) as unknown as MovimientoCaja;

  const ids = () => comp.movimientosFiltrados().map((m) => m.id_movimiento);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { negocio: signal(null), canAccessSubnivel: () => true } },
        {
          provide: CajaService,
          useValue: {
            cajaAbierta: signal(null),
            cargando: signal(false),
            variasCajas: signal(false),
            puntoActivo: signal(null),
          },
        },
        { provide: RealtimeService, useValue: { alCambiar: () => () => undefined } },
        { provide: CatalogoCacheService, useValue: {} },
        { provide: UiFeedbackService, useValue: {} },
      ],
    });
    comp = TestBed.runInInjectionContext(() => new CajaComponent());
  });

  it('sin orden elegido, deja los movimientos como llegan del servidor', () => {
    comp.movimientos.set([mov(3), mov(1), mov(2)]);
    expect(ids()).toEqual([3, 1, 2]);
    expect(comp.ariaOrden('fecha')).toBe('none');
  });

  it('el clic avanza ascendente → descendente → sin orden', () => {
    comp.movimientos.set([
      mov(1, { fecha: '2026-09-28T12:00:00' }),
      mov(2, { fecha: '2026-09-28T09:00:00' }),
      mov(3, { fecha: '2026-09-28T15:00:00' }),
    ]);

    comp.alternarOrden('fecha');
    expect(ids()).toEqual([2, 1, 3]);
    expect(comp.ariaOrden('fecha')).toBe('ascending');
    expect(comp.iconoOrden('fecha')).toBe('arrow-up');

    comp.alternarOrden('fecha');
    expect(ids()).toEqual([3, 1, 2]);
    expect(comp.ariaOrden('fecha')).toBe('descending');
    expect(comp.iconoOrden('fecha')).toBe('arrow-down');

    comp.alternarOrden('fecha');
    expect(ids()).toEqual([1, 2, 3]);
    expect(comp.orden()).toBeNull();
    expect(comp.iconoOrden('fecha')).toBe('arrow-up-down');
  });

  it('cambiar de columna empieza otra vez en ascendente', () => {
    comp.movimientos.set([mov(1, { monto: 50 }), mov(2, { monto: 10 })]);
    comp.alternarOrden('fecha');
    comp.alternarOrden('fecha'); // descendente
    comp.alternarOrden('monto');
    expect(comp.orden()).toEqual({ campo: 'monto', direccion: 'asc' });
    expect(ids()).toEqual([2, 1]);
  });

  it('el monto se ordena como número, no como texto', () => {
    comp.movimientos.set([mov(1, { monto: 9000 }), mov(2, { monto: 100000 }), mov(3, { monto: 500 })]);
    comp.alternarOrden('monto');
    expect(ids()).toEqual([3, 1, 2]);
  });

  it('el concepto se ordena «natural»: ORD-0009 antes que ORD-0010', () => {
    comp.movimientos.set([
      mov(1, { concepto: 'ORD-0010' }),
      mov(2, { concepto: 'ORD-0009' }),
      mov(3, { concepto: 'ORD-0100' }),
    ]);
    comp.alternarOrden('concepto');
    expect(ids()).toEqual([2, 1, 3]);
  });

  it('la forma de pago ordena por lo que se lee en la celda', () => {
    comp.movimientos.set([
      mov(1, { formas_pago: [{ id_metodo_pago: 2, nombre: 'Transferencia' }] as never }),
      mov(2, { formas_pago: [{ id_metodo_pago: 1, nombre: 'Efectivo' }] as never }),
      mov(3, { formas_pago: [] }),
    ]);
    comp.alternarOrden('formaPago');
    // «—» (sin forma de pago) antes que las letras.
    expect(ids()).toEqual([3, 2, 1]);
  });

  it('a igual valor conserva el orden del servidor (no baraja)', () => {
    comp.movimientos.set([mov(5), mov(4), mov(6)]); // mismo tipo y mismo usuario
    comp.alternarOrden('tipo');
    expect(ids()).toEqual([5, 4, 6]);
    comp.alternarOrden('tipo');
    expect(ids()).toEqual([5, 4, 6]);
  });

  it('el orden se combina con el filtro por forma de pago', () => {
    comp.movimientos.set([
      mov(1, { monto: 30, formas_pago: [{ id_metodo_pago: 1, nombre: 'Efectivo' }] as never }),
      mov(2, { monto: 10, formas_pago: [{ id_metodo_pago: 2, nombre: 'Transferencia' }] as never }),
      mov(3, { monto: 20, formas_pago: [{ id_metodo_pago: 1, nombre: 'Efectivo' }] as never }),
    ]);
    comp.alternarOrden('monto');
    comp.alternarMetodo('2'); // oculta Transferencia
    expect(ids()).toEqual([3, 1]);
  });

  it('el detalle del historial usa el mismo orden', () => {
    comp.movimientosHist.set([mov(1, { monto: 30 }), mov(2, { monto: 10 })]);
    comp.alternarOrden('monto');
    expect(comp.movimientosHistOrdenados().map((m) => m.id_movimiento)).toEqual([2, 1]);
  });
});
