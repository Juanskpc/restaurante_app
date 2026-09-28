import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AuthService } from '../../../core/services/auth.service';
import { Caja, CajaService, MovimientoCaja } from '../../../core/services/caja.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import { CajaComponent } from './caja';

/**
 * Rediseño de Caja (2026-09-29): tarjetas de resumen, desglose por forma de pago con barras y el
 * historial como pestaña. Lo que se sostiene es la lógica que alimenta esas piezas.
 */
describe('CajaComponent — resumen, formas de pago y pestañas', () => {
  let comp: CajaComponent;
  let getHistorial: ReturnType<typeof vi.fn>;

  const mov = (id: number, extra: Partial<MovimientoCaja> = {}): MovimientoCaja =>
    ({
      id_movimiento: id, tipo: 'INGRESO', monto: 1000, fecha: '2026-09-28T10:00:00',
      concepto: null, orden: null, usuario: null, formas_pago: [], ...extra,
    }) as unknown as MovimientoCaja;

  const efectivo = { id_metodo_pago: 1, nombre: 'Efectivo', valor: 1000 };
  const transferencia = { id_metodo_pago: 2, nombre: 'Transferencia', valor: 1000 };

  beforeEach(() => {
    getHistorial = vi.fn(() => of({ success: true, message: 'ok', data: { rows: [], total: 0 } }));
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { negocio: signal({ id_negocio: 7 }), canAccessSubnivel: () => true } },
        {
          provide: CajaService,
          useValue: {
            cajaAbierta: signal(null), cargando: signal(false), variasCajas: signal(false),
            puntoActivo: signal(null), getHistorial,
          },
        },
        { provide: RealtimeService, useValue: { alCambiar: () => () => undefined } },
        { provide: CatalogoCacheService, useValue: {} },
        { provide: UiFeedbackService, useValue: {} },
      ],
    });
    comp = TestBed.runInInjectionContext(() => new CajaComponent());
  });

  describe('filasMetodo', () => {
    const caja = (lista: Caja['ingresos_por_metodo']) => ({ ingresos_por_metodo: lista }) as Caja;

    it('sin desglose no hay filas', () => {
      expect(comp.filasMetodo(caja([]), [])).toEqual([]);
      expect(comp.filasMetodo(null, [])).toEqual([]);
    });

    it('cuenta los movimientos de cada forma de pago y escala las barras contra la mayor', () => {
      const filas = comp.filasMetodo(
        caja([
          { id_metodo_pago: 1, nombre: 'Efectivo', total: 200000 },
          { id_metodo_pago: 2, nombre: 'Transferencia', total: 50000 },
        ]),
        [
          mov(1, { formas_pago: [efectivo] }),
          mov(2, { formas_pago: [efectivo] }),
          mov(3, { formas_pago: [transferencia] }),
        ],
      );
      expect(filas.map((f) => [f.nombre, f.movimientos, f.pct])).toEqual([
        ['Efectivo', 2, 100],
        ['Transferencia', 1, 25],
      ]);
    });

    it('un pedido con dos formas de pago cuenta en las dos', () => {
      const filas = comp.filasMetodo(
        caja([
          { id_metodo_pago: 1, nombre: 'Efectivo', total: 10 },
          { id_metodo_pago: 2, nombre: 'Transferencia', total: 10 },
        ]),
        [mov(1, { formas_pago: [efectivo, transferencia] })],
      );
      expect(filas.map((f) => f.movimientos)).toEqual([1, 1]);
    });

    it('lo que no tiene forma de pago se cuenta aparte', () => {
      const filas = comp.filasMetodo(
        caja([{ id_metodo_pago: null, nombre: 'Sin forma de pago', total: 2000 }]),
        [mov(1)],
      );
      expect(filas[0].movimientos).toBe(1);
    });

    it('una forma de pago en negativo no tiene barra, y un turno sin ingresos no divide por cero', () => {
      const filas = comp.filasMetodo(caja([{ id_metodo_pago: 1, nombre: 'Efectivo', total: -5000 }]), []);
      expect(filas[0].total).toBe(-5000);
      expect(filas[0].pct).toBe(0);
      expect(Number.isFinite(filas[0].pct)).toBe(true);
    });
  });

  describe('conteoIngresos', () => {
    it('cuenta solo los ingresos vigentes: ni egresos, ni anulados, ni sus reversas', () => {
      expect(
        comp.conteoIngresos([
          mov(1),
          mov(2),
          mov(3, { tipo: 'EGRESO' }),
          mov(4, { anulado: true }),
          mov(5, { es_anulacion: true }),
        ]),
      ).toBe(2);
    });
  });

  describe('etiquetaTipo', () => {
    it('en minúscula tras la inicial, y distingue las anulaciones', () => {
      expect(comp.etiquetaTipo(mov(1))).toBe('Ingreso');
      expect(comp.etiquetaTipo(mov(2, { tipo: 'EGRESO' }))).toBe('Egreso');
      expect(comp.etiquetaTipo(mov(3, { anulado: true }))).toBe('Ingreso · Anulado');
      expect(comp.etiquetaTipo(mov(4, { es_anulacion: true }))).toBe('Eliminado');
    });
  });

  describe('pestañas', () => {
    it('arranca en el turno actual', () => {
      expect(comp.pestana()).toBe('turno');
    });

    it('al pasar a Historial lee los turnos cerrados', () => {
      comp.cambiarPestana('historial');
      expect(comp.pestana()).toBe('historial');
      expect(getHistorial).toHaveBeenCalledTimes(1);
    });

    it('siempre entra a la LISTA, no al detalle que se dejó abierto', () => {
      comp.cajaHistSel.set({ id_caja: 3 } as Caja);
      comp.movimientosHist.set([mov(1)]);
      comp.cambiarPestana('historial');
      comp.cambiarPestana('turno');
      comp.cajaHistSel.set({ id_caja: 3 } as Caja);
      comp.cambiarPestana('historial');

      expect(comp.cajaHistSel()).toBeNull();
      expect(comp.movimientosHist()).toEqual([]);
    });

    it('volver al turno cierra las filas desplegadas', () => {
      comp.cambiarPestana('historial');
      comp.filasAbiertas.set(new Set([9]));
      comp.cambiarPestana('turno');
      expect(comp.filasAbiertas().size).toBe(0);
    });

    it('tocar la pestaña en la que ya estás no vuelve a pedir nada', () => {
      comp.cambiarPestana('historial');
      getHistorial.mockClear();
      comp.cambiarPestana('historial');
      expect(getHistorial).not.toHaveBeenCalled();
    });
  });
});
