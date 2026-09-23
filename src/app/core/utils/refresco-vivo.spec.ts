import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';

import { aplicarLista, aplicarValor, fusionarLista, mismoContenido } from './refresco-vivo';

interface Pedido {
  id: number;
  estado: string;
  total?: number;
}

describe('refresco-vivo', () => {
  describe('mismoContenido', () => {
    it('dos respuestas iguales del servidor son la misma cosa', () => {
      expect(mismoContenido({ id: 1, estado: 'ABIERTA' }, { id: 1, estado: 'ABIERTA' })).toBe(true);
    });

    it('distingue un cambio de verdad', () => {
      expect(mismoContenido({ id: 1, estado: 'ABIERTA' }, { id: 1, estado: 'CERRADA' })).toBe(false);
    });

    it('un campo que aparece o desaparece cuenta como cambio', () => {
      expect(mismoContenido({ id: 1 }, { id: 1, total: 0 })).toBe(false);
    });

    it('compara listas y objetos anidados', () => {
      const a = { id: 1, pagos: [{ metodo: 'EFECTIVO', valor: 1000 }] };
      const b = { id: 1, pagos: [{ metodo: 'EFECTIVO', valor: 1000 }] };
      const c = { id: 1, pagos: [{ metodo: 'EFECTIVO', valor: 2000 }] };
      expect(mismoContenido(a, b)).toBe(true);
      expect(mismoContenido(a, c)).toBe(false);
    });
  });

  describe('fusionarLista', () => {
    const clave = (p: Pedido) => p.id;

    it('sin cambios devuelve la MISMA lista: la vista no se entera', () => {
      const actual: Pedido[] = [{ id: 1, estado: 'ABIERTA' }, { id: 2, estado: 'ABIERTA' }];
      const llegada: Pedido[] = [{ id: 1, estado: 'ABIERTA' }, { id: 2, estado: 'ABIERTA' }];

      expect(fusionarLista(actual, llegada, clave)).toBe(actual);
    });

    it('con un cambio conserva el objeto de los que no cambiaron', () => {
      const uno: Pedido = { id: 1, estado: 'ABIERTA' };
      const dos: Pedido = { id: 2, estado: 'ABIERTA' };
      const resultado = fusionarLista(
        [uno, dos],
        [{ id: 1, estado: 'ABIERTA' }, { id: 2, estado: 'CERRADA' }],
        clave,
      );

      expect(resultado).not.toBe([uno, dos]);
      // El primero es el objeto de antes: su tarjeta no se repinta.
      expect(resultado[0]).toBe(uno);
      expect(resultado[1]).not.toBe(dos);
      expect(resultado[1].estado).toBe('CERRADA');
    });

    it('un pedido nuevo entra y uno que se fue desaparece', () => {
      const uno: Pedido = { id: 1, estado: 'ABIERTA' };
      const resultado = fusionarLista([uno], [{ id: 1, estado: 'ABIERTA' }, { id: 3, estado: 'ABIERTA' }], clave);

      expect(resultado).toHaveLength(2);
      expect(resultado[0]).toBe(uno);

      const tras = fusionarLista(resultado, [{ id: 3, estado: 'ABIERTA' }], clave);
      expect(tras).toHaveLength(1);
      expect(tras[0].id).toBe(3);
    });

    it('reordenar también es un cambio', () => {
      const actual: Pedido[] = [{ id: 1, estado: 'A' }, { id: 2, estado: 'A' }];
      const resultado = fusionarLista(actual, [{ id: 2, estado: 'A' }, { id: 1, estado: 'A' }], clave);

      expect(resultado).not.toBe(actual);
      expect(resultado.map((p) => p.id)).toEqual([2, 1]);
    });
  });

  describe('aplicarLista / aplicarValor', () => {
    it('no escribe la señal cuando no hay novedades', () => {
      const lista = signal<Pedido[]>([{ id: 1, estado: 'ABIERTA' }]);
      const antes = lista();

      aplicarLista(lista, [{ id: 1, estado: 'ABIERTA' }], (p) => p.id);

      expect(lista()).toBe(antes);
    });

    it('escribe cuando sí cambió', () => {
      const lista = signal<Pedido[]>([{ id: 1, estado: 'ABIERTA' }]);
      aplicarLista(lista, [{ id: 1, estado: 'CERRADA' }], (p) => p.id);

      expect(lista()[0].estado).toBe('CERRADA');
    });

    it('el turno de caja idéntico no se reescribe', () => {
      const caja = signal<{ id_caja: number; ingresos: number } | null>({ id_caja: 7, ingresos: 5000 });
      const antes = caja();

      aplicarValor(caja, { id_caja: 7, ingresos: 5000 });
      expect(caja()).toBe(antes);

      aplicarValor(caja, { id_caja: 7, ingresos: 9000 });
      expect(caja()).not.toBe(antes);
      expect(caja()?.ingresos).toBe(9000);
    });
  });
});
