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

export type PlantillaId = 'esencial' | 'neon' | 'gaceta' | 'mural' | 'retro';

export type FormatoId = 'cards' | 'lista';

export type FuenteId =
  | 'sistema'
  | 'inter'
  | 'poppins'
  | 'lora'
  | 'archivo-narrow'
  | 'dm-serif-display'
  | 'urban-black';

export type BordeId = 'recto' | 'suave' | 'redondo';

/**
 * Cómo se ARMA la carta, que es distinto de cómo se pinta.
 *
 * Los colores y las tipografías cambian el aspecto; esto cambia la estructura. Es lo que separa
 * una carta de otra de verdad: dos plantillas con la misma composición y distinto color son la
 * misma carta pintada de otro color.
 *
 *  - `estandar`: una columna, con el formato que elija el negocio (tarjetas o lista).
 *  - `mural`:    dos columnas de texto sobre fondo oscuro, con el nombre de la categoría en un
 *                bloque de color. La carta de hamburguesería pegada en la pared.
 *  - `retro`:    dos columnas dentro de paneles redondeados, títulos centrados y grandes, precios
 *                cortos a la derecha. La carta impresa de toda la vida.
 *
 * Las dos últimas mandan sobre el formato: en una carta a dos columnas, «tarjetas con foto» no
 * significa nada. Por eso `formatoEfectivo` las fuerza a lista y el editor lo dice.
 */
