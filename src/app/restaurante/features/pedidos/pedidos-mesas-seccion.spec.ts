import { describe, expect, it } from 'vitest';

import { agruparPorSeccion } from '../mesas/mesa-secciones';
import type { Mesa } from './pedidos';

/**
 * El selector de mesa de Pedidos, agrupado por sección.
 *
 * `agruparPorSeccion` ya tiene su propia suite en `mesas/mesa-secciones.spec.ts`: lo que se fija
 * **aquí** es el contrato con el que Pedidos lo usa, que es distinto del de la vista de Mesas en
 * dos cosas y las dos importan:
 *
 *   1. Pedidos **no le pasa las secciones del negocio**, solo las mesas. Allá se las pasa para
 *      que una sección recién creada se vea vacía; aquí eso sería un `<optgroup>` sin opciones.
 *   2. Pedidos decide con `mesasAgrupadas` si pinta `<optgroup>` o la lista plana de siempre. Un
 *      salón sin secciones tiene que seguir viéndose **exactamente** como antes, y eso no lo
 *      avisa nadie si se rompe: un `<optgroup>` sin título es una sangría silenciosa.
 *
 * La regla que replican estas pruebas es la del componente:
 *   `mesasAgrupadas = mesasPorSeccion().some((g) => g.titulo !== null)`
 */

const mesa = (
  id_mesa: number,
  nombre: string,
  seccion?: { id: number; nombre: string; orden: number },
): Mesa => ({
  id_mesa,
  nombre,
  numero: id_mesa,
  capacidad: 4,
  estado: 'A',
  id_seccion: seccion?.id ?? null,
  seccion: seccion?.nombre ?? null,
  seccion_orden: seccion?.orden ?? null,
});

/** Lo mismo que calcula el componente, para fijar la regla y no solo el agrupador. */
const seAgrupa = (mesas: Mesa[]) => agruparPorSeccion(mesas).some((g) => g.titulo !== null);

const PISO_1 = { id: 10, nombre: 'Piso 1', orden: 0 };
const TERRAZA = { id: 20, nombre: 'Terraza', orden: 1 };

describe('selector de mesa de Pedidos — agrupación por sección', () => {
  it('un salón SIN secciones se ve como siempre: lista plana', () => {
    const mesas = [mesa(1, 'Mesa 1'), mesa(2, 'Mesa 2'), mesa(3, 'Mesa 3')];

    expect(seAgrupa(mesas)).toBe(false);
    const grupos = agruparPorSeccion(mesas);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulo).toBeNull();
  });

  it('con secciones, una por grupo y en el orden del administrador', () => {
    const mesas = [
      mesa(1, 'Mesa 1', TERRAZA),
      mesa(2, 'Mesa 2', PISO_1),
      mesa(3, 'Mesa 3', TERRAZA),
      mesa(4, 'Mesa 4', PISO_1),
    ];

    expect(seAgrupa(mesas)).toBe(true);
    const grupos = agruparPorSeccion(mesas);

    // Piso 1 (orden 0) antes que Terraza (orden 1), aunque la primera mesa de la lista sea de Terraza.
    expect(grupos.map((g) => g.titulo)).toEqual(['Piso 1', 'Terraza']);
    expect(grupos[0].mesas.map((m) => m.nombre)).toEqual(['Mesa 2', 'Mesa 4']);
    expect(grupos[1].mesas.map((m) => m.nombre)).toEqual(['Mesa 1', 'Mesa 3']);
  });

  it('las mesas sin sección van al final, bajo su propio rótulo', () => {
    const mesas = [mesa(1, 'Mesa 1', PISO_1), mesa(2, 'Mesa 2'), mesa(3, 'Mesa 3', TERRAZA)];

    const grupos = agruparPorSeccion(mesas);
    expect(grupos.map((g) => g.titulo)).toEqual(['Piso 1', 'Terraza', 'Sin sección']);
    expect(grupos.at(-1)?.mesas.map((m) => m.nombre)).toEqual(['Mesa 2']);
  });

  it('con una sola sección TAMBIÉN se agrupa: el rótulo es la información', () => {
    // Es el caso que tienta a «simplificar»: un solo grupo parece ruido. No lo es — el dueño que
    // creó «Terraza» quiere ver que esas mesas son de la terraza, y el resto no.
    const mesas = [mesa(1, 'Mesa 1', TERRAZA), mesa(2, 'Mesa 2')];

    expect(seAgrupa(mesas)).toBe(true);
    expect(agruparPorSeccion(mesas).map((g) => g.titulo)).toEqual(['Terraza', 'Sin sección']);
  });

  it('ninguna mesa se pierde ni se repite al agrupar', () => {
    const mesas = [
      mesa(1, 'Mesa 1', PISO_1),
      mesa(2, 'Mesa 2'),
      mesa(3, 'Mesa 3', TERRAZA),
      mesa(4, 'Mesa 4', PISO_1),
      mesa(5, 'Mesa 5'),
    ];

    const ids = agruparPorSeccion(mesas).flatMap((g) => g.mesas.map((m) => m.id_mesa));
    expect(ids.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('dentro de un grupo se conserva el orden del servidor (por número de mesa)', () => {
    // `GET /mesas` ordena por `numero ASC` y el agrupador no reordena: si lo hiciera, el selector
    // enseñaría las mesas en un orden distinto al del tablero.
    const mesas = [
      mesa(3, 'Mesa 3', PISO_1),
      mesa(7, 'Mesa 7', PISO_1),
      mesa(9, 'Mesa 9', PISO_1),
    ];

    expect(agruparPorSeccion(mesas)[0].mesas.map((m) => m.id_mesa)).toEqual([3, 7, 9]);
  });

  it('una mesa cuya sección llega sin nombre no rompe el grupo', () => {
    // Defensiva: el servidor manda `seccion` junto a `id_seccion`, pero una respuesta vieja en
    // caché podría traer solo el id. Mejor un rótulo genérico que un `<optgroup label="">`.
    const mesas: Mesa[] = [
      { ...mesa(1, 'Mesa 1'), id_seccion: 10, seccion: null, seccion_orden: null },
    ];

    const grupos = agruparPorSeccion(mesas);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulo).toBe('Sin sección');
    expect(grupos[0].mesas).toHaveLength(1);
  });
});
