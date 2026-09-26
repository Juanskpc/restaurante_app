import { describe, it, expect, beforeAll } from 'vitest';
import { registerLocaleData } from '@angular/common';
import localeEsCO from '@angular/common/locales/es-CO';

import { etiquetaFecha } from './etiqueta-fecha';

// «Ahora»: sábado 25 de septiembre de 2026, 10:00 a. m. (hora local del equipo).
const AHORA = new Date(2026, 8, 25, 10, 0, 0);
const local = (mes: number, dia: number, h: number, min = 0) => new Date(2026, mes - 1, dia, h, min);

describe('etiquetaFecha', () => {
  beforeAll(() => registerLocaleData(localeEsCO, 'es-CO'));

  it('de hoy: solo la hora', () => {
    const texto = etiquetaFecha(local(9, 25, 8, 2), 'es-CO', AHORA);
    expect(texto).toMatch(/8:02/);
    expect(texto).not.toMatch(/ayer/);
  });

  it('de ayer: «ayer» y la hora', () => {
    const texto = etiquetaFecha(local(9, 24, 20, 2), 'es-CO', AHORA);
    expect(texto).toMatch(/^ayer /);
    expect(texto).toMatch(/8:02/);
  });

  it('ayer se cuenta por día de calendario, no por 24 horas', () => {
    // 11:30 p. m. de anoche, visto 10:30 horas después: sigue siendo «ayer».
    expect(etiquetaFecha(local(9, 24, 23, 30), 'es-CO', AHORA)).toMatch(/^ayer /);
  });

  it('de dos días o más: solo la fecha, sin hora', () => {
    expect(etiquetaFecha(local(9, 23, 20, 2), 'es-CO', AHORA)).toBe('23 sept');
    expect(etiquetaFecha(local(4, 3, 20, 2), 'es-CO', AHORA)).toBe('03 abr');
  });

  it('del futuro (reloj atrasado): se trata como de hoy', () => {
    expect(etiquetaFecha(local(9, 26, 9, 0), 'es-CO', AHORA)).not.toMatch(/ayer/);
  });

  it('acepta el texto ISO que manda el servidor', () => {
    const iso = local(9, 24, 20, 2).toISOString();
    expect(etiquetaFecha(iso, 'es-CO', AHORA)).toMatch(/^ayer /);
  });

  it('valores vacíos o inválidos dan texto vacío', () => {
    expect(etiquetaFecha(null, 'es-CO', AHORA)).toBe('');
    expect(etiquetaFecha(undefined, 'es-CO', AHORA)).toBe('');
    expect(etiquetaFecha('', 'es-CO', AHORA)).toBe('');
    expect(etiquetaFecha('no es una fecha', 'es-CO', AHORA)).toBe('');
  });
});