export type ComposicionId = 'estandar' | 'mural' | 'retro';

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
  /**
   * Fuente servida por nosotros (`public/fonts/`), no por Google. Su `@font-face` está en
   * `styles.scss`. Si el archivo no está, la pila de respaldo mantiene la carta legible: una
   * tipografía que falta nunca puede dejar un menú sin leerse.
   */
  propia?: boolean;
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
  {
    id: 'urban-black',
    nombre: 'Urban Black',
    // Pila pensada para que la carta no se desarme si el archivo no está: primero la fuente
    // propia, después dos pesadas que sí están en casi cualquier equipo, y al final la condensada
    // del sistema. Todas comparten el aire compacto y rotundo del titular.
    stack: "'Urban Black', 'Archivo Black', 'Arial Black', 'Archivo Narrow', 'Arial Narrow', sans-serif",
    google: null,
    propia: true,
    pesoTitulos: 400, // ya es negra de por sí: pedirle 700 encima la emborrona
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
  /** Cómo se arma la carta. `estandar` respeta el formato elegido; las otras mandan sobre él. */
  composicion: ComposicionId;
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
    composicion: 'estandar',
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
    // Urban Black es la que le da el aire de rótulo pintado. Ver FUENTES: es propia, no de
    // Google, y su pila de respaldo aguanta si el archivo no llega.
    fuenteTitulos: 'urban-black',
    fuenteCuerpo: 'inter',
    borde: 'recto',
    mayusculasTitulos: true,
    mayusculasProductos: true,
    espaciadoTitulos: '0.04em',
    fotoProducto: '16 / 9',
    composicion: 'estandar',
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
    composicion: 'estandar',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: false,
    precioConPuntos: true,
    precio: 'tinta',
    sombra: false,
    bordeTarjeta: true,
  },
  {
    id: 'mural',
    nombre: 'Mural',
    estilo: 'Cartel de pared',
    descripcion:
      'Dos columnas de texto sobre fondo oscuro y el nombre de la categoría en un bloque de color. ' +
      'Sin fotos: manda la tipografía.',
    ideal: 'hamburgueserías, alitas, food trucks y cartas que se leen de lejos',
    oscura: true,
    usaColorNegocio: true,
    paleta: {
      bg: '#17161A',
      surface: '#1F1E23',
      surface2: '#27262C',
      ink: '#F7F4EE',
      muted: '#A29C93',
      border: '#332F37',
      accent: '#E8521F',
    },
    fuenteTitulos: 'urban-black',
    fuenteCuerpo: 'inter',
    borde: 'recto',
    mayusculasTitulos: true,
    mayusculasProductos: true,
    espaciadoTitulos: '0.02em',
    fotoProducto: '16 / 9',
    composicion: 'mural',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'acento',
    sombra: false,
    bordeTarjeta: false,
  },
  {
    id: 'retro',
    nombre: 'Retro',
    estilo: 'Carta impresa',
    descripcion:
      'Paneles redondeados a dos columnas sobre papel crema, con los títulos centrados y grandes. ' +
      'Entra mucha carta en poco espacio.',
    ideal: 'pollo, comida rápida y cartas largas que se entregan en la mesa',
    oscura: false,
    usaColorNegocio: true,
    paleta: {
      bg: '#F6F0DC',
      surface: '#FCF8EC',
      surface2: '#EFE7CB',
      ink: '#1C5D44',
      muted: '#5F7D6C',
      border: '#D8CFAE',
      accent: '#1B7A52',
    },
    fuenteTitulos: 'poppins',
    fuenteCuerpo: 'inter',
    borde: 'redondo',
    mayusculasTitulos: true,
    mayusculasProductos: true,
    espaciadoTitulos: '0.01em',
    fotoProducto: '1 / 1',
    composicion: 'retro',
    formatoSugerido: 'lista',
    fotosProducto: 'opcionales',
    miniaturaEnLista: false,
    precioConPuntos: false,
    precio: 'acento',
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

/**
 * A dónde va a parar una carta publicada con una plantilla que ya no existe.
 *
 * Retirar una plantilla no puede cambiarle la carta a un negocio de un día para otro sin
 * avisar; sí puede llevarlo a la más parecida de las que quedan. Sin este mapa, todas caerían
 * en «Esencial» y un bar oscuro amanecería con la carta blanca.
 */
const PLANTILLAS_RETIRADAS: Readonly<Record<string, PlantillaId>> = Object.freeze({
  medianoche: 'neon',   // las dos son oscuras
  papel: 'gaceta',      // las dos son de texto sobre claro
  vitrina: 'esencial',  // las dos son tarjetas con foto
  mostrador: 'retro',   // las dos son listas densas de carta larga
});

export function plantillaPorId(id: string | null | undefined): PlantillaDef {
  const viva = PLANTILLAS.find((p) => p.id === id);
  if (viva) return viva;

  const heredera = PLANTILLAS_RETIRADAS[String(id ?? '')];
  return PLANTILLAS.find((p) => p.id === heredera) ?? PLANTILLAS[0];
}

/**
 * El formato que de verdad se pinta.
 *
 * Dos cosas lo pueden cambiar: una plantilla con composición propia (a dos columnas, «tarjetas
 * con foto» no significa nada) y el formato «mixto», que existió hasta 2026-09-23 y se lee como
 * tarjetas en las cartas ya publicadas con él.
 */
export function formatoEfectivo(
  diseno: DisenoCarta | null | undefined,
  plantilla?: PlantillaDef,
): FormatoId {
  const p = plantilla ?? plantillaPorId(diseno?.plantilla);
  if (p.composicion !== 'estandar') return 'lista';
  return diseno?.formato === 'lista' ? 'lista' : 'cards';
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

/**
 * Brillo percibido de un color, de 0 (negro) a 255 (blanco).
 *
 * No es la luminancia de WCAG: esta fórmula (la clásica YIQ) pesa el verde mucho y el azul
 * casi nada, que es como el ojo ve de verdad un color plano. Es la que usan casi todos los
 * sistemas de diseño para decidir si una etiqueta lleva letra blanca o negra.
 */
function brilloPercibido(hex: string): number {
  const [r, g, b] = aRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/**
 * Blanco o casi negro, el que corresponde encima de `fondo`.
 *
 * La regla es el brillo percibido y no el contraste máximo de WCAG, y la diferencia importa
 * justo en los colores que más elige la gente: sobre un rojo puro, WCAG prefiere el negro por
 * unas décimas (5.2:1 contra 4.0:1), pero un rojo con letra negra se ve sucio y nadie lo hace
 * así. Con el brillo percibido, el rojo lleva letra blanca y los tonos cálidos y claros
 * —amarillo, lima, ámbar, naranja— la llevan negra, que es lo que se espera al verlos.
 *
 * El contraste no se abandona: es el desempate. Si la letra que pide el brillo no llega a 3:1
 * y la otra sí, gana la otra — primero se tiene que poder leer.
 */
export function textoSobre(fondo: string): '#FFFFFF' | '#111111' {
  const preferido = brilloPercibido(fondo) >= 150 ? '#111111' : '#FFFFFF';
  const alternativo = preferido === '#FFFFFF' ? '#111111' : '#FFFFFF';

  if (contraste(fondo, preferido) >= 3) return preferido;
  return contraste(fondo, alternativo) > contraste(fondo, preferido) ? alternativo : preferido;
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

  /*
   * El acento cuando hace de TEXTO y no de fondo.
   *
   * Son dos trabajos distintos y necesitan dos valores. De fondo, el acento se pinta tal cual
   * —es el color del negocio, con su letra blanca o negra encima—; pero de texto sobre el
   * fondo de la carta, ese mismo color puede no leerse: un rojo encendido sobre negro, o un
   * amarillo sobre blanco, son tres palabras que nadie descifra.
   *
   * Se ajusta contra el fondo más difícil de los dos (la página y las tarjetas), y se mueve lo
   * justo: se oscurece sobre claro y se aclara sobre oscuro hasta llegar a 4.5:1, así que sigue
   * siendo reconociblemente el color que el negocio eligió.
   */
  const fondoMasDuro = contraste(acento, p.surface) <= contraste(acento, p.bg) ? p.surface : p.bg;
  const acentoTexto = ajustarContraste(acento, fondoMasDuro, 4.5);

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
    '--carta-accent-text': acentoTexto,
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
  // El que se va a PINTAR, no el que está guardado: en Mural y Retro la plantilla manda sobre el
  // formato, y avisar de fotos de tarjeta en una carta que va a salir a dos columnas es mentir.
  const formato = formatoEfectivo(ctx.diseno, plantilla);
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

  // ── Fotos de categoría: mandan en Lista ──
  // Las composiciones a dos columnas no las usan: ahí la categoría es un titular, no una foto.
  if (formato === 'lista' && plantilla.composicion === 'estandar' && e.categorias > 0) {
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
  if (plantilla.id === 'gaceta' && formato === 'cards') {
    avisos.push({
      id: 'plantilla-texto-en-tarjetas',
      nivel: 'info',
      titulo: `${plantilla.nombre} luce mejor en formato Lista`,
      detalle: 'Es una plantilla de texto: en tarjetas pierde el aire de carta impresa.',
    });
  }
  // Las de composición propia ignoran el formato. Más vale decirlo que dejar al negocio
  // cambiando un selector que no hace nada.
  if (plantilla.composicion !== 'estandar' && ctx.diseno.formato === 'cards') {
    avisos.push({
      id: 'composicion-manda',
      nivel: 'info',
      titulo: `${plantilla.nombre} se arma siempre a dos columnas`,
      detalle:
        'Es una carta de texto, como las impresas: el formato de tarjetas no aplica aquí. Tus ' +
        'fotos de producto no se pierden — vuelven en cuanto elijas otra plantilla.',
    });
  }
  if (plantilla.composicion !== 'estandar' && e.productos > 0 && e.productos < 8) {
    avisos.push({
      id: 'composicion-pocos-productos',
      nivel: 'info',
      titulo: `${plantilla.nombre} está pensada para cartas largas`,
      detalle:
        `Con ${e.productos} productos las dos columnas se ven vacías. Esencial luce mejor con ` +
        'cartas cortas.',
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
