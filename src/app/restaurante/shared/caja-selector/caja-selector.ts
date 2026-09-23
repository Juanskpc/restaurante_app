import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { CajaService } from '../../../core/services/caja.service';

/**
 * En qué caja (rubro) se está trabajando: Restaurante, Tienda…
 *
 * No se pinta nada si el usuario tiene una sola caja, que es el caso de casi todos los
 * negocios: para ellos esta pieza no existe. Con varias, es un grupo de botones y no un
 * `<select>` porque la elección tiene que verse de un vistazo — cobrar en la caja equivocada
 * es mezclar la plata de dos rubros.
 *
 * La elección vive en `CajaService` (y se recuerda en el equipo), así que el POS y la
 * pantalla de Caja comparten la misma caja activa.
 */
@Component({
  selector: 'app-caja-selector',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cajaSvc.variasCajas()) {
      <div class="cs" role="radiogroup" aria-label="Caja en la que trabajas">
        <span class="cs__label">
          <lucide-icon name="wallet" [size]="14" aria-hidden="true" />
          Caja
        </span>
        <div class="cs__opciones">
          @for (p of cajaSvc.misCajas(); track p.id_punto_caja) {
            <button
              type="button"
              role="radio"
              class="cs__opcion"
              [class.cs__opcion--activa]="p.id_punto_caja === activa()"
              [attr.aria-checked]="p.id_punto_caja === activa()"
              [disabled]="deshabilitado()"
              (click)="elegir(p.id_punto_caja)"
            >
              {{ p.nombre }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .cs {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      min-width: 0;
    }
    .cs__label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 600;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cs__opciones {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: var(--color-bg);
    }
    .cs__opcion {
      border: 0;
      background: transparent;
      color: var(--color-text-secondary);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 5px 12px;
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .cs__opcion:hover:not(:disabled):not(.cs__opcion--activa) {
      background: color-mix(in srgb, var(--color-primary) 8%, transparent);
      color: var(--color-text-primary);
    }
    .cs__opcion--activa {
      background: var(--color-primary);
      color: #fff;
    }
    .cs__opcion:disabled { cursor: not-allowed; opacity: 0.6; }
    .cs__opcion:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  `],
})
export class CajaSelectorComponent {
  protected readonly cajaSvc = inject(CajaService);
  private readonly auth = inject(AuthService);

  protected readonly deshabilitado = computed(() => this.cajaSvc.cargando());

  protected readonly activa = computed(() => this.cajaSvc.puntoActivo()?.id_punto_caja ?? null);

  /** Avisa al contenedor tras cambiar, ya con el turno de la nueva caja cargado. */
  readonly cambio = output<number>();

  protected elegir(idPuntoCaja: number): void {
    if (idPuntoCaja === this.activa()) return;
    const idNegocio = this.auth.negocio()?.id_negocio;
    if (!idNegocio) return;
    this.cajaSvc.seleccionarPunto(idNegocio, idPuntoCaja).subscribe({
      next: () => this.cambio.emit(idPuntoCaja),
      error: () => this.cambio.emit(idPuntoCaja),
    });
  }
}
