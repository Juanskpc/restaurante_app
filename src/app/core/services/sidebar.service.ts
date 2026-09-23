import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Dónde se recuerda que el menú quedó plegado. Igual que en la consola (`admin_app_v21`). */
const CLAVE = 'negocio_sidebar_colapsado';

/**
 * SidebarService — si el menú lateral está plegado o desplegado.
 *
 * Vive fuera del sidebar porque hay dos que necesitan saberlo: el propio menú, que se convierte
 * en un riel de iconos, y el área de contenido, que tiene que correrse a la izquierda para
 * aprovechar el espacio que queda libre.
 *
 * La elección se guarda en el equipo: quien trabaja en una tablet de 10 pulgadas lo pliega una
 * vez y lo encuentra plegado mañana.
 */
@Injectable({ providedIn: 'root' })
export class SidebarService {
  private readonly platformId = inject(PLATFORM_ID);

  private readonly estado = signal(this.leerGuardado());
  readonly colapsado = this.estado.asReadonly();
  readonly expandido = computed(() => !this.estado());

  alternar(): void {
    this.estado.update((v) => !v);
    this.guardar();
  }

  fijar(colapsado: boolean): void {
    this.estado.set(colapsado);
    this.guardar();
  }

  private leerGuardado(): boolean {
    // En el servidor (SSR) no hay almacenamiento ni pantalla: se pinta desplegado, que es lo
    // que ve la mayoría, y el navegador ajusta al hidratar si el usuario lo tenía plegado.
    if (!isPlatformBrowser(this.platformId)) return false;
    try {
      return localStorage.getItem(CLAVE) === 'true';
    } catch {
      return false;
    }
  }

  private guardar(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(CLAVE, String(this.estado()));
    } catch {
      /* modo privado o almacenamiento bloqueado: la elección dura lo que dure la pestaña */
    }
  }
}
