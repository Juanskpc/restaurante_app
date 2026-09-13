/**
 * Diseño de la carta virtual: plantillas, formatos, tokens y avisos.
 *
 * Lo usan dos pantallas que tienen que ver exactamente lo mismo: la carta pública
 * (`/carta/:id`) y el editor de Configuración → Apariencia. Por eso vive aquí y no dentro
 * de ninguna de las dos.
 *
 * ## Una plantilla es un conjunto de valores, no una vista
 *
 * La carta es un solo componente. Cada plantilla le da valores distintos a los mismos
 * tokens `--carta-*` (colores, tipografía, radios, proporción de la foto) y activa unos
 * pocos rasgos de estructura (miniatura en lista, línea de puntos al precio). Añadir una
 * plantilla es añadir una entrada a `PLANTILLAS` y, si hace falta, un bloque de estilos.
 *
 * ## El backend conoce los nombres, no los valores
 *
 * El servidor valida que la plantilla exista y que el plan la incluya; los colores de
 * cada una solo están aquí. Así, afinar una plantilla mejora la carta de todos los negocios
 * que la usan sin tocar su configuración guardada.
 */

export type PlantillaId =
  | 'esencial'
  | 'neon'
  | 'gaceta'
  | 'medianoche'
  | 'papel'
  | 'vitrina'
  | 'mostrador';

export type FormatoId = 'cards' | 'lista' | 'mixto';
export type FuenteId = 'sistema' | 'inter' | 'poppins' | 'lora' | 'archivo-narrow' | 'dm-serif-display';
export type BordeId = 'recto' | 'suave' | 'redondo';

/** Solo lo que el negocio cambió; lo demás lo pone la plantilla. */
export interface MarcaCarta {
  color?: string;
  fuente_titulos?: FuenteId;
  borde?: BordeId;
}

export interface OpcionesCarta {
  mostrar_agotados: boolean;
}

export interface DisenoCarta {
  plantilla: PlantillaId;
  formato: FormatoId;
  marca: MarcaCarta;
  opciones: OpcionesCarta;
}

/** Lo que llega dentro de `GET /public/negocios/:id` como `carta`. */
export interface CartaPublicaConfig extends DisenoCarta {
  /** El color que el negocio ya tenía (su paleta). Es el acento por defecto. */
  color_negocio: string | null;
  /** Plan con WhatsApp incluido y un número publicado. */
  puede_pedir: boolean;
}

