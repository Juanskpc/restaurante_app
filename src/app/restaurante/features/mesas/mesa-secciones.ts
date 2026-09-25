/**
 * Las secciones del salón («Piso 1», «Patio», «Terraza»…): texto libre que pone el administrador en
 * cada mesa. Aquí solo se decide cómo se AGRUPAN para pintarlas; nada de esto toca el servidor.
 */

export interface GrupoMesas<T> {
  /** Clave estable para el `track` de la plantilla. */
  clave: string;
  /** Lo que se escribe como título, o `null` si el salón no está dividido (no hay título). */
  titulo: string | null;
  mesas: T[];
}

const SIN_SECCION = 'Sin sección';

/** «  piso   1 » → «piso 1»: dos mesas escritas con un espacio de más son la misma sección. */
export function normalizarSeccion(valor: string | null | undefined): string {
  return String(valor ?? '').replace(/\s+/g, ' ').trim();
}

/** El orden natural: «Piso 2» antes que «Piso 10», sin distinguir mayúsculas ni tildes. */
function comparar(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

/**
 * Las secciones que ya existen, sin repetir y en orden. Alimenta la sugerencia del formulario
 * (escribir «Patio» dos veces no debe crear dos secciones «Patio» y «patio»: se sugiere la primera
 * escritura y se agrupa sin distinguir mayúsculas).
 */
export function seccionesExistentes(mesas: Array<{ seccion?: string | null }>): string[] {
  const vistas = new Map<string, string>();
  for (const m of mesas) {
    const nombre = normalizarSeccion(m.seccion);
    if (!nombre) continue;
    const clave = nombre.toLocaleLowerCase('es');
    if (!vistas.has(clave)) vistas.set(clave, nombre);
  }
  return [...vistas.values()].sort(comparar);
}

/**
 * Agrupa las mesas por sección, conservando el orden en que llegan dentro de cada grupo.
 *
 * - Si NINGUNA mesa tiene sección, devuelve un solo grupo sin título: el salón se ve como siempre.
 * - Si alguna la tiene, cada sección es un grupo con título, en orden natural, y las que no tienen
 *   quedan al final bajo «Sin sección».
 */
export function agruparPorSeccion<T extends { seccion?: string | null }>(mesas: T[]): GrupoMesas<T>[] {
  const hayAlguna = mesas.some((m) => normalizarSeccion(m.seccion) !== '');
  if (!hayAlguna) {
    return mesas.length > 0 ? [{ clave: '__todas__', titulo: null, mesas }] : [];
  }

  const porClave = new Map<string, GrupoMesas<T>>();
  const nombres = new Map<string, string>();
  for (const nombre of seccionesExistentes(mesas)) nombres.set(nombre.toLocaleLowerCase('es'), nombre);

  for (const mesa of mesas) {
    const nombre = normalizarSeccion(mesa.seccion);
    const clave = nombre ? nombre.toLocaleLowerCase('es') : '__sin__';
    let grupo = porClave.get(clave);
    if (!grupo) {
      grupo = { clave, titulo: nombre ? (nombres.get(clave) ?? nombre) : SIN_SECCION, mesas: [] };
      porClave.set(clave, grupo);
    }
    grupo.mesas.push(mesa);
  }

  const grupos = [...porClave.values()];
  const conNombre = grupos.filter((g) => g.clave !== '__sin__').sort((a, b) => comparar(a.titulo!, b.titulo!));
  const sin = grupos.find((g) => g.clave === '__sin__');
  return sin ? [...conNombre, sin] : conNombre;
}
