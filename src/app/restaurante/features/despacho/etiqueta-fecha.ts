import { formatDate } from '@angular/common';

const MS_POR_DIA = 86_400_000;

/**
 * La fecha de un pedido, en la forma más corta que no confunde.
 *
 * Despacho enseñaba solo la hora («8:02 p. m.»), y un pedido que se quedó de ayer —o de hace una
 * semana— se leía como si fuera de hoy. Ahora la hora se acompaña de cuándo fue:
 *
 *   hoy               → «8:02 p. m.»
 *   ayer              → «ayer 8:02 p. m.»
 *   dos días o más    → «03 abr»   (solo la fecha: la hora ya no ayuda a nadie)
 *
 * «Ayer» y «hoy» son días de calendario del equipo, no ventanas de 24 horas: un pedido de las 11 p. m.
 * visto a las 8 a. m. es «ayer», aunque hayan pasado nueve horas.
 *
 * `ahora` se recibe para poder probarlo; en la pantalla se usa el reloj.
 */
export function etiquetaFecha(
  valor: string | number | Date | null | undefined,
  locale: string,
  ahora: Date = new Date(),
): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '';

  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);
  const inicioDia = new Date(fecha);
  inicioDia.setHours(0, 0, 0, 0);

  // `round` y no `floor`: el cambio de hora puede dejar un día de 23 o 25 horas.
  const dias = Math.round((inicioHoy.getTime() - inicioDia.getTime()) / MS_POR_DIA);

  // Un pedido «del futuro» (reloj del equipo atrasado) se trata como de hoy.
  if (dias <= 0) return formatDate(fecha, 'shortTime', locale);
  if (dias === 1) return `ayer ${formatDate(fecha, 'shortTime', locale)}`;
  return formatDate(fecha, 'dd MMM', locale);
}
