import {
  ChangeDetectionStrategy, Component, computed, inject, input, signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import { GrupoComparado, ProveedoresService } from '../../../../core/services/proveedores.service';
import { IngredienteLite } from '../proveedor-detalle/proveedor-detalle';

/** Desde cuántos días un precio se enseña como «viejo». El backend usa el mismo umbral. */
const DIAS_VIEJO = 90;

/**
 * ComparadorComponent — el mismo insumo, varios proveedores.
 *
 * ## Por qué esta pantalla avisa tanto
 *
 * Comparar precios de insumos es fácil de hacer mal: una caja de 12 contra una unidad, un
 * kilo contra 500 gramos, un precio de ayer contra uno de hace ocho meses. Las tres
 * comparaciones **parecen correctas** y las tres llevan a comprarle al más caro.
 *
 * Por eso aquí el aviso no es un detalle de cortesía: cuando las unidades no se pueden
 * reducir a la misma base, el comparador **no señala un ganador**, y lo dice. Un módulo que
 * siempre da una respuesta, aunque sea inventada, se usa una vez y no se vuelve a creer.
 *
 * El precio por unidad base lo calcula el backend (`precio_base`): aquí solo se pinta, para
 * que la cifra que se ve sea exactamente la que el servidor ordenó.
 */
@Component({
  selector: 'app-comparador',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './comparador.html',
  styleUrl: './comparador.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparadorComponent {
  private readonly api = inject(ProveedoresService);
  private readonly auth = inject(AuthService);

  readonly ingredientes = input<IngredienteLite[]>([]);
  /** Sin este permiso no se pide nada: el comparador ES información de precios. */
  readonly puedeVerPrecios = input(false);

  readonly busqueda = signal('');
  readonly ingrediente = signal<number | null>(null);
  readonly grupos = signal<GrupoComparado[]>([]);
  readonly buscando = signal(false);
  readonly buscado = signal(false);
  readonly error = signal<string | null>(null);

  readonly diasViejo = DIAS_VIEJO;

  private readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly puedeBuscar = computed(
    () => !!this.busqueda().trim() || this.ingrediente() !== null,
  );

  /** La unidad base en texto corto: «$/kg» se lee mejor que «precio por KG». */
  unidadCorta(base: string | null): string {
    return { KG: '/kg', L: '/L', UN: '/un' }[base ?? ''] ?? '';
  }

  buscar(): void {
    const idNegocio = this.negocioId();
    if (!idNegocio || !this.puedeBuscar()) return;

    this.buscando.set(true);
    this.error.set(null);

    this.api.comparar(idNegocio, {
      busqueda: this.busqueda().trim() || undefined,
      idIngrediente: this.ingrediente() ?? undefined,
    }).subscribe({
      next: (res) => {
        this.grupos.set(res?.data ?? []);
        this.buscando.set(false);
        this.buscado.set(true);
      },
      error: (err) => {
        this.grupos.set([]);
        this.buscando.set(false);
        this.buscado.set(true);
        this.error.set(err?.error?.message ?? 'No se pudo comparar ahora mismo.');
      },
    });
  }

  /**
   * Elegir un insumo del inventario es una forma distinta de preguntar, no un filtro más:
   * borra la búsqueda por texto y lanza la consulta sola.
   */
  alElegirIngrediente(valor: number | null): void {
    this.ingrediente.set(valor);
    if (valor !== null) {
      this.busqueda.set('');
      this.buscar();
    }
  }

  limpiar(): void {
    this.busqueda.set('');
    this.ingrediente.set(null);
    this.grupos.set([]);
    this.buscado.set(false);
    this.error.set(null);
  }

  onEnter(event: Event): void {
    event.preventDefault();
    this.buscar();
  }

  /** Cuánto más caro es respecto al más barato del grupo, en porcentaje. */
  sobrecosto(grupo: GrupoComparado, idInsumo: number): number | null {
    if (grupo.id_mas_barato == null) return null;
    const base = grupo.ofertas.find((o) => o.id_proveedor_insumo === grupo.id_mas_barato);
    const esta = grupo.ofertas.find((o) => o.id_proveedor_insumo === idInsumo);
    if (!base?.precio_base || !esta?.precio_base || base.precio_base === esta.precio_base) return null;
    return ((esta.precio_base - base.precio_base) / base.precio_base) * 100;
  }
}
