import type { LucideIconData } from 'lucide-angular';

/**
 * «Mesa»: una mesa redonda vista desde arriba con cuatro sillas. Lucide no trae ninguna mesa de
 * comedor (el sofá y la campana no se entendían), y este dibujo es el mismo que ven en las
 * tarjetas de Mesas. Mismo trazo y cuadrícula que el resto, así que se pinta con `currentColor`.
 */
export const Mesa: LucideIconData = [
  ['circle', { cx: 12, cy: 12, r: 5.5 }],
  ['path', { d: 'M10 2.5h4' }],
  ['path', { d: 'M10 21.5h4' }],
  ['path', { d: 'M2.5 10v4' }],
  ['path', { d: 'M21.5 10v4' }],
];
