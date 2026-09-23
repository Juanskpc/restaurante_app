import { WritableSignal } from '@angular/core';

/**
 * refresco-vivo — cómo se meten datos nuevos en una pantalla que el usuario está mirando.
 *
 * El tiempo real trae avisos cada pocos segundos, y hasta ahora cada aviso repintaba la vista
 * entera: la lista se reemplazaba por otra lista con los mismos datos pero objetos distintos, y
 * Angular tiraba las tarjetas y las volvía a construir. De ahí el parpadeo, aunque en la base de
 * datos no hubiera cambiado ni una coma.
 *
 * Aquí la regla es: **lo que no cambió, no se toca.**
 *
 *  - Si la respuesta es igual a lo que ya hay, no se escribe nada. Cero repintado.
 *  - Si cambió una fila de veinte, se conserva el objeto de las otras diecinueve. Angular las
 *    reconoce como las mismas (mismo objeto, mismo `track`) y solo redibuja la que cambió.
 *
 * Se compara por contenido y no por referencia porque cada respuesta HTTP trae objetos nuevos
 * recién salidos del JSON: por referencia, «igual» no existiría nunca.
 */

/** Igualdad por contenido, del tipo de datos que llega en un JSON. */
export function mismoContenido(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => mismoContenido(item, b[i]));
  }

  const ca = a as Record<string, unknown>;
  const cb = b as Record<string, unknown>;
  const clavesA = Object.keys(ca);
  if (clavesA.length !== Object.keys(cb).length) return false;
  return clavesA.every((k) => Object.prototype.hasOwnProperty.call(cb, k) && mismoContenido(ca[k], cb[k]));
}

/**
 * Mezcla la lista que llega con la que ya se está mostrando.
 *
 * Devuelve **la misma lista de antes** cuando nada cambió, para que al asignarla a la señal no
 * se dispare ni un repintado. Cuando sí cambió, devuelve una lista nueva en la que cada
 * elemento que no cambió es el objeto de antes, tal cual.
 *
 * @param clave qué identifica a un elemento entre dos consultas (su id).
 */
export function fusionarLista<T>(actual: readonly T[], nuevos: readonly T[], clave: (item: T) => unknown): T[] {
  const anteriores = new Map<unknown, T>();
  for (const item of actual) anteriores.set(clave(item), item);

  let hayCambios = actual.length !== nuevos.length;
  const resultado = nuevos.map((nuevo, i) => {
    const anterior = anteriores.get(clave(nuevo));
    if (anterior !== undefined && mismoContenido(anterior, nuevo)) {
      // El orden también cuenta: una fila idéntica que se movió de sitio sí es un cambio.
      if (actual[i] !== anterior) hayCambios = true;
      return anterior;
    }
    hayCambios = true;
    return nuevo;
  });

  return hayCambios ? resultado : (actual as T[]);
}

/** Escribe la lista solo si de verdad cambió algo. */
export function aplicarLista<T>(
  destino: WritableSignal<T[]>,
  nuevos: readonly T[] | null | undefined,
  clave: (item: T) => unknown,
): void {
  const fusionada = fusionarLista(destino(), nuevos ?? [], clave);
  if (fusionada !== destino()) destino.set(fusionada);
}

/** Lo mismo para un solo objeto (el turno de caja, un resumen): si es igual, no se escribe. */
export function aplicarValor<T>(destino: WritableSignal<T>, nuevo: T): void {
  if (!mismoContenido(destino(), nuevo)) destino.set(nuevo);
}
