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
  formatoEfectivo,
  plantillaPorId,
  PLANTILLAS,
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

  it('los colores encendidos llevan letra blanca y los cálidos claros, negra', () => {
    // El caso que motivó la regla: un rojo con letra negra se ve sucio, aunque WCAG lo
    // prefiera por unas décimas.
    expect(textoSobre('#FF0000')).toBe('#FFFFFF');
    expect(textoSobre('#E11D48')).toBe('#FFFFFF');
    expect(textoSobre('#1D4ED8')).toBe('#FFFFFF');
    expect(textoSobre('#15803D')).toBe('#FFFFFF');

    expect(textoSobre('#FFFF00')).toBe('#111111');
    expect(textoSobre('#FF8C00')).toBe('#111111');
    expect(textoSobre('#E0A458')).toBe('#111111');
    expect(textoSobre('#FFFFFF')).toBe('#111111');
  });

  it('nunca deja una letra ilegible: el contraste desempata', () => {
    for (const fondo of ['#FF0000', '#FFFF00', '#808080', '#767676', '#00FF00', '#0000FF']) {
      expect(contraste(fondo, textoSobre(fondo))).toBeGreaterThanOrEqual(3);
    }
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

describe('resolverTokens — el acento como texto', () => {
  it('sobre plantilla oscura, un rojo encendido se aclara hasta leerse', () => {
    const tokens = resolverTokens(diseno({ plantilla: 'neon', marca: { color: '#FF0000' } }), null);

    // De fondo se respeta el color elegido…
    expect(tokens['--carta-accent']).toBe('#FF0000');
    // …y encima va letra blanca, no negra.
    expect(tokens['--carta-on-accent']).toBe('#FFFFFF');
    // De texto sobre el fondo casi negro, el mismo rojo no se lee: se corrige.
    expect(tokens['--carta-accent-text']).not.toBe('#FF0000');
    expect(contraste(tokens['--carta-accent-text'], '#0E0E10')).toBeGreaterThanOrEqual(4.5);
  });

  it('un acento que ya se lee no se toca', () => {
    const tokens = resolverTokens(diseno({ plantilla: 'esencial', marca: { color: '#312E81' } }), null);
    expect(tokens['--carta-accent-text']).toBe('#312E81');
  });

  it('un amarillo sobre plantilla clara se oscurece para el texto, pero conserva su letra negra encima', () => {
    const tokens = resolverTokens(diseno({ plantilla: 'esencial', marca: { color: '#FFD400' } }), null);

    expect(tokens['--carta-on-accent']).toBe('#111111');
    expect(contraste(tokens['--carta-accent-text'], '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
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

  it('una carta publicada con una plantilla retirada cae en la más parecida, no en la de por defecto', () => {
    // Un bar que eligió Medianoche (oscura) no puede amanecer con la carta blanca.
    expect(plantillaPorId('medianoche').id).toBe('neon');
    expect(plantillaPorId('medianoche').oscura).toBe(true);
    expect(plantillaPorId('papel').id).toBe('gaceta');
    expect(plantillaPorId('mostrador').id).toBe('retro');
    // Un nombre que nunca existió sí cae en la de por defecto.
    expect(plantillaPorId('inventada').id).toBe('esencial');
  });

  it('las plantillas a dos columnas ignoran el formato elegido', () => {
    expect(formatoEfectivo(diseno({ plantilla: 'mural', formato: 'cards' }))).toBe('lista');
    expect(formatoEfectivo(diseno({ plantilla: 'retro', formato: 'cards' }))).toBe('lista');
    // Las estándar sí lo respetan.
    expect(formatoEfectivo(diseno({ plantilla: 'esencial', formato: 'cards' }))).toBe('cards');
    expect(formatoEfectivo(diseno({ plantilla: 'esencial', formato: 'lista' }))).toBe('lista');
  });

  it('el formato «mixto» retirado se lee como tarjetas', () => {
    const viejo = { ...DISENO_POR_DEFECTO, formato: 'mixto' } as unknown as DisenoCarta;
    expect(formatoEfectivo(viejo)).toBe('cards');
  });

  it('cada plantilla declara su composición', () => {
    expect(PLANTILLAS.map((p) => p.id).sort()).toEqual(
      ['esencial', 'gaceta', 'mural', 'neon', 'retro'],
    );
    expect(PLANTILLAS.every((p) => !!p.composicion)).toBe(true);
    // Y hay al menos dos formas distintas de armar la carta, que es de lo que se trataba.
    expect(new Set(PLANTILLAS.map((p) => p.composicion)).size).toBeGreaterThanOrEqual(3);
  });

  it('Urban Black no se descarga de Google: es propia', () => {
    const fuentes = fuentesARequerir(diseno({ plantilla: 'neon' }));
    expect(fuentes.some((f) => f.id === 'urban-black')).toBe(false);
    expect(plantillaPorId('neon').fuenteTitulos).toBe('urban-black');
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
      diseno({ plantilla: 'retro', marca: { color: '#FFF200' } }),
      null,
    );
    expect(tokens['--carta-price']).toBe('#1C5D44');
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
        diseno: diseno({ formato: 'lista' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, categorias: 12, categorias_con_imagen: 9 },
      }),
    );
    expect(avisos.find((a) => a.id === 'fotos-categoria-parcial')?.titulo).toBe(
      '3 de 12 categorías no tienen foto',
    );
  });

  it('una plantilla a dos columnas avisa de que ignora el formato', () => {
    const avisos = evaluarAvisos(
      contexto({ diseno: diseno({ plantilla: 'mural', formato: 'cards' }) }),
    );
    expect(avisos.some((a) => a.id === 'composicion-manda')).toBe(true);
  });

  it('y no pide fotos de categoría, porque no las usa', () => {
    const avisos = evaluarAvisos(
      contexto({
        diseno: diseno({ plantilla: 'retro', formato: 'lista' }),
        estadisticas: { ...ESTADISTICAS_COMPLETAS, categorias_con_imagen: 0 },
      }),
    );
    expect(avisos.some((a) => a.id === 'sin-fotos-categoria')).toBe(false);
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