export interface EstadisticasCarta {
  categorias: number;
  categorias_con_imagen: number;
  productos: number;
  productos_con_imagen: number;
  productos_destacados: number;
  destacados_con_imagen: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catálogos
// ─────────────────────────────────────────────────────────────────────────────

export interface FuenteDef {
  id: FuenteId;
  nombre: string;
  /** Pila completa con alternativas reales: si la fuente no carga, la carta sigue leyéndose. */
  stack: string;
  /** Parámetro `family` de Google Fonts, o `null` si no hay nada que descargar. */
  google: string | null;
  /** Algunas fuentes de titular solo existen en un peso; forzar 700 las engorda artificialmente. */
  pesoTitulos: number;
}

/**
 * Tipografías disponibles.
 *
 * Pocas y probadas a propósito: las seis leen bien en pantalla pequeña y tienen acentos y
 * eñe completas. «Del sistema» es la misma pila que usa hoy el panel, y no descarga nada.
 */
export const FUENTES: readonly FuenteDef[] = [
  {
    id: 'sistema',
    nombre: 'Del sistema',
    stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif",
    google: null,
    pesoTitulos: 700,
  },
  {
    id: 'inter',
    nombre: 'Inter',
    stack: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
    google: 'Inter:wght@400;500;600;700;800',
    pesoTitulos: 700,
  },
  {
    id: 'poppins',
    nombre: 'Poppins',
    stack: "'Poppins', system-ui, -apple-system, 'Segoe UI', sans-serif",
    google: 'Poppins:wght@400;500;600;700',
    pesoTitulos: 600,
  },
  {
    id: 'lora',
    nombre: 'Lora',
    stack: "'Lora', Georgia, 'Times New Roman', serif",
    google: 'Lora:wght@400;500;600;700',
    pesoTitulos: 600,
  },
  {
    id: 'archivo-narrow',
    nombre: 'Archivo Narrow',
    stack: "'Archivo Narrow', 'Arial Narrow', 'Roboto Condensed', sans-serif",
    google: 'Archivo+Narrow:wght@500;600;700',
    pesoTitulos: 700,
  },
  {
    id: 'dm-serif-display',
    nombre: 'DM Serif Display',
    stack: "'DM Serif Display', Georgia, 'Times New Roman', serif",
    google: 'DM+Serif+Display',
    pesoTitulos: 400,
  },
];

export interface BordeDef {
  id: BordeId;
  nombre: string;
  radios: { sm: string; md: string; lg: string; chip: string };
}

/** «Suave» son exactamente los radios que la carta tuvo siempre. */
export const BORDES: readonly BordeDef[] = [
  { id: 'recto', nombre: 'Rectos', radios: { sm: '2px', md: '4px', lg: '6px', chip: '6px' } },
  { id: 'suave', nombre: 'Suaves', radios: { sm: '6px', md: '10px', lg: '16px', chip: '9999px' } },
  { id: 'redondo', nombre: 'Redondos', radios: { sm: '10px', md: '16px', lg: '22px', chip: '9999px' } },
];

export interface FormatoDef {
  id: FormatoId;
  nombre: string;
  descripcion: string;
}

export const FORMATOS: readonly FormatoDef[] = [
  {
    id: 'cards',
    nombre: 'Tarjetas',
    descripcion: 'Una tarjeta con foto por producto. Vende por antojo; necesita fotos.',
  },
  {
    id: 'lista',
    nombre: 'Lista',
    descripcion: 'Cada categoría abre con su foto y debajo van los productos en filas.',
  },
  {
    id: 'mixto',
    nombre: 'Mixto',
    descripcion: 'Los productos populares arriba en tarjetas y el resto en lista.',
  },
];

interface PaletaPlantilla {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  muted: string;
  border: string;
  accent: string;
}

export interface PlantillaDef {
  id: PlantillaId;
  nombre: string;
  estilo: string;
  descripcion: string;
  ideal: string;
  oscura: boolean;
  /** ¿El acento por defecto es el color del negocio? En las oscuras no: un índigo se perdería. */
  usaColorNegocio: boolean;
  paleta: PaletaPlantilla;
  fuenteTitulos: FuenteId;
  fuenteCuerpo: FuenteId;
  borde: BordeId;
  mayusculasTitulos: boolean;
  mayusculasProductos: boolean;
  espaciadoTitulos: string;
  fotoProducto: string;
  formatoSugerido: FormatoId;
  /** Cuánto se resiente la plantilla sin fotos de producto. Alimenta los avisos. */
  fotosProducto: 'necesarias' | 'recomendadas' | 'opcionales';
  miniaturaEnLista: boolean;
  precioConPuntos: boolean;
  /** Color del precio: el acento, el color del texto, o la mezcla verde de la carta original. */
  precio: 'acento' | 'tinta' | 'mezcla-exito';
  sombra: boolean;
  bordeTarjeta: boolean;
}

export const PLANTILLAS: readonly PlantillaDef[] = [
  {
    id: 'esencial',
    nombre: 'Esencial',
    estilo: 'La de siempre',
    descripcion: 'La carta con la que empezaste: tarjetas limpias sobre fondo gris claro.',
    ideal: 'cualquier negocio que quiera operar sin configurar nada',
    oscura: false,
    usaColorNegocio: true,
    paleta: {
      bg: '#F5F5F5',
      surface: '#FFFFFF',
      surface2: '#F7F7F7',
      ink: '#0F0A2A',
      muted: '#616161',
      border: '#E0E0E0',
      accent: '#312E81',
    },
    fuenteTitulos: 'sistema',
    fuenteCuerpo: 'sistema',
    borde: 'suave',
    mayusculasTitulos: false,
    mayusculasProductos: false,
    espaciadoTitulos: 'normal',
    fotoProducto: '4 / 3',
    formatoSugerido: 'cards',
    fotosProducto: 'recomendadas',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'mezcla-exito',
    sombra: true,
    bordeTarjeta: true,
  },
  {
    id: 'neon',
    nombre: 'Neón',
    estilo: 'Urbano / street',
    descripcion: 'Fondo casi negro, un acento fluor y títulos condensados en mayúsculas.',
    ideal: 'hamburgueserías, food trucks y alitas',
    oscura: true,
    usaColorNegocio: false,
    paleta: {
      bg: '#0E0E10',
      surface: '#1A1A1E',
      surface2: '#232329',
      ink: '#F5F5F0',
      muted: '#A1A1AA',
      border: '#2A2A31',
      accent: '#D8FF33',
    },
    fuenteTitulos: 'archivo-narrow',
    fuenteCuerpo: 'inter',
    borde: 'recto',
    mayusculasTitulos: true,
    mayusculasProductos: true,
    espaciadoTitulos: '0.04em',
    fotoProducto: '16 / 9',
    formatoSugerido: 'cards',
    fotosProducto: 'recomendadas',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'acento',
    sombra: false,
    bordeTarjeta: false,
  },
  {
    id: 'gaceta',
    nombre: 'Gaceta',
    estilo: 'Editorial clásico',
    descripcion: 'Papel crema, titulares con serifa y una línea de puntos hasta el precio.',
    ideal: 'cocina tradicional y menú del día, aunque no tengas fotos',
    oscura: false,
    usaColorNegocio: true,
    paleta: {
      bg: '#FBF8F1',
      surface: '#FFFDF8',
      surface2: '#F2ECDF',
      ink: '#1E1B16',
      muted: '#6B6358',
      border: '#E4DCCB',
      accent: '#7C2D2D',
    },
    fuenteTitulos: 'dm-serif-display',
    fuenteCuerpo: 'lora',
    borde: 'recto',
    mayusculasTitulos: false,
    mayusculasProductos: false,
    espaciadoTitulos: 'normal',
    fotoProducto: '4 / 3',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: false,
    precioConPuntos: true,
    precio: 'tinta',
    sombra: false,
    bordeTarjeta: true,
  },
  {
    id: 'medianoche',
    nombre: 'Medianoche',
    estilo: 'Oscura y elegante',
    descripcion: 'Superficies violeta profundo, foto protagonista y precio en ámbar.',
    ideal: 'bares, coctelería y pizzerías de noche',
    oscura: true,
    usaColorNegocio: false,
    paleta: {
      bg: '#13121A',
      surface: '#1E1D27',
      surface2: '#2A2836',
      ink: '#F0EEF5',
      muted: '#A9A5B8',
      border: '#34313F',
      accent: '#E0A458',
    },
    fuenteTitulos: 'lora',
    fuenteCuerpo: 'inter',
    borde: 'redondo',
    mayusculasTitulos: false,
    mayusculasProductos: false,
    espaciadoTitulos: 'normal',
    fotoProducto: '16 / 9',
    formatoSugerido: 'cards',
    fotosProducto: 'recomendadas',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'acento',
    sombra: false,
    bordeTarjeta: false,
  },
  {
    id: 'papel',
    nombre: 'Papel',
    estilo: 'Minimal',
    descripcion: 'Blanco, negro y mucho aire. Sin sombras ni cajas: solo la carta.',
    ideal: 'cafés de especialidad, panaderías y cartas cortas',
    oscura: false,
    usaColorNegocio: false,
    paleta: {
      bg: '#FFFFFF',
      surface: '#FFFFFF',
      surface2: '#F4F4F4',
      ink: '#1C1C1C',
      muted: '#6B6B6B',
      border: '#E6E6E6',
      accent: '#1C1C1C',
    },
    fuenteTitulos: 'inter',
    fuenteCuerpo: 'inter',
    borde: 'recto',
    mayusculasTitulos: true,
    mayusculasProductos: false,
    espaciadoTitulos: '0.12em',
    fotoProducto: '1 / 1',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: false,
    precioConPuntos: true,
    precio: 'tinta',
    sombra: false,
    bordeTarjeta: false,
  },
  {
    id: 'vitrina',
    nombre: 'Vitrina',
    estilo: 'Foto protagonista',
    descripcion: 'Fotos cuadradas grandes, dos por fila en el móvil. La imagen vende.',
    ideal: 'sushi, postres, heladerías y brunch con buenas fotos',
    oscura: false,
    usaColorNegocio: true,
    paleta: {
      bg: '#F4F1EC',
      surface: '#FFFFFF',
      surface2: '#EBE6DE',
      ink: '#211E1A',
      muted: '#6B655C',
      border: '#E3DDD3',
      accent: '#C2410C',
    },
    fuenteTitulos: 'poppins',
    fuenteCuerpo: 'inter',
    borde: 'redondo',
    mayusculasTitulos: false,
    mayusculasProductos: false,
    espaciadoTitulos: 'normal',
    fotoProducto: '1 / 1',
    formatoSugerido: 'cards',
    fotosProducto: 'necesarias',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'acento',
    sombra: true,
    bordeTarjeta: false,
  },
  {
    id: 'mostrador',
    nombre: 'Mostrador',
    estilo: 'Lista compacta',
    descripcion: 'Cabecera de color y filas densas con miniatura. Se recorre rápido.',
    ideal: 'cartas de muchos productos, comidas rápidas y tiendas',
    oscura: false,
    usaColorNegocio: true,
    paleta: {
      bg: '#F6F7FA',
      surface: '#FFFFFF',
      surface2: '#EEF1F6',
      ink: '#14213D',
      muted: '#5B6474',
      border: '#E2E6EE',
      accent: '#14213D',
    },
    fuenteTitulos: 'sistema',
    fuenteCuerpo: 'sistema',
    borde: 'recto',
    mayusculasTitulos: false,
    mayusculasProductos: false,
    espaciadoTitulos: 'normal',
    fotoProducto: '1 / 1',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: true,
    precioConPuntos: false,
    precio: 'tinta',
    sombra: false,
    bordeTarjeta: true,
  },
];

export const DISENO_POR_DEFECTO: Readonly<DisenoCarta> = Object.freeze({
  plantilla: 'esencial',
  formato: 'cards',
  marca: Object.freeze({}) as MarcaCarta,
  opciones: Object.freeze({ mostrar_agotados: false }),
});

export function plantillaPorId(id: string | null | undefined): PlantillaDef {
  return PLANTILLAS.find((p) => p.id === id) ?? PLANTILLAS[0];
}

export function fuentePorId(id: string | null | undefined): FuenteDef {
  return FUENTES.find((f) => f.id === id) ?? FUENTES[0];
}

export function bordePorId(id: string | null | undefined): BordeDef {
  return BORDES.find((b) => b.id === id) ?? BORDES[1];
}

/** Copia editable: el diseño publicado no debe mutarse al tocar el borrador. */
export function clonarDiseno(diseno: DisenoCarta | null | undefined): DisenoCarta {
  const base = diseno ?? DISENO_POR_DEFECTO;
  return {
    plantilla: base.plantilla,
    formato: base.formato,
    marca: { ...(base.marca ?? {}) },
    opciones: { mostrar_agotados: base.opciones?.mostrar_agotados === true },
  };
}

/**
 * Huella comparable de un diseño.
 *
 * Dos diseños equivalentes tienen que dar la misma cadena aunque uno lleve `marca.borde`
 * ausente y el otro `undefined`: si no, la pantalla diría «cambios sin publicar» sin haber
 * tocado nada.
 */
export function claveDiseno(diseno: DisenoCarta): string {
  return JSON.stringify({
    p: diseno.plantilla,
    f: diseno.formato,
    c: normalizarHex(diseno.marca?.color) ?? null,
    t: diseno.marca?.fuente_titulos ?? null,
    b: diseno.marca?.borde ?? null,
    a: diseno.opciones?.mostrar_agotados === true,
  });
}

/** «ZONA BURGER» → «ZB»; «Raíz» → «RA». Para cuando el negocio no tiene logo. */
export function inicialesNegocio(nombre: string | null | undefined): string {
  const palabras = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
  if (palabras.length === 0) return '';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0][0] + palabras[1][0]).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Color
