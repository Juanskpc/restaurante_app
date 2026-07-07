import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

export interface MetodoPagoLite {
  id_metodo_pago: number;
  nombre: string;
}

/** Resultado de la selección de forma(s) de pago. */
export interface PagoSeleccion {
  modo: 'simple' | 'multi';
  /** Método único (pago simple). null en multipago. */
  idMetodoPago: number | null;
  /** Desglose (multipago). Vacío en pago simple. */
  pagos: { id_metodo_pago: number; valor: number }[];
  /** ¿La selección está completa y cuadrada? */
  valido: boolean;
}

interface FilaPago {
  id_metodo_pago: number | null;
  valor: number | null;
}

const MULTI_VALUE = '__multi__';

/**
 * Selector de forma de pago reutilizable para Pedidos, Mesas y Despacho.
 *
 * - Pago simple: un <select> con los métodos del negocio.
 * - Multipago (si el negocio lo habilita): opción que despliega un desglose
 *   donde se agregan varias formas de pago con su valor. La suma debe ser
 *   EXACTAMENTE igual al total; hasta entonces `seleccion().valido` es false.
 *
 * El padre lee el resultado por referencia de plantilla: `#pago` → `pago.seleccion()`.
 */
@Component({
  selector: 'app-multipago-selector',
  standalone: true,
  imports: [CurrencyPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './multipago-selector.html',
  styleUrl: './multipago-selector.scss',
  // En multipago el selector ocupa una fila completa (para que quepa el
  // desglose); en pago simple comparte fila con el <select> vecino.
  host: { '[class.mp--multi]': 'modo() === "multi"' },
})
export class MultipagoSelectorComponent {
  readonly metodos = input<MetodoPagoLite[]>([]);
  readonly total = input<number>(0);
  readonly permiteMultipago = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly idMetodoPagoInicial = input<number | null>(null);

  /** Emite la selección actual cada vez que cambia. */
  readonly seleccionChange = output<PagoSeleccion>();

  protected readonly MULTI_VALUE = MULTI_VALUE;

  protected readonly modo = signal<'simple' | 'multi'>('simple');
  protected readonly metodoSimple = signal<number | null>(null);
  protected readonly filas = signal<FilaPago[]>([]);

  protected readonly sumaMulti = computed(() =>
    this.filas().reduce((acc, f) => acc + (Number(f.valor) || 0), 0)
  );

  protected readonly restante = computed(() =>
    Math.round((this.total() - this.sumaMulti()) * 100) / 100
  );

  /** Selección expuesta al componente padre. */
  readonly seleccion = computed<PagoSeleccion>(() => {
    if (this.modo() === 'simple') {
      const id = this.metodoSimple();
      return { modo: 'simple', idMetodoPago: id, pagos: [], valido: id != null };
    }

    const filas = this.filas();
    const completas = filas.filter(
      (f) => f.id_metodo_pago != null && Number(f.valor) > 0
    );
    const pagos = completas.map((f) => ({
      id_metodo_pago: f.id_metodo_pago as number,
      valor: Number(f.valor),
    }));

    const totalCuadra =
      Math.round(this.sumaMulti() * 100) === Math.round(this.total() * 100);
    const valido =
      filas.length >= 2 && completas.length === filas.length && totalCuadra;

    return { modo: 'multi', idMetodoPago: null, pagos, valido };
  });

  constructor() {
    // Inicializa el método simple desde el valor inicial (una sola vez).
    effect(() => {
      const init = this.idMetodoPagoInicial();
      if (init != null && this.metodoSimple() === null && this.modo() === 'simple') {
        this.metodoSimple.set(init);
      }
    });

    // Propaga la selección al componente padre en cada cambio.
    effect(() => this.seleccionChange.emit(this.seleccion()));
  }

  protected onSelectChange(raw: string): void {
    if (raw === MULTI_VALUE) {
      this.modo.set('multi');
      if (this.filas().length < 2) {
        // Sembrar dos filas; la primera con el total para agilizar el cuadre.
        this.filas.set([
          { id_metodo_pago: null, valor: this.total() || null },
          { id_metodo_pago: null, valor: null },
        ]);
      }
      return;
    }
    this.modo.set('simple');
    this.metodoSimple.set(raw ? Number(raw) : null);
  }

  /**
   * Métodos disponibles para la fila `index`: excluye los ya elegidos en las
   * OTRAS filas (evita duplicar la misma forma de pago). El método propio de la
   * fila se conserva para que siga visible/seleccionado.
   */
  protected metodosDisponibles(index: number): MetodoPagoLite[] {
    const usadosEnOtras = new Set(
      this.filas()
        .filter((_, i) => i !== index)
        .map((f) => f.id_metodo_pago)
        .filter((id): id is number => id != null)
    );
    return this.metodos().filter((m) => !usadosEnOtras.has(m.id_metodo_pago));
  }

  protected agregarFila(): void {
    this.filas.update((f) => [...f, { id_metodo_pago: null, valor: null }]);
  }

  protected eliminarFila(index: number): void {
    this.filas.update((f) => f.filter((_, i) => i !== index));
  }

  protected setFilaMetodo(index: number, raw: string): void {
    const id = raw ? Number(raw) : null;
    this.filas.update((f) => f.map((row, i) => (i === index ? { ...row, id_metodo_pago: id } : row)));
  }

  protected setFilaValor(index: number, raw: string): void {
    const val = raw === '' ? null : Number(raw);
    this.filas.update((f) => f.map((row, i) => (i === index ? { ...row, valor: val } : row)));
  }

  /** Rellena esta fila con el monto restante para cuadrar el total. */
  protected usarRestante(index: number): void {
    this.filas.update((f) =>
      f.map((row, i) => {
        if (i !== index) return row;
        const otras = f.reduce(
          (acc, r, j) => acc + (j === index ? 0 : Number(r.valor) || 0),
          0
        );
        const falta = Math.round((this.total() - otras) * 100) / 100;
        return { ...row, valor: falta > 0 ? falta : null };
      })
    );
  }
}
