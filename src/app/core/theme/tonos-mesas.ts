/**
 * Los tonos de los estados de una mesa (libre / ocupada / por cobrar) a partir del color del negocio.
 *
 * ## Qué se buscó
 *
 * Los estados tienen que seguir SIENDO lo que dicen —libre es azul (calma), ocupada es rojo-naranja,
 * por cobrar es dorado— y aun así sentirse «de la casa». La primera versión giraba el color de la marca
 * 120° y 240° para sacar los tres estados: con una marca ROJA (Zona Burger) «libre» heredaba el
 * rojo de la marca —un rojo que en un POS quiere decir error— y «ocupada» salía verde.
 *
 * ## Cómo
 *
 * Cada estado parte de su tono de siempre (`ANCLAS`) y se inclina un poco hacia el tono de la marca,
 * por el camino corto del círculo de colores (`INFLUENCIA_DE_LA_MARCA`). La intensidad (croma) sí es
 * la de la marca —una marca apagada da estados apagados—, dentro de un rango legible.
 *
 * Todo en OKLCH: es el espacio en que «mismo tono a distinta luminosidad» se comporta como se espera,
 * y por eso el CSS fija la luminosidad de fondo, borde y texto (contraste) y aquí solo se decide el
 * tono y la intensidad.
 */

/**
 * Los tonos de siempre de cada estado, en grados OKLCH.
 *
 * «Libre» es AZUL y no verde (2026-09-25, a pedido del dueño): con la marca roja de Zona Burger el
 * azul —que salió de girar el rojo 240° en la primera versión— se veía bien, y el verde no. Con una
 * marca roja, inclinado un 20 % hacia ella, queda en ≈ 270°: el mismo azul.
 */
export const ANCLAS = { libre: 240, ocupada: 28, cobro: 88 } as const;

/** Cuánto se inclina cada estado hacia el tono de la marca (0 = nada, 1 = igual a la marca). */
export const INFLUENCIA_DE_LA_MARCA = 0.2;

/** Rango de intensidad: por debajo el estado se ve gris, por encima chillón. */
export const CROMA = { min: 0.1, max: 0.17, porDefecto: 0.14 } as const;

export interface TonosMesas {
  /** Intensidad común a los tres estados. */
  croma: number;
  libre: number;
  ocupada: number;
  cobro: number;
}

export const TONOS_POR_DEFECTO: TonosMesas = {
  croma: CROMA.porDefecto,
  libre: ANCLAS.libre,
  ocupada: ANCLAS.ocupada,
  cobro: ANCLAS.cobro,
};

/** `#rgb` / `#rrggbb` → [r, g, b] en 0..1, o `null` si no es un color hexadecimal. */
function leerHex(valor: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(valor ?? '').trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

const aLineal = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Un color hexadecimal en OKLCH (Björn Ottosson). `null` si no se puede leer. */
export function hexAOklch(hex: string): { l: number; c: number; h: number } | null {
  const rgb = leerHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(aLineal);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: Math.hypot(a, bb), h: (h + 360) % 360 };
}

/** Inclina `ancla` hacia `marca` por el camino corto del círculo. Grados en 0..360. */
export function inclinarTono(ancla: number, marca: number, influencia = INFLUENCIA_DE_LA_MARCA): number {
  const delta = ((((marca - ancla) % 360) + 540) % 360) - 180; // -180..180
  return (((ancla + influencia * delta) % 360) + 360) % 360;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

/**
 * Los tonos de los tres estados para un color de marca. Si el color no se puede leer (o es casi
 * gris, sin tono que aportar) se devuelven los de siempre: nunca se inventa un tono a partir de nada.
 */
export function tonosDeMesas(colorMarca: string | null | undefined): TonosMesas {
  const marca = hexAOklch(colorMarca ?? '');
  if (!marca) return { ...TONOS_POR_DEFECTO };

  // Casi sin croma (negro, grafito, blanco) el «tono» es ruido numérico: la marca no aporta
  // dirección, así que los estados quedan como siempre y solo se apaga un poco la intensidad.
  const sinTono = marca.c < 0.02;
  const croma = Math.min(CROMA.max, Math.max(CROMA.min, marca.c));
  return {
    croma: redondear(sinTono ? CROMA.porDefecto : croma),
    libre: redondear(sinTono ? ANCLAS.libre : inclinarTono(ANCLAS.libre, marca.h)),
    ocupada: redondear(sinTono ? ANCLAS.ocupada : inclinarTono(ANCLAS.ocupada, marca.h)),
    cobro: redondear(sinTono ? ANCLAS.cobro : inclinarTono(ANCLAS.cobro, marca.h)),
  };
}
