import { describe, expect, it } from 'vitest';

import {
  EstadisticasCarta,
  ajustarContraste,
  claveDiseno,
  contraste,
  evaluarAvisos,
  inicialesNegocio,
  normalizarHex,
  resolverTokens,
  textoSobre,
  urlGoogleFonts,
  fuentesARequerir,
  DISENO_POR_DEFECTO,
  DisenoCarta,
} from './carta-diseno';

const ESTADISTICAS_COMPLETAS: EstadisticasCarta = {
  categorias: 4,
  categorias_con_imagen: 4,
  productos: 30,
  productos_con_imagen: 30,
  productos_destacados: 3,
  destacados_con_imagen: 3,
};

function diseno(parcial: Partial<DisenoCarta>): DisenoCarta {
  return {
    ...DISENO_POR_DEFECTO,
    marca: {},
    opciones: { mostrar_agotados: false },
    ...parcial,
  };
}

function contexto(parcial: Partial<Parameters<typeof evaluarAvisos>[0]> = {}) {
  return {
    diseno: diseno({}),
    colorNegocio: null,
    estadisticas: ESTADISTICAS_COMPLETAS,
    tieneLogo: true,
    tieneWhatsapp: true,
    planIncluyeWhatsapp: true,
    ...parcial,
  };
}

describe('color', () => {
  it('mide el contraste WCAG en sus extremos', () => {
    expect(contraste('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contraste('#312E81', '#312E81')).toBeCloseTo(1, 5);
  });

  it('elige el texto que se lee sobre cada fondo', () => {
    expect(textoSobre('#D8FF33')).toBe('#111111');
    expect(textoSobre('#312E81')).toBe('#FFFFFF');
  });

  it('normaliza hexadecimales cortos y rechaza lo que no lo es', () => {
    expect(normalizarHex('abc')).toBe('#AABBCC');
    expect(normalizarHex('#c2410c')).toBe('#C2410C');
    expect(normalizarHex('rojo')).toBeNull();
  });

  it('propone un tono cercano que alcanza el contraste pedido', () => {
    const sugerido = ajustarContraste('#FFF200', '#FFFFFF', 3);
    expect(contraste(sugerido, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(sugerido).not.toBe('#000000');
  });
});

describe('resolverTokens', () => {
  it('la carta por defecto usa el color que el negocio ya tenía', () => {
    const tokens = resolverTokens(diseno({ plantilla: 'esencial' }), '#C2410C');
    expect(tokens['--carta-accent']).toBe('#C2410C');
  });

  it('las plantillas oscuras no heredan el color del negocio', () => {
    const tokens = resolverTokens(diseno({ plantilla: 'neon' }), '#312E81');
    expect(tokens['--carta-accent']).toBe('#D8FF33');
  });

  it('el color elegido para la carta manda sobre todo lo demás', () => {
    const tokens = resolverTokens(
      diseno({ plantilla: 'neon', marca: { color: '#ff0066' } }),
      '#312E81',
    );
    expect(tokens['--carta-accent']).toBe('#FF0066');
  });

  it('el precio cae al color del texto si el acento no se lee', () => {
    const tokens = resolverTokens(
      diseno({ plantilla: 'vitrina', marca: { color: '#FFF200' } }),
      null,
    );
    expect(tokens['--carta-price']).toBe('#211E1A');
  });

  it('aplica la tipografía y los bordes elegidos por el negocio', () => {
    const tokens = resolverTokens(
      diseno({ plantilla: 'esencial', marca: { fuente_titulos: 'lora', borde: 'recto' } }),
      null,
    );
    expect(tokens['--carta-font-titulos']).toContain('Lora');
    expect(tokens['--carta-radio-lg']).toBe('6px');
  });
});

describe('fuentes', () => {
  it('no descarga nada para la carta por defecto', () => {
    expect(urlGoogleFonts(fuentesARequerir(diseno({ plantilla: 'esencial' })))).toBeNull();
  });

  it('pide títulos y cuerpo en una sola hoja', () => {
    const url = urlGoogleFonts(fuentesARequerir(diseno({ plantilla: 'gaceta' })));
    expect(url).toContain('family=DM+Serif+Display');
    expect(url).toContain('family=Lora');
  });
});

describe('claveDiseno', () => {
  it('trata igual una marca vacía y una con claves indefinidas', () => {
    const a = diseno({ marca: {} });
    const b = diseno({ marca: { color: undefined, borde: undefined } });
    expect(claveDiseno(a)).toBe(claveDiseno(b));
  });
});

describe('inicialesNegocio', () => {
  it('toma las iniciales de las dos primeras palabras', () => {
    expect(inicialesNegocio('ZONA BURGER')).toBe('ZB');
    expect(inicialesNegocio('Raíz')).toBe('RA');
    expect(inicialesNegocio('')).toBe('');
  });
});

describe('evaluarAvisos', () => {
  it('una carta con todo lo necesario no avisa de nada', () => {
    expect(evaluarAvisos(contexto())).toEqual([]);
  });

  it('avisa que la lista queda incompleta sin fotos de categoría', () => {
    const avisos = evaluarAvisos(
      contexto({
        diseno: diseno({ formato: 'lista' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, categorias_con_imagen: 0 },
      }),
    );
    const aviso = avisos.find((a) => a.id === 'sin-fotos-categoria');
    expect(aviso?.nivel).toBe('atencion');
    expect(aviso?.detalle).toContain('incompleta');
  });

  it('cuenta las categorías reales cuando faltan algunas fotos', () => {
    const avisos = evaluarAvisos(
      contexto({
        diseno: diseno({ formato: 'mixto' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, categorias: 12, categorias_con_imagen: 9 },
      }),
    );
    expect(avisos.find((a) => a.id === 'fotos-categoria-parcial')?.titulo).toBe(
      '3 de 12 categorías no tienen foto',
    );
  });

  it('en Mixto sin populares avisa que se verá como una lista', () => {
    const avisos = evaluarAvisos(
      contexto({
        diseno: diseno({ formato: 'mixto' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, productos_destacados: 0, destacados_con_imagen: 0 },
      }),
    );
    expect(avisos.some((a) => a.id === 'sin-destacados' && a.nivel === 'atencion')).toBe(true);
  });

  it('Vitrina sin fotos de producto es un aviso de atención', () => {
    const avisos = evaluarAvisos(
      contexto({
        diseno: diseno({ plantilla: 'vitrina', formato: 'cards' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, productos_con_imagen: 10 },
      }),
    );
    expect(avisos.find((a) => a.id === 'fotos-producto-necesarias')?.titulo).toBe(
      '20 de 30 productos no tienen foto',
    );
  });

  it('con contraste bajo ofrece un color que sí se lee', () => {
    const avisos = evaluarAvisos(
      contexto({ diseno: diseno({ plantilla: 'esencial', marca: { color: '#FFF200' } }) }),
    );
    const aviso = avisos.find((a) => a.id === 'contraste-bajo');
    expect(aviso?.accion?.tipo).toBe('usar-color');
    expect(contraste(aviso!.accion!.valor!, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });

  it('pone primero los avisos de atención', () => {
    const avisos = evaluarAvisos(
      contexto({
        tieneLogo: false,
        diseno: diseno({ formato: 'lista' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, categorias_con_imagen: 0 },
      }),
    );
    expect(avisos[0].nivel).toBe('atencion');
    expect(avisos[avisos.length - 1].nivel).toBe('info');
  });
});
