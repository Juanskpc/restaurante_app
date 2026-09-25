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

  /**
   * Cómo lo quiere el usuario cuando nadie le impone nada. Solo lo cambia el botón del menú, y es
   * lo único que se guarda en `localStorage`.
   *
   * Existe separado de `estado` porque hay pantallas que lo pliegan por su cuenta (`pedir`): sin
   * esta copia, entrar y salir de una de ellas dejaría el menú plegado para siempre a quien lo
   * tenía desplegado.
   */
  private readonly preferencia = signal(this.leerGuardado());
  private readonly estado = signal(this.preferencia());
  readonly colapsado = this.estado.asReadonly();
  readonly expandido = computed(() => !this.estado());

  /**
   * Cuántas pantallas piden ahora mismo el ancho completo. Es un contador y no un booleano: al
   * navegar, la pantalla nueva puede pedirlo antes de que la vieja lo suelte, y con un booleano
   * ese orden dejaba el menú desplegado.
   */
  private pedidos = 0;

  /** Una pantalla de trabajo pide todo el ancho (hoy Pedidos); cada `pedir()` lleva su `soltar()`. */
  pedir(): void {
    this.pedidos += 1;
    this.estado.set(true);
  }

  soltar(): void {
    this.pedidos = Math.max(0, this.pedidos - 1);
    if (this.pedidos === 0) this.estado.set(this.preferencia());
  }

  /**
   * El botón del menú. Dentro de una pantalla que pidió el ancho, el clic vale para esa visita
   * —el menú se abre y se queda—, pero al volver a entrar la pantalla lo pliega otra vez.
   */
  alternar(): void {
    this.estado.update((v) => !v);
    this.preferencia.set(this.estado());
    this.guardar();
  }

  fijar(colapsado: boolean): void {
    this.estado.set(colapsado);
    this.preferencia.set(colapsado);
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
      localStorage.setItem(CLAVE, String(this.preferencia()));
    } catch {
      /* modo privado o almacenamiento bloqueado: la elección dura lo que dure la pestaña */
    }
  }
}
