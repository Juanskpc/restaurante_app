import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../services/auth.service';

/**
 * `/horarios` → la pestaña «Horarios» de Configuración (2026-10-13).
 *
 * Horarios dejó de tener entrada propia en el menú: vive dentro de Configuración. La ruta se
 * conserva por dos razones, y por eso esto es un guardia y no un `redirectTo`:
 *
 *   - Los enlaces guardados (y el aviso de horario del asistente) siguen llegando a `/horarios`.
 *   - El permiso de Horarios es propio. Quien lo tiene SIN el de Configuración no podría entrar a
 *     la pestaña, así que a esa persona se le deja la pantalla suelta de siempre. Un `redirectTo`
 *     lo mandaría a una ruta que el guardia de permisos le cierra.
 */
export const horariosEnConfiguracion: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const auth = inject(AuthService);
  if (!auth.canAccessRoute('/configuracion')) return true;

  return inject(Router).createUrlTree(['/configuracion'], { queryParams: { tab: 'horarios' } });
};
