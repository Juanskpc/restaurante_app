import { describe, expect, it } from 'vitest';

import { agruparPorSeccion, normalizarSeccion, seccionesExistentes } from './mesa-secciones';

const m = (id: number, seccion?: string | null) => ({ id, seccion });

describe('mesa-secciones', () => {
  describe('agruparPorSeccion', () => {
    it('sin ninguna sección el salón queda como siempre: un solo grupo, sin título', () => {
      const grupos = agruparPorSeccion([m(1), m(2, null), m(3, '  ')]);
      expect(grupos).toHaveLength(1);
      expect(grupos[0].titulo).toBeNull();
      expect(grupos[0].mesas.map((x) => x.id)).toEqual([1, 2, 3]);
    });

    it('sin mesas no hay grupos', () => {
      expect(agruparPorSeccion([])).toEqual([]);
    });

    it('agrupa por sección, en orden natural, y las que no tienen van al final', () => {
      const grupos = agruparPorSeccion([
        m(1, 'Piso 10'),
        m(2, 'Patio'),
        m(3),
        m(4, 'Piso 2'),
        m(5, 'Piso 10'),
      ]);
      expect(grupos.map((g) => g.titulo)).toEqual(['Patio', 'Piso 2', 'Piso 10', 'Sin sección']);
      expect(grupos[2].mesas.map((x) => x.id)).toEqual([1, 5]);
      expect(grupos[3].mesas.map((x) => x.id)).toEqual([3]);
    });

    it('«Patio», «patio» y « Patio » son la misma sección', () => {
      const grupos = agruparPorSeccion([m(1, 'Patio'), m(2, 'patio'), m(3, ' Patio ')]);
      expect(grupos).toHaveLength(1);
      expect(grupos[0].titulo).toBe('Patio');
      expect(grupos[0].mesas).toHaveLength(3);
    });

    it('dentro de cada grupo conserva el orden en que llegan las mesas', () => {
      const grupos = agruparPorSeccion([m(3, 'A'), m(1, 'A'), m(2, 'A')]);
      expect(grupos[0].mesas.map((x) => x.id)).toEqual([3, 1, 2]);
    });
  });

  describe('seccionesExistentes', () => {
    it('sin repetir, en orden natural y sin las vacías', () => {
      expect(seccionesExistentes([m(1, 'Terraza'), m(2, 'piso 2'), m(3, 'Piso 2'), m(4), m(5, 'Piso 10')])).toEqual([
        'piso 2',
        'Piso 10',
        'Terraza',
      ]);
    });
  });

  it('normalizarSeccion junta espacios y recorta', () => {
    expect(normalizarSeccion('  Piso   1 ')).toBe('Piso 1');
    expect(normalizarSeccion(null)).toBe('');
    expect(normalizarSeccion(undefined)).toBe('');
  });
});