// ─────────────────────────────────────────────────────────────────────────────

/** `#abc`, `abc123` o `#ABC123` → `#ABC123`. Cualquier otra cosa → `null`. */
export function normalizarHex(valor: string | null | undefined): string | null {
  const texto = String(valor ?? '').trim().replace(/^#/, '');
  const completo = texto.length === 3 ? texto.split('').map((c) => c + c).join('') : texto;
  return /^[0-9a-fA-F]{6}$/.test(completo) ? `#${completo.toUpperCase()}` : null;
}

function aRgb(hex: string): [number, number, number] {
  const limpio = normalizarHex(hex) ?? '#000000';
  return [1, 3, 5].map((i) => parseInt(limpio.slice(i, i + 2), 16)) as [number, number, number];
}

function aHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Mezcla dos colores como `color-mix(in srgb, a peso, b)`.
 *
 * Se calcula aquí y no en CSS porque hace falta el resultado para medir su contraste: una
 * expresión `color-mix` en una variable no se puede comprobar antes de pintarla.
 */
export function mezclar(a: string, b: string, pesoA: number): string {
  const [ra, ga, ba] = aRgb(a);
  const [rb, gb, bb] = aRgb(b);
  const p = Math.min(1, Math.max(0, pesoA));
  return aHex([ra * p + rb * (1 - p), ga * p + gb * (1 - p), ba * p + bb * (1 - p)]);
}

function luminancia(hex: string): number {
  const canal = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = aRgb(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Relación de contraste WCAG entre dos colores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Blanco o casi negro, el que se lea mejor sobre `fondo`. */
export function textoSobre(fondo: string): '#FFFFFF' | '#111111' {
  return contraste(fondo, '#FFFFFF') >= contraste(fondo, '#111111') ? '#FFFFFF' : '#111111';
}

/**
 * El tono más parecido a `color` que alcance `minimo` de contraste sobre `fondo`.
 *
 * Se oscurece sobre fondos claros y se aclara sobre oscuros, en pasos pequeños, para
 * proponer algo que siga pareciendo el color que eligió el negocio y no un gris cualquiera.
 */
export function ajustarContraste(color: string, fondo: string, minimo = 3): string {
  const base = normalizarHex(color) ?? '#000000';
  if (contraste(base, fondo) >= minimo) return base;

  const destino = luminancia(fondo) > 0.4 ? '#000000' : '#FFFFFF';
  for (let paso = 1; paso <= 20; paso += 1) {
    const candidato = mezclar(base, destino, 1 - paso * 0.05);
    if (contraste(candidato, fondo) >= minimo) return candidato;
  }
  return destino;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El color de acento que se va a pintar.
 *
 * Orden de preferencia: el que eligió el negocio para la carta, el color de su marca si la
 * plantilla lo admite, y el propio de la plantilla.
 */
export function acentoEfectivo(
  plantilla: PlantillaDef,
  marca: MarcaCarta | null | undefined,
  colorNegocio: string | null | undefined,
): string {
  const elegido = normalizarHex(marca?.color);
  if (elegido) return elegido;
  const delNegocio = normalizarHex(colorNegocio);
  if (plantilla.usaColorNegocio && delNegocio) return delNegocio;
  return plantilla.paleta.accent;
}

/**
 * Los tokens `--carta-*` de un diseño, listos para el `[style]` del componente.
 *
 * Además de copiar la paleta, resuelve lo que no se le pide al negocio: el color del texto
 * sobre el acento, el tono de reposo del botón y el color del precio. El precio es texto, así
 * que si el acento no llega a 4.5:1 sobre la tarjeta se pinta con el color del texto: el
 * negocio conserva su color en botones y categorías, y el cliente sigue leyendo cuánto cuesta.
 */
export function resolverTokens(
  diseno: DisenoCarta,
  colorNegocio: string | null | undefined,
): Record<string, string> {
  const plantilla = plantillaPorId(diseno.plantilla);
  const p = plantilla.paleta;
  const acento = acentoEfectivo(plantilla, diseno.marca, colorNegocio);

  let precio = acento;
  if (plantilla.precio === 'tinta') precio = p.ink;
  if (plantilla.precio === 'mezcla-exito') precio = mezclar(acento, '#2E7D32', 0.4);
  if (contraste(precio, p.surface) < 4.5) precio = p.ink;

  const titulos = fuentePorId(diseno.marca?.fuente_titulos ?? plantilla.fuenteTitulos);
  const cuerpo = fuentePorId(plantilla.fuenteCuerpo);
  const borde = bordePorId(diseno.marca?.borde ?? plantilla.borde);

  return {
    '--carta-bg': p.bg,
    '--carta-surface': p.surface,
    '--carta-surface-2': p.surface2,
    '--carta-ink': p.ink,
    '--carta-muted': p.muted,
    '--carta-border': p.border,
    '--carta-accent': acento,
    '--carta-on-accent': textoSobre(acento),
    '--carta-accent-hover': mezclar(acento, plantilla.oscura ? '#FFFFFF' : '#000000', 0.85),
    '--carta-price': precio,
    '--carta-font-titulos': titulos.stack,
    '--carta-font-cuerpo': cuerpo.stack,
    '--carta-peso-titulos': String(titulos.pesoTitulos),
    '--carta-radio-sm': borde.radios.sm,
    '--carta-radio-md': borde.radios.md,
    '--carta-radio-lg': borde.radios.lg,
    '--carta-radio-chip': borde.radios.chip,
    '--carta-caso-titulos': plantilla.mayusculasTitulos ? 'uppercase' : 'none',
    '--carta-caso-productos': plantilla.mayusculasProductos ? 'uppercase' : 'none',
    '--carta-track-titulos': plantilla.espaciadoTitulos,
    '--carta-foto-producto': plantilla.fotoProducto,
    '--carta-sombra': plantilla.sombra ? '0 8px 24px rgba(0, 0, 0, 0.12)' : 'none',
    '--carta-sombra-sm': plantilla.sombra ? '0 1px 3px rgba(0, 0, 0, 0.08)' : 'none',
    '--carta-borde-ancho': plantilla.bordeTarjeta ? '1px' : '0px',
  };
}

/** Las fuentes que hay que descargar para pintar un diseño (títulos y cuerpo). */
export function fuentesARequerir(diseno: DisenoCarta): FuenteDef[] {
  const plantilla = plantillaPorId(diseno.plantilla);
  const ids = new Set<FuenteId>([
    diseno.marca?.fuente_titulos ?? plantilla.fuenteTitulos,
    plantilla.fuenteCuerpo,
  ]);
  return [...ids].map((id) => fuentePorId(id)).filter((f) => f.google !== null);
}

/** Una sola hoja de Google Fonts para todas; `null` si no hay nada que descargar. */
export function urlGoogleFonts(fuentes: readonly FuenteDef[]): string | null {
  const familias = fuentes.map((f) => f.google).filter((g): g is string => Boolean(g));
  if (familias.length === 0) return null;
  const parametros = [...new Set(familias)].map((g) => `family=${g}`).join('&');
  return `https://fonts.googleapis.com/css2?${parametros}&display=swap`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Avisos
// ─────────────────────────────────────────────────────────────────────────────

export interface AccionAviso {
  tipo: 'ir-menu' | 'ir-general' | 'usar-color';
  texto: string;
  valor?: string;
}

export interface Aviso {
  id: string;
  /** `atencion`: la carta va a verse incompleta. `info`: conviene saberlo. Ninguno bloquea. */
  nivel: 'info' | 'atencion';
  titulo: string;
  detalle: string;
  accion?: AccionAviso;
}

export interface ContextoAvisos {
  diseno: DisenoCarta;
  colorNegocio: string | null;
  estadisticas: EstadisticasCarta;
  tieneLogo: boolean;
  tieneWhatsapp: boolean;
  planIncluyeWhatsapp: boolean;
}

const IR_MENU_FOTOS: AccionAviso = { tipo: 'ir-menu', texto: 'Subir fotos en Menú' };

/**
 * Lo que el administrador debería saber antes de publicar este diseño con su carta real.
 *
 * Los avisos informan, no bloquean: una carta sin fotos de categoría se puede publicar, pero
 * quien la elige tiene que saber que la cabecera de cada categoría se verá solo con texto.
 * Cada aviso habla del contenido real del negocio («3 de 12 categorías»), no en abstracto.
 */
export function evaluarAvisos(ctx: ContextoAvisos): Aviso[] {
  const avisos: Aviso[] = [];
  const plantilla = plantillaPorId(ctx.diseno.plantilla);
  const formato = ctx.diseno.formato;
  const e = ctx.estadisticas;
  const nombreFormato = FORMATOS.find((f) => f.id === formato)?.nombre ?? formato;

  if (e.productos === 0) {
    avisos.push({
      id: 'sin-productos',
      nivel: 'atencion',
      titulo: 'Tu carta todavía no tiene productos visibles',
      detalle: 'Crea productos en Menú y márcalos como visibles para que tus clientes los vean.',
      accion: { tipo: 'ir-menu', texto: 'Ir a Menú' },
    });
  }

  // ── Fotos de producto: mandan en Tarjetas ──
  if (formato === 'cards' && e.productos > 0) {
    const sinFoto = e.productos - e.productos_con_imagen;
    if (sinFoto > 0 && plantilla.fotosProducto === 'necesarias') {
      avisos.push({
        id: 'fotos-producto-necesarias',
        nivel: 'atencion',
        titulo: `${sinFoto} de ${e.productos} productos no tienen foto`,
        detalle:
          `${plantilla.nombre} está pensada para que la foto sea la protagonista. Los productos ` +
          'sin foto se verán con su ícono sobre un fondo de color y la carta puede lucir incompleta.',
        accion: IR_MENU_FOTOS,
      });
    } else if (e.productos_con_imagen === 0) {
      avisos.push({
        id: 'sin-fotos-producto',
        nivel: 'atencion',
        titulo: 'Ningún producto tiene foto',
        detalle:
          'En formato Tarjetas cada producto se muestra con su foto; sin ninguna verás solo los ' +
          'íconos. Si no piensas subir fotos, el formato Lista se ve mejor.',
        accion: IR_MENU_FOTOS,
      });
    } else if (sinFoto > 0) {
      avisos.push({
        id: 'fotos-producto-parcial',
        nivel: 'info',
        titulo: `${sinFoto} de ${e.productos} productos no tienen foto`,
        detalle: 'Se mostrarán con su ícono en el lugar de la foto.',
        accion: IR_MENU_FOTOS,
      });
    }
  }

  // ── Destacados: mandan en Mixto ──
  if (formato === 'mixto' && e.productos > 0) {
    if (e.productos_destacados === 0) {
      avisos.push({
        id: 'sin-destacados',
        nivel: 'atencion',
        titulo: 'No tienes productos marcados como populares',
        detalle:
          'En formato Mixto los productos populares van arriba en tarjetas grandes. Sin ninguno, ' +
          'la carta se verá igual que en formato Lista.',
        accion: { tipo: 'ir-menu', texto: 'Marcar populares en Menú' },
      });
    } else if (e.destacados_con_imagen < e.productos_destacados) {
      const sinFoto = e.productos_destacados - e.destacados_con_imagen;
      avisos.push({
        id: 'destacados-sin-foto',
        nivel: 'info',
        titulo: `${sinFoto} de tus ${e.productos_destacados} productos populares no tienen foto`,
        detalle: 'Los populares se muestran en tarjeta grande; sin foto se verán con su ícono.',
        accion: IR_MENU_FOTOS,
      });
    }
  }

  // ── Fotos de categoría: mandan en Lista y Mixto ──
  if ((formato === 'lista' || formato === 'mixto') && e.categorias > 0) {
    const sinFoto = e.categorias - e.categorias_con_imagen;
    if (e.categorias_con_imagen === 0) {
      avisos.push({
        id: 'sin-fotos-categoria',
        nivel: 'atencion',
        titulo: 'Ninguna categoría tiene foto',
        detalle:
          `En formato ${nombreFormato} cada categoría abre con su foto de cabecera. Sin fotos, ` +
          'la carta quedará incompleta: cada categoría se verá solo con su nombre y su ícono. ' +
          'Si prefieres no subirlas, Papel, Gaceta y Mostrador lucen bien sin fotos.',
        accion: { tipo: 'ir-menu', texto: 'Subir fotos de categorías' },
      });
    } else if (sinFoto > 0) {
      avisos.push({
        id: 'fotos-categoria-parcial',
        nivel: 'info',
        titulo: `${sinFoto} de ${e.categorias} categorías no tienen foto`,
        detalle: 'Esas categorías abrirán solo con su nombre, sin imagen de cabecera.',
        accion: { tipo: 'ir-menu', texto: 'Subir fotos de categorías' },
      });
    }
  }

  // ── Plantilla frente a formato y contenido ──
  if ((plantilla.id === 'papel' || plantilla.id === 'gaceta') && formato === 'cards') {
    avisos.push({
      id: 'plantilla-texto-en-tarjetas',
      nivel: 'info',
      titulo: `${plantilla.nombre} luce mejor en formato Lista`,
      detalle: 'Es una plantilla de texto: en tarjetas pierde el aire de carta impresa.',
    });
  }
  if (plantilla.id === 'vitrina' && formato === 'lista') {
    avisos.push({
      id: 'vitrina-en-lista',
      nivel: 'info',
      titulo: 'Vitrina luce mejor en Tarjetas o Mixto',
      detalle: 'Sus fotos cuadradas solo aparecen en tarjetas; en Lista se pierde lo que la distingue.',
    });
  }
  if (plantilla.id === 'mostrador' && e.productos > 0 && e.productos < 15) {
    avisos.push({
      id: 'mostrador-pocos-productos',
      nivel: 'info',
      titulo: 'Mostrador está pensada para cartas largas',
      detalle:
        `Con ${e.productos} productos puede verse vacía. Esencial o Vitrina lucen mejor con ` +
        'pocos productos.',
    });
  }
  if (
    plantilla.oscura &&
    formato !== 'lista' &&
    e.productos > 0 &&
    e.productos_con_imagen / e.productos < 0.5
  ) {
    avisos.push({
      id: 'oscura-pocas-fotos',
      nivel: 'info',
      titulo: `${plantilla.nombre} depende de buenas fotos`,
      detalle:
        'Sobre fondo oscuro los productos sin foto se ven apagados. Revisa la vista previa antes ' +
        'de publicar.',
    });
  }

  // ── Color ──
  const acento = acentoEfectivo(plantilla, ctx.diseno.marca, ctx.colorNegocio);
  const relacion = Math.min(
    contraste(acento, plantilla.paleta.surface),
    contraste(acento, plantilla.paleta.bg),
  );
  if (relacion < 3) {
    const sugerido = ajustarContraste(acento, plantilla.paleta.surface, 3);
    avisos.push({
      id: 'contraste-bajo',
      nivel: 'atencion',
      titulo: 'El color casi no se distingue sobre esta plantilla',
      detalle:
        `El contraste es de ${relacion.toFixed(1)}:1, así que los botones y la categoría activa ` +
        'se verán poco. Los precios se pintan con el color del texto para que sigan leyéndose.',
      accion: { tipo: 'usar-color', texto: `Usar ${sugerido}`, valor: sugerido },
    });
  }

  // ── Marca y pedidos ──
  if (!ctx.tieneLogo) {
    avisos.push({
      id: 'sin-logo',
      nivel: 'info',
      titulo: 'Tu carta no tiene logo',
      detalle: 'Mientras tanto se muestran las iniciales de tu negocio. Puedes subirlo aquí mismo.',
    });
  }
  if (!ctx.tieneWhatsapp) {
    avisos.push({
      id: 'sin-whatsapp',
      nivel: 'info',
      titulo: 'La carta no mostrará el botón de pedido',
      detalle:
        'Agrega el enlace de WhatsApp en la pestaña General para que tus clientes puedan pedir ' +
        'desde la carta.',
      accion: { tipo: 'ir-general', texto: 'Ir a General' },
    });
  } else if (!ctx.planIncluyeWhatsapp) {
    avisos.push({
      id: 'plan-sin-whatsapp',
      nivel: 'info',
      titulo: 'Tu plan no incluye pedidos por WhatsApp',
      detalle: 'La carta se mostrará solo para consulta, sin botón de pedido.',
    });
  }

  // Primero lo que deja la carta incompleta; después lo informativo.
  return avisos.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'atencion' ? -1 : 1));
}
