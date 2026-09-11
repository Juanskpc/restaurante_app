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
  /**
   * Es la forma de pago «Cuenta / Tiquetera». Se reconoce por esta marca y **nunca por el
   * nombre**: el negocio puede renombrarla desde Configuración.
   */
  es_cuenta?: boolean;
}

/** Una cuenta de cliente, lo justo para elegirla al cobrar. */
export interface CuentaLite {
  id_cuenta: number;
  cliente: string;
  modo: 'DINERO' | 'TIQUETES';
  saldo: number;
  total_tiquetes?: number;
}

/** Fila del desglose de multipago; admite filas a medio llenar. */
export interface FilaPago {
  id_metodo_pago: number | null;
  valor: number | null;
}

/** Resultado de la selección de forma(s) de pago. */
export interface PagoSeleccion {
  modo: 'simple' | 'multi';
  /** Método único (pago simple). null en multipago. */
  idMetodoPago: number | null;
  /** Desglose (multipago) con las filas completas. Vacío en pago simple. */
  pagos: { id_metodo_pago: number; valor: number }[];
  /**
   * Desglose EN CRUDO, incluidas las filas a medio llenar. El padre lo guarda
   * para poder devolverlo por `pagosIniciales` y así no perder lo escrito
   * cuando el selector se destruye y se vuelve a crear (p. ej. al cambiar de
   * pestaña En mesa / Para llevar / Domicilio).
   */
  filas: FilaPago[];
  /** ¿La selección está completa y cuadrada? */
  valido: boolean;
  /**
   * De quién es la cuenta, cuando se paga con «Cuenta / Tiquetera». `null` en los demás casos.
   *
   * El servidor lo exige y **no lo deduce** del teléfono del pedido: adivinarlo le descontaría
   * el almuerzo a otra persona.
   */
  idCuenta: number | null;
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
  /**
   * Desglose con el que arranca el selector: abre directamente en multipago con
   * estas filas. Sirve tanto para editar el desglose que ya trae un pedido
   * (Despacho, Mesas) como para restaurar lo escrito tras recrear el componente.
   */
  readonly pagosIniciales = input<FilaPago[]>([]);
  /**
   * Cuentas de cliente del negocio. Si está vacío, el selector de cliente no aparece aunque se
   * elija la forma de pago de cuenta — que es lo correcto para un negocio que no las usa.
   */
  readonly cuentas = input<CuentaLite[]>([]);
  /**
   * Cuenta con la que abre el selector: la que se eligió al tomar el pedido y quedó guardada
   * en él. Sin esto, cobrar una mesa volvía a preguntar de quién es la tiquetera aunque el
   * cajero ya lo hubiera dicho en el POS.
   */
  readonly idCuentaInicial = input<number | null>(null);

  /** Emite la selección actual cada vez que cambia. */
  readonly seleccionChange = output<PagoSeleccion>();

  protected readonly MULTI_VALUE = MULTI_VALUE;

  protected readonly modo = signal<'simple' | 'multi'>('simple');
  protected readonly metodoSimple = signal<number | null>(null);
  protected readonly filas = signal<FilaPago[]>([]);
  protected readonly cuentaElegida = signal<number | null>(null);

  /**
   * ¿El cobro va contra la cuenta de un cliente? Vale tanto en pago simple como dentro de un
   * desglose de multipago: una tiquetera que no alcanza se completa con efectivo, y ese caso
   * tiene que pedir el cliente igual.
   */
  protected readonly pagaConCuenta = computed(() => {
    const idCuentaPago = this.metodos().find((m) => m.es_cuenta)?.id_metodo_pago;
    if (!idCuentaPago) return false;

    if (this.modo() === 'multi') {
      return this.filas().some((f) => Number(f.id_metodo_pago) === idCuentaPago);
    }
    return this.metodoSimple() === idCuentaPago;
  });

  /** Lo que le queda al cliente elegido, para verlo antes de cobrar. */
  protected readonly resumenCuenta = computed(() => {
    const c = this.cuentas().find((x) => x.id_cuenta === this.cuentaElegida());
    if (!c) return '';
    if (c.modo === 'TIQUETES') {
      const n = c.total_tiquetes ?? 0;
      return n === 1 ? 'Le queda 1 tiquete' : `Le quedan ${n} tiquetes`;
    }
    if (c.saldo < 0) return `Debe $${Math.abs(c.saldo).toLocaleString('es-CO')}`;
    return `Tiene a favor $${c.saldo.toLocaleString('es-CO')}`;
  });

  /** Ya se aplicó el desglose inicial: no volver a pisar lo que edite el usuario. */
  private sembrado = false;

  protected readonly sumaMulti = computed(() =>
    this.filas().reduce((acc, f) => acc + (Number(f.valor) || 0), 0)
  );

  protected readonly restante = computed(() =>
    Math.round((this.total() - this.sumaMulti()) * 100) / 100
  );

  /** Selección expuesta al componente padre. */
  readonly seleccion = computed<PagoSeleccion>(() => {
    // Cobrar con una cuenta sin decir de quién es lo rechaza el servidor con un 422. Marcarlo
    // aquí como no válido hace que el botón de cobrar no deje llegar hasta ahí.
    const idCuenta = this.pagaConCuenta() ? this.cuentaElegida() : null;
    const faltaCuenta = this.pagaConCuenta() && idCuenta == null;

    if (this.modo() === 'simple') {
      const id = this.metodoSimple();
      return {
        modo: 'simple', idMetodoPago: id, pagos: [], filas: [],
        valido: id != null && !faltaCuenta, idCuenta,
      };
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
      filas.length >= 2 && completas.length === filas.length && totalCuadra && !faltaCuenta;

    return { modo: 'multi', idMetodoPago: null, pagos, filas, valido, idCuenta };
  });

  constructor() {
    // Arranca en multipago cuando llega un desglose inicial. Una sola vez por
    // instancia: después manda lo que edite el usuario, aunque el padre nos
    // devuelva por este mismo input las filas que acabamos de emitir.
    effect(() => {
      const iniciales = this.pagosIniciales();
      if (this.sembrado || iniciales.length === 0) return;
      this.sembrado = true;
      this.modo.set('multi');
      this.filas.set(
        iniciales.map((f) => ({
          id_metodo_pago: f.id_metodo_pago != null ? Number(f.id_metodo_pago) : null,
          valor: f.valor != null ? Number(f.valor) : null,
        }))
      );
    });

    // Siembra la cuenta guardada en el pedido. Una sola vez, y solo si el usuario no ha
    // elegido ya: después manda lo que él diga.
    effect(() => {
      const init = this.idCuentaInicial();
      if (init != null && this.cuentaElegida() === null) {
        this.cuentaElegida.set(Number(init));
      }
    });

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

  protected onCuentaChange(raw: string): void {
    this.cuentaElegida.set(raw ? Number(raw) : null);
  }

  protected onSelectChange(raw: string): void {
    // Desde que el usuario elige, manda su selección: ya no se siembra nada.
    this.sembrado = true;

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
