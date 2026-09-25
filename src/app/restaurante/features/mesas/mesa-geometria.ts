/**
 * Cómo se dibuja una mesa vista desde arriba: su forma según los puestos, dónde va cada silla
 * y cuánto lleva ocupada. Todo puro, sin Angular, para poder probarlo sin montar la tarjeta.
 */

export type FormaMesa = 'redonda' | 'cuadrada' | 'rectangular';

/** Una silla, con su posición en % dentro de la mesa y el giro para que mire hacia ella. */
export interface Silla {
  x: number;
  y: number;
  giro: number;
}

/** Pasado este tiempo una mesa ocupada se marca en alerta. */
export const ALERTA_MINUTOS = 45;

/** Más sillas que esto no caben en una tarjeta; el número real sigue diciéndolo el texto. */
export const MAX_SILLAS_DIBUJADAS = 12;

/** 1–2 puestos: redonda · 3–4: cuadrada de bordes redondeados · 5 o más: rectangular. */
export function formaDeMesa(capacidad: number): FormaMesa {
  const n = puestos(capacidad);
  if (n <= 2) return 'redonda';
  if (n <= 4) return 'cuadrada';
  return 'rectangular';
}

/** La capacidad viene de la base y puede faltar: nunca dibujamos menos de una silla. */
export function puestos(capacidad: number | null | undefined): number {
  const n = Math.floor(Number(capacidad));
  return Number.isFinite(n) && n >= 1 ? n : 4;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

export function sillasDeMesa(capacidad: number): Silla[] {
  const n = Math.min(puestos(capacidad), MAX_SILLAS_DIBUJADAS);
  const forma = formaDeMesa(capacidad);

  if (forma === 'rectangular') {
    // Mitad arriba, mitad abajo: así se sientan en una mesa larga.
    const arriba = Math.ceil(n / 2);
    const abajo = n - arriba;
    const fila = (cuantas: number, y: number, giro: number): Silla[] =>
      Array.from({ length: cuantas }, (_, i) => ({
        x: redondear(((i + 1) / (cuantas + 1)) * 100),
        y,
        giro,
      }));
    return [...fila(arriba, 0, 0), ...fila(abajo, 100, 180)];
  }

  if (forma === 'cuadrada') {
    if (n === 3) {
      return [
        { x: 50, y: 0, giro: 0 },
        { x: 28, y: 100, giro: 180 },
        { x: 72, y: 100, giro: 180 },
      ];
    }
    return [
      { x: 50, y: 0, giro: 0 },
      { x: 100, y: 50, giro: 90 },
      { x: 50, y: 100, giro: 180 },
      { x: 0, y: 50, giro: 270 },
    ];
  }

  // Redonda: repartidas a partes iguales por la circunferencia, empezando por arriba.
  return Array.from({ length: n }, (_, i) => {
    const angulo = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      x: redondear(50 + 50 * Math.cos(angulo)),
      y: redondear(50 + 50 * Math.sin(angulo)),
      giro: redondear((angulo * 180) / Math.PI + 90),
    };
  });
}

/**
 * Minutos que lleva la mesa, leídos del texto que manda el servidor
 * (`formatElapsedMinutes`: «12 min» o «46h 53m»). `null` si no hay tiempo que leer.
 */
export function minutosDeEtiqueta(etiqueta: string | null | undefined): number | null {
  const texto = (etiqueta ?? '').trim();
  const horas = /^(\d+)h\s*(\d+)m$/.exec(texto);
  if (horas) return Number(horas[1]) * 60 + Number(horas[2]);
  const minutos = /^(\d+)\s*min$/.exec(texto);
  return minutos ? Number(minutos[1]) : null;
}

export function superaAlerta(minutos: number | null): boolean {
  return minutos !== null && minutos >= ALERTA_MINUTOS;
}
