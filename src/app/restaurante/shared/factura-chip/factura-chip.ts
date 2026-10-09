import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

import {
  DatosFactura,
  FacturaSolicitada,
  FacturacionService,
  esFacturaAnonima,
} from '../../../core/services/facturacion.service';
import { DatosFacturaCambio, DatosFacturaComponent } from '../datos-factura/datos-factura';

/** La factura pedida para un cobro. `datos: null` = este cobro no se factura. */
export interface SeleccionFactura {
  datos: FacturaSolicitada | null;
  valido: boolean;
}

export const SIN_FACTURA: SeleccionFactura = { datos: null, valido: true };
const ANONIMA: SeleccionFactura = { datos: { consumidor_final: true }, valido: true };

type Pestana = 'cliente' | 'anonima';

/**
 * «Factura electrónica»: el interruptor con el que el cajero decide si ESTE cobro se factura.
 *
 * No todos los cobros se facturan: un negocio con un paquete pequeño de documentos factura solo
 * al cliente que la pide. Marcar la casilla abre una ventana con dos caminos:
 *   · **Con datos del cliente** (por defecto): documento, nombre y correo.
 *   · **Anónima**: a consumidor final, sin datos. No vale por encima del tope legal.
 *
 * Es un componente **controlado**: lo elegido vive en quien lo contiene (`valor`) y aquí solo se
 * edita. Así sobrevive cuando la pantalla lo destruye y lo vuelve a crear al cambiar de
 * «En mesa» a «Para llevar».
 */
@Component({
  selector: 'app-factura-chip',
  standalone: true,
  imports: [CurrencyPipe, LucideAngularModule, DatosFacturaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './factura-chip.html',
  styleUrl: './factura-chip.scss',
  host: { '(document:keydown.escape)': 'cerrar()' },
})
export class FacturaChipComponent {
  private readonly facturacion = inject(FacturacionService);

  readonly valor = input<SeleccionFactura>(SIN_FACTURA);
  readonly total = input<number>(0);
  readonly disabled = input<boolean>(false);

  readonly cambio = output<SeleccionFactura>();

  protected readonly tope = this.facturacion.tope;
  /** El negocio factura todos sus cobros: aquí la casilla no se puede quitar, solo cambiar a nombre de quién. */
  protected readonly siempre = this.facturacion.facturarTodo;

  protected readonly abierto = signal(false);
  protected readonly pestana = signal<Pestana>('cliente');
  /** Lo que hay escrito en el formulario del modal, todavía sin aplicar. */
  protected readonly borrador = signal<DatosFacturaCambio | null>(null);

  protected readonly marcada = computed(() => this.valor().datos !== null);
  protected readonly anonima = computed(() => esFacturaAnonima(this.valor().datos));
  /** Por encima del tope la factura tiene que identificar al comprador. */
  protected readonly superaTope = computed(() => this.total() > this.tope());
  /** Una anónima que ya no vale porque el pedido creció por encima del tope. */
  protected readonly anonimaInvalida = computed(() => this.anonima() && this.superaTope());

  /** A nombre de quién, para leerlo en el chip sin abrir la ventana. */
  protected readonly resumen = computed(() => {
    const d = this.valor().datos;
    if (!d) return '';
    if (esFacturaAnonima(d)) return 'Anónima';
    return d.razon_social || d.nombres || d.numero_documento;
  });

  /** Los datos del cliente ya aplicados, para que el formulario abra con ellos. */
  protected readonly datosCliente = computed<DatosFactura | null>(() => {
    const d = this.valor().datos;
    return d && !esFacturaAnonima(d) ? d : null;
  });

  protected readonly puedeGuardar = computed(() =>
    this.pestana() === 'anonima' ? !this.superaTope() : this.borrador()?.valido === true,
  );

  constructor() {
    // En un negocio que factura todo, un cobro sin elegir nada sale anónimo: se refleja desde ya.
    effect(() => {
      if (this.siempre() && this.valor().datos === null) untracked(() => this.cambio.emit(ANONIMA));
    });
  }

  protected alternar(marcar: boolean): void {
    if (this.disabled()) return;
    if (marcar) {
      this.abrir();
    } else if (!this.siempre()) {
      this.cambio.emit(SIN_FACTURA);
    }
  }

  protected abrir(): void {
    if (this.disabled()) return;
    // Abre donde estaba; si es la primera vez, en los datos del cliente, que es lo habitual.
    this.pestana.set(this.anonima() && !this.superaTope() ? 'anonima' : 'cliente');
    this.borrador.set(null);
    this.abierto.set(true);
  }

  protected cerrar(): void {
    this.abierto.set(false);
  }

  protected guardar(): void {
    if (!this.puedeGuardar()) return;
    if (this.pestana() === 'anonima') {
      this.cambio.emit(ANONIMA);
    } else {
      this.cambio.emit({ datos: this.borrador()!.datos, valido: true });
    }
    this.abierto.set(false);
  }
}
