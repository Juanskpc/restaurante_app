import { describe, expect, it } from 'vitest';

import { AuthService } from '../core/services/auth.service';
import { pestanasDisponibles, rutaDisponible } from './secciones';

/** Una sesión de mentira: las rutas que puede abrir y si EscalApp le encendió Promociones. */
function sesion(rutas: string[], promociones = false, subniveles: string[] = []): AuthService {
  return {
    canAccessRoute: (r: string) => rutas.includes(r),
    canAccessSubnivel: (c: string) => subniveles.includes(c),
    permitePromociones: () => promociones,
  } as unknown as AuthService;
}

describe('las secciones del menú', () => {
  it('WhatsApp enseña Promociones solo si EscalApp la encendió, aunque haya permiso', () => {
    const conPermiso = ['/conversaciones', '/promociones'];

    expect(pestanasDisponibles(sesion(conPermiso, false), 'whatsapp').map((p) => p.label)).toEqual([
      'Conversaciones',
    ]);
    expect(pestanasDisponibles(sesion(conPermiso, true), 'whatsapp').map((p) => p.label)).toEqual([
      'Conversaciones',
      'Promociones',
    ]);
  });

  it('cada pestaña respeta su propio permiso: Proveedores no sale a quien solo ve Inventario', () => {
    const soloInventario = pestanasDisponibles(sesion(['/inventario']), 'inventario');
    expect(soloInventario.map((p) => p.route)).toEqual(['/inventario']);

    const soloProveedores = pestanasDisponibles(sesion(['/proveedores']), 'inventario');
    expect(soloProveedores.map((p) => p.route)).toEqual(['/proveedores']);
  });

  it('el salón exige además su subnivel', () => {
    expect(rutaDisponible(sesion(['/mesas']), '/mesas')).toBe(false);
    expect(rutaDisponible(sesion(['/mesas'], false, ['pedidos_en_mesa']), '/mesas')).toBe(true);
  });
});
