import { describe, expect, it } from 'vitest';

import {
  ALERTA_MINUTOS,
  MAX_SILLAS_DIBUJADAS,
  formaDeMesa,
  minutosDeEtiqueta,
  puestos,
  sillasDeMesa,
  superaAlerta,
} from './mesa-geometria';

describe('mesa-geometria', () => {
  describe('formaDeMesa', () => {
    it('elige la forma según los puestos', () => {
      expect(formaDeMesa(1)).toBe('redonda');
      expect(formaDeMesa(2)).toBe('redonda');
      expect(formaDeMesa(3)).toBe('cuadrada');
      expect(formaDeMesa(4)).toBe('cuadrada');
      expect(formaDeMesa(5)).toBe('rectangular');
      expect(formaDeMesa(12)).toBe('rectangular');
    });

    it('sin capacidad válida cae en 4 puestos', () => {
      expect(puestos(0)).toBe(4);
      expect(puestos(null)).toBe(4);
      expect(puestos(undefined)).toBe(4);
      expect(puestos(NaN)).toBe(4);
      expect(formaDeMesa(0)).toBe('cuadrada');
    });
  });

  describe('sillasDeMesa', () => {
    it('dibuja una silla por puesto', () => {
      for (const n of [1, 2, 3, 4, 5, 6, 8]) {
        expect(sillasDeMesa(n)).toHaveLength(n);
      }
    });

    it('no dibuja más sillas de las que caben', () => {
      expect(sillasDeMesa(20)).toHaveLength(MAX_SILLAS_DIBUJADAS);
    });

    it('la mesa de 4 tiene una silla por lado', () => {
      const lados = sillasDeMesa(4).map((s) => `${s.x},${s.y}`);
      expect(lados).toEqual(['50,0', '100,50', '50,100', '0,50']);
    });

    it('la mesa redonda de 2 sienta a uno frente al otro', () => {
      const [a, b] = sillasDeMesa(2);
      expect(a).toMatchObject({ x: 50, y: 0 });
      expect(b).toMatchObject({ x: 50, y: 100 });
    });

    it('la rectangular reparte mitad arriba y mitad abajo, mirando hacia la mesa', () => {
      const sillas = sillasDeMesa(7);
      const arriba = sillas.filter((s) => s.y === 0);
      const abajo = sillas.filter((s) => s.y === 100);
      expect(arriba).toHaveLength(4);
      expect(abajo).toHaveLength(3);
      expect(arriba.every((s) => s.giro === 0)).toBe(true);
      expect(abajo.every((s) => s.giro === 180)).toBe(true);
    });

    it('ninguna silla se sale del recuadro de la mesa', () => {
      for (const n of [1, 2, 3, 4, 5, 6, 9, 12, 20]) {
        for (const s of sillasDeMesa(n)) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(100);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(100);
        }
      }
    });
  });

  describe('minutosDeEtiqueta', () => {
    it('lee los dos formatos que manda el servidor', () => {
      expect(minutosDeEtiqueta('1 min')).toBe(1);
      expect(minutosDeEtiqueta('45 min')).toBe(45);
      expect(minutosDeEtiqueta('46h 53m')).toBe(46 * 60 + 53);
      expect(minutosDeEtiqueta('1h 0m')).toBe(60);
    });

    it('devuelve null si no hay tiempo que leer', () => {
      expect(minutosDeEtiqueta('')).toBeNull();
      expect(minutosDeEtiqueta(null)).toBeNull();
      expect(minutosDeEtiqueta('Sin uso')).toBeNull();
    });
  });

  describe('superaAlerta', () => {
    it('alerta desde los 45 minutos', () => {
      expect(ALERTA_MINUTOS).toBe(45);
      expect(superaAlerta(44)).toBe(false);
      expect(superaAlerta(45)).toBe(true);
      expect(superaAlerta(46 * 60 + 53)).toBe(true);
      expect(superaAlerta(null)).toBe(false);
    });
  });
});
