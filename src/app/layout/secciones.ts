import { AuthService } from '../core/services/auth.service';

/**
 * Las secciones que agrupan varias pantallas bajo UNA entrada del menú (2026-10-13).
 *
 * El menú tenía 16 entradas y el dueño pidió menos: «se están haciendo muchas opciones en el menú
 * y esto cansa al usuario». Las pantallas no se fundieron en una: cada una conserva su ruta, su
 * permiso y su guardia. Lo que cambia es que el menú las nombra una sola vez y, dentro, una barra
 * de pestañas (`SeccionPestanasComponent`) lleva de una a otra.
 *
 * Por qué rutas y no pestañas en memoria: el permiso de cada pantalla es propio (quien ajusta el
 * stock no tiene por qué ver a cuánto compra el dueño), y una ruta por pantalla es lo que hace
 * que el guardia, los enlaces guardados y el botón «atrás» sigan funcionando igual que antes.
 *
 * Horarios no está aquí: va como una pestaña más DENTRO de Configuración, que ya tiene las suyas
 * y no necesita otra barra encima.
 */
export type IdSeccion = 'whatsapp' | 'inventario';

export interface PestanaSeccion {
  label: string;
  route: string;
  icon: string;
}

export const SECCIONES: Record<IdSeccion, PestanaSeccion[]> = {
  whatsapp: [
    { label: 'Conversaciones', route: '/conversaciones', icon: 'message-circle' },
    { label: 'Promociones', route: '/promociones', icon: 'megaphone' },
  ],
  inventario: [
    { label: 'Inventario', route: '/inventario', icon: 'package' },
    { label: 'Proveedores', route: '/proveedores', icon: 'truck' },
  ],
};

/**
 * Rutas que además del permiso necesitan que EscalApp le haya encendido la función al negocio.
 *
 * No es lo mismo que un subnivel: un subnivel lo reparte el dueño entre sus roles, y esto lo
 * decide EscalApp negocio por negocio. Promociones manda publicidad por el número del negocio y
 * gasta dinero en Meta, así que mientras no esté encendida nadie la ve.
 */
const BANDERA_POR_RUTA: Record<string, (auth: AuthService) => boolean> = {
  '/promociones': (auth) => auth.permitePromociones(),
};

/**
 * Subnivel que además del permiso de módulo debe estar activo.
 * Un negocio que solo vende para llevar apaga «En mesa» y el salón desaparece.
 */
const SUBNIVEL_POR_RUTA: Record<string, string> = {
  '/mesas': 'pedidos_en_mesa',
};

/** ¿Esta persona puede entrar a esta pantalla? La única respuesta para el menú y las pestañas. */
export function rutaDisponible(auth: AuthService, route: string): boolean {
  if (!auth.canAccessRoute(route)) return false;
  const bandera = BANDERA_POR_RUTA[route];
  if (bandera && !bandera(auth)) return false;
  const subnivel = SUBNIVEL_POR_RUTA[route];
  return !subnivel || auth.canAccessSubnivel(subnivel);
}

/** Las pestañas de una sección que esta persona puede abrir, en su orden. */
export function pestanasDisponibles(auth: AuthService, seccion: IdSeccion): PestanaSeccion[] {
  return SECCIONES[seccion].filter((p) => rutaDisponible(auth, p.route));
}
