import { describe, expect, it } from 'vitest';

import { SeccionBasica, TAB_SIN_SECCION, TAB_TODAS, agruparPorSeccion, armarTabs, filtrarPorTab } from './mesa-secciones';

const m = (id: number, id_seccion?: number | null, seccion?: string | null, seccion_orden?: number | null) => ({
  id,
  id_seccion,
  seccion,
  seccion_orden,
});

const sec = (id_seccion: number, nombre: string, orden: number): SeccionBasica => ({ id_seccion, nombre, orden });

describe('agruparPorSeccion', () => {
  it('sin ninguna sección el salón queda como siempre: un solo grupo, sin título', () => {
    const grupos = agruparPorSeccion([m(1), m(2, null), m(3)]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].titulo).toBeNull();
    expect(grupos[0].mesas.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('sin mesas ni secciones no hay grupos', () => {
    expect(agruparPorSeccion([])).toEqual([]);
  });

  it('agrupa por sección en el orden que fijó el administrador, y las sueltas van al final', () => {
    const grupos = agruparPorSeccion([
      m(1, 20, 'Terraza', 1),
      m(2, 10, 'Piso 1', 0),
      m(3),
      m(4, 10, 'Piso 1', 0),
    ]);
    expect(grupos.map((g) => g.titulo)).toEqual(['Piso 1', 'Terraza', 'Sin sección']);
    expect(grupos[0].mesas.map((x) => x.id)).toEqual([2, 4]);
    expect(grupos[2].mesas.map((x) => x.id)).toEqual([3]);
  });

  it('el ORDEN del administrador manda sobre el alfabético', () => {
    const grupos = agruparPorSeccion([m(1, 1, 'A', 5), m(2, 2, 'B', 0), m(3, 3, 'C', 3)]);
    expect(grupos.map((g) => g.titulo)).toEqual(['B', 'C', 'A']);
  });

  it('a igual orden desempata por nombre en orden natural (Piso 2 antes que Piso 10)', () => {
    const grupos = agruparPorSeccion([m(1, 1, 'Piso 10', 0), m(2, 2, 'Piso 2', 0)]);
    expect(grupos.map((g) => g.titulo)).toEqual(['Piso 2', 'Piso 10']);
  });

  it('dentro de cada grupo conserva el orden en que llegan las mesas', () => {
    const grupos = agruparPorSeccion([m(3, 1, 'A', 0), m(1, 1, 'A', 0), m(2, 1, 'A', 0)]);
    expect(grupos[0].mesas.map((x) => x.id)).toEqual([3, 1, 2]);
  });

  it('dos secciones con el mismo nombre pero distinto id NO se mezclan', () => {
    const grupos = agruparPorSeccion([m(1, 1, 'Patio', 0), m(2, 2, 'Patio', 1)]);
    expect(grupos).toHaveLength(2);
  });

  describe('secciones vacías', () => {
    it('una sección recién creada, sin mesas, aparece si se pasa la lista', () => {
      const grupos = agruparPorSeccion([m(1, 10, 'Piso 1', 0)], [sec(10, 'Piso 1', 0), sec(11, 'Terraza', 1)]);
      expect(grupos.map((g) => g.titulo)).toEqual(['Piso 1', 'Terraza']);
      expect(grupos[1].mesas).toEqual([]);
    });

    it('si solo hay secciones vacías y ninguna mesa, igual se muestran (con título)', () => {
      const grupos = agruparPorSeccion([], [sec(1, 'Patio', 0)]);
      expect(grupos).toHaveLength(1);
      expect(grupos[0].titulo).toBe('Patio');
    });

    it('con la lista, las mesas sueltas siguen yendo a «Sin sección» al final', () => {
      const grupos = agruparPorSeccion([m(1)], [sec(1, 'Patio', 0)]);
      expect(grupos.map((g) => g.titulo)).toEqual(['Patio', 'Sin sección']);
    });

    it('sin la lista, las secciones vacías no aparecen', () => {
      const grupos = agruparPorSeccion([m(1, 10, 'Piso 1', 0)]);
      expect(grupos).toHaveLength(1);
    });

    it('el título y el orden de la lista mandan sobre lo que trae la mesa', () => {
      const grupos = agruparPorSeccion([m(1, 10, 'nombre viejo', 9)], [sec(10, 'Piso 1', 0), sec(11, 'Terraza', 1)]);
      expect(grupos.map((g) => g.titulo)).toEqual(['Piso 1', 'Terraza']);
    });
  });
});

describe('pestañas por sección', () => {
  const mesas = [m(1, 10, 'Piso 1', 0), m(2, 10, 'Piso 1', 0), m(3, 11, 'Terraza', 1), m(4)];
  const secciones = [sec(10, 'Piso 1', 0), sec(11, 'Terraza', 1)];

  describe('armarTabs', () => {
    it('«Todas» primero, luego una por sección en su orden, y «Sin sección» al final con sus mesas', () => {
      const tabs = armarTabs(mesas, secciones);
      expect(tabs.map((t) => t.etiqueta)).toEqual(['Todas', 'Piso 1', 'Terraza', 'Sin sección']);
      expect(tabs.map((t) => t.total)).toEqual([4, 2, 1, 1]);
      expect(tabs[0].clave).toBe(TAB_TODAS);
      expect(tabs[3].clave).toBe(TAB_SIN_SECCION);
    });

    it('sin ninguna sección no hay pestañas: el salón no está dividido', () => {
      expect(armarTabs([m(1), m(2)])).toEqual([]);
      expect(armarTabs([])).toEqual([]);
    });

    it('una sección vacía tiene su pestaña (con 0)', () => {
      const tabs = armarTabs([m(1, 10, 'Piso 1', 0)], [sec(10, 'Piso 1', 0), sec(11, 'Terraza', 1)]);
      expect(tabs.map((t) => [t.etiqueta, t.total])).toEqual([['Todas', 1], ['Piso 1', 1], ['Terraza', 0]]);
    });

    it('sin mesas sueltas no hay pestaña «Sin sección»', () => {
      const tabs = armarTabs([m(1, 10, 'Piso 1', 0)], [sec(10, 'Piso 1', 0)]);
      expect(tabs.map((t) => t.etiqueta)).toEqual(['Todas', 'Piso 1']);
    });

    it('funciona aunque la lista de secciones no haya llegado (las mesas traen la suya)', () => {
      const tabs = armarTabs(mesas);
      expect(tabs.map((t) => t.etiqueta)).toEqual(['Todas', 'Piso 1', 'Terraza', 'Sin sección']);
    });
  });

  describe('filtrarPorTab', () => {
    it('«Todas» no filtra', () => {
      expect(filtrarPorTab(mesas, TAB_TODAS)).toHaveLength(4);
    });

    it('una sección deja solo las suyas', () => {
      expect(filtrarPorTab(mesas, 's10').map((x) => x.id)).toEqual([1, 2]);
      expect(filtrarPorTab(mesas, 's11').map((x) => x.id)).toEqual([3]);
    });

    it('«Sin sección» deja las sueltas', () => {
      expect(filtrarPorTab(mesas, TAB_SIN_SECCION).map((x) => x.id)).toEqual([4]);
    });

    it('una sección sin mesas da lista vacía; una clave que no existe no oculta nada', () => {
      expect(filtrarPorTab(mesas, 's99')).toEqual([]);
      expect(filtrarPorTab(mesas, 'cualquier-cosa')).toHaveLength(4);
    });
  });
});
