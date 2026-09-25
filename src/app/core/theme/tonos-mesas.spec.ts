import { describe, expect, it } from 'vitest';

import {
  ANCLAS,
  CROMA,
  TONOS_POR_DEFECTO,
  hexAOklch,
  inclinarTono,
  tonosDeMesas,
} from './tonos-mesas';

/** Las marcas de las paletas del negocio (aproximadas), entre ellas la que motivó el cambio. */
const MARCAS: Record<string, string> = {
  'Rojo Gastronómico': '#C62828',
  'Azul Corporativo': '#1565C0',
  'Naranja Vibrante': '#E65100',
  'Morado Elegante': '#6A1B9A',
  'Índigo EscalApp': '#312E81',
  'Verde Natural': '#2E7D32',
  'Rosa Delicado': '#D81B60',
  Vino: '#8E1338',
  Terracota: '#A0391A',
  'Dorado Premium': '#B8860B',
  Esmeralda: '#0F766E',
  Cobalto: '#1E40AF',
};

/** Distancia entre dos tonos en el círculo (0..180). */
const distancia = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe('tonos-mesas', () => {
  describe('hexAOklch', () => {
    it('lee los tonos conocidos', () => {
      // Rojo ≈ 29°, verde ≈ 142°, azul ≈ 264° en OKLCH.
      expect(hexAOklch('#ff0000')!.h).toBeGreaterThan(25);
      expect(hexAOklch('#ff0000')!.h).toBeLessThan(35);
      expect(hexAOklch('#00ff00')!.h).toBeGreaterThan(135);
      expect(hexAOklch('#00ff00')!.h).toBeLessThan(150);
      expect(hexAOklch('#0000ff')!.h).toBeGreaterThan(258);
      expect(hexAOklch('#0000ff')!.h).toBeLessThan(270);
    });

    it('acepta #rgb, sin # y mayúsculas', () => {
      expect(hexAOklch('#f00')!.h).toBeCloseTo(hexAOklch('#ff0000')!.h, 5);
      expect(hexAOklch('FF0000')!.h).toBeCloseTo(hexAOklch('#ff0000')!.h, 5);
    });

    it('un gris casi no tiene croma; lo ilegible da null', () => {
      expect(hexAOklch('#808080')!.c).toBeLessThan(0.01);
      expect(hexAOklch('rojo')).toBeNull();
      expect(hexAOklch('')).toBeNull();
      expect(hexAOklch('rgb(1,2,3)')).toBeNull();
    });
  });

  describe('inclinarTono', () => {
    it('por el camino CORTO: de 28° hacia 350° baja (pasando por 0°), no da la vuelta larga', () => {
      // 28° → 350° son 38° hacia abajo: a mitad de camino, 9°. La vuelta larga daría 189°.
      const t = inclinarTono(28, 350, 0.5);
      expect(t).toBeCloseTo(9, 5);
    });

    it('cruza el 0° sin saltos: de 350° hacia 28° sube hasta 9°', () => {
      expect(inclinarTono(350, 28, 0.5)).toBeCloseTo(9, 5);
    });

    it('sin influencia se queda en el ancla y con influencia total llega a la marca', () => {
      expect(inclinarTono(150, 25, 0)).toBe(150);
      expect(inclinarTono(150, 25, 1)).toBeCloseTo(25, 5);
    });
  });

  describe('tonosDeMesas', () => {
    it('sin color legible devuelve los tonos de siempre', () => {
      expect(tonosDeMesas(null)).toEqual(TONOS_POR_DEFECTO);
      expect(tonosDeMesas('no es un color')).toEqual(TONOS_POR_DEFECTO);
    });

    it('una marca sin color (negro, gris, blanco) no aporta tono: quedan los de siempre', () => {
      for (const hex of ['#000000', '#808080', '#ffffff']) {
        const t = tonosDeMesas(hex);
        expect(t.libre, hex).toBe(ANCLAS.libre);
        expect(t.ocupada, hex).toBe(ANCLAS.ocupada);
        expect(t.cobro, hex).toBe(ANCLAS.cobro);
        expect(t.croma, hex).toBe(CROMA.porDefecto);
      }
    });

    it('un grafito con tinte azul solo inclina un poco: sigue dentro del margen', () => {
      const t = tonosDeMesas('#1F2937');
      expect(distancia(t.libre, ANCLAS.libre)).toBeLessThanOrEqual(45);
    });

    it('CASO ZONA BURGER: con la marca roja, libre es AZUL (no rojo) y ocupada sigue siendo roja', () => {
      const t = tonosDeMesas(MARCAS['Rojo Gastronómico']);
      // Libre azul (≈ 270°): lejos del rojo de la marca (≈ 27°), no heredado de ella.
      expect(distancia(t.libre, 27)).toBeGreaterThan(80);
      expect(t.libre).toBeGreaterThan(250);
      expect(t.libre).toBeLessThan(290);
      // Ocupada roja-naranja.
      expect(distancia(t.ocupada, ANCLAS.ocupada)).toBeLessThan(15);
    });

    it('con CUALQUIER marca cada estado conserva su significado (cerca de su ancla)', () => {
      for (const [nombre, hex] of Object.entries(MARCAS)) {
        const t = tonosDeMesas(hex);
        expect(distancia(t.libre, ANCLAS.libre), `${nombre} libre`).toBeLessThanOrEqual(45);
        expect(distancia(t.ocupada, ANCLAS.ocupada), `${nombre} ocupada`).toBeLessThanOrEqual(45);
        expect(distancia(t.cobro, ANCLAS.cobro), `${nombre} cobro`).toBeLessThanOrEqual(45);
      }
    });

    it('con CUALQUIER marca los tres estados se distinguen entre sí (≥ 40° de separación)', () => {
      for (const [nombre, hex] of Object.entries(MARCAS)) {
        const t = tonosDeMesas(hex);
        expect(distancia(t.libre, t.ocupada), `${nombre} libre/ocupada`).toBeGreaterThanOrEqual(40);
        expect(distancia(t.libre, t.cobro), `${nombre} libre/cobro`).toBeGreaterThanOrEqual(40);
        expect(distancia(t.ocupada, t.cobro), `${nombre} ocupada/cobro`).toBeGreaterThanOrEqual(40);
      }
    });

    it('la marca sí deja huella: dos marcas distintas dan tonos distintos', () => {
      const roja = tonosDeMesas(MARCAS['Rojo Gastronómico']);
      const azul = tonosDeMesas(MARCAS['Azul Corporativo']);
      expect(roja.libre).not.toBe(azul.libre);
    });

    it('la intensidad sale de la marca pero se queda en un rango legible', () => {
      for (const hex of Object.values(MARCAS)) {
        const { croma } = tonosDeMesas(hex);
        expect(croma).toBeGreaterThanOrEqual(CROMA.min);
        expect(croma).toBeLessThanOrEqual(CROMA.max);
      }
    });
  });
});
