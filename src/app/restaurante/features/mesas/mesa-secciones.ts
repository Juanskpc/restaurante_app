/**
 * Las secciones del salón («Piso 1», «Patio», «Terraza»…): se CREAN una vez y las mesas se les
 * asignan (`rest_mesa_seccion` en el servidor). Aquí solo se decide cómo se AGRUPAN para pintarlas.
 */

export interface GrupoMesas<T> {
  /** Clave estable para el `track` de la plantilla. */
  clave: string;
  /** El título del grupo, o `null` si el salón no está dividido (no hay título que poner). */
  titulo: string | null;
  mesas: T[];
}

/** Lo que una mesa trae de su sección (el tablero lo manda junto a cada mesa). */
export interface ConSeccion {
  id_seccion?: number | null;
  seccion?: string | null;
  seccion_orden?: number | null;
}

/** Una sección tal como la lista el servidor (con o sin mesas). */
export interface SeccionBasica {
  id_seccion: number;
  nombre: string;
  orden: number;
}

const SIN_SECCION = 'Sin sección';
const SIN_ORDEN = Number.MAX_SAFE_INTEGER;

function comparar(a: string, b: string): number {
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
}

/**
 * Agrupa las mesas por sección, conservando el orden en que llegan dentro de cada grupo.
 *
 * - Si NO hay ninguna sección en uso (ni se pasan `secciones`), un solo grupo sin título: el salón
 *   se ve como siempre.
 * - Si no, un grupo por sección, en el orden que fijó el administrador (`orden`) y, a igual orden,
 *   por nombre. Las mesas sin sección quedan al final bajo «Sin sección».
 * - `secciones` (opcional) añade también las que NO tienen mesas todavía, para que una sección recién
 *   creada se vea aunque esté vacía. El tablero las pasa solo con el filtro «Todas»: con otro filtro
 *   una sección vacía sería ruido.
 */
export function agruparPorSeccion<T extends ConSeccion>(
  mesas: T[],
  secciones: SeccionBasica[] = [],
): GrupoMesas<T>[] {
  const hayAlguna = secciones.length > 0 || mesas.some((m) => m.id_seccion != null);
  if (!hayAlguna) {
    return mesas.length > 0 ? [{ clave: '__todas__', titulo: null, mesas }] : [];
  }

  const grupos = new Map<number, GrupoMesas<T> & { orden: number }>();
  for (const s of secciones) {
    grupos.set(s.id_seccion, { clave: `s${s.id_seccion}`, titulo: s.nombre, orden: s.orden, mesas: [] });
  }

  const sin: T[] = [];
  for (const mesa of mesas) {
    if (mesa.id_seccion == null) {
      sin.push(mesa);
      continue;
    }
    let grupo = grupos.get(mesa.id_seccion);
    if (!grupo) {
      grupo = {
        clave: `s${mesa.id_seccion}`,
        titulo: mesa.seccion ?? SIN_SECCION,
        orden: mesa.seccion_orden ?? SIN_ORDEN,
        mesas: [],
      };
      grupos.set(mesa.id_seccion, grupo);
    }
    grupo.mesas.push(mesa);
  }

  const ordenados = [...grupos.values()]
    .sort((a, b) => a.orden - b.orden || comparar(a.titulo ?? '', b.titulo ?? ''))
    .map(({ clave, titulo, mesas: ms }) => ({ clave, titulo, mesas: ms }));

  return sin.length > 0 ? [...ordenados, { clave: '__sin__', titulo: SIN_SECCION, mesas: sin }] : ordenados;
}

// ─────────────────────────── Pestañas por sección ───────────────────────────

/** La pestaña que junta todas las mesas: es la vista de siempre (agrupada, con títulos). */
export const TAB_TODAS = 'todas';
/** La pestaña de las mesas que aún no están en ninguna sección. */
export const TAB_SIN_SECCION = '__sin__';

export interface TabSeccion {
  /** `todas`, `__sin__` o `s<id_seccion>`. Estable: es lo que se guarda como pestaña activa. */
  clave: string;
  etiqueta: string;
  total: number;
}

/**
 * Las pestañas del salón: «Todas» primero y luego una por sección, en el orden del administrador
 * (las vacías incluidas: una sección recién creada tiene que tener su pestaña), y «Sin sección» al
 * final si quedan mesas sueltas. Sin ninguna sección no hay pestañas — el salón no está dividido.
 */
export function armarTabs<T extends ConSeccion>(mesas: T[], secciones: SeccionBasica[] = []): TabSeccion[] {
  const grupos = agruparPorSeccion(mesas, secciones);
  if (grupos.length === 0 || grupos.every((g) => g.titulo === null)) return [];
  return [
    { clave: TAB_TODAS, etiqueta: 'Todas', total: mesas.length },
    ...grupos.map((g) => ({ clave: g.clave, etiqueta: g.titulo ?? '', total: g.mesas.length })),
  ];
}

/** Las mesas de una pestaña. Una clave que ya no existe no filtra nada (se ven todas). */
export function filtrarPorTab<T extends ConSeccion>(mesas: T[], clave: string): T[] {
  if (clave === TAB_TODAS) return mesas;
  if (clave === TAB_SIN_SECCION) return mesas.filter((m) => m.id_seccion == null);
  const id = /^s(\d+)$/.exec(clave)?.[1];
  return id === undefined ? mesas : mesas.filter((m) => m.id_seccion === Number(id));
}
