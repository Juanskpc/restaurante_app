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

import { DatosFactura, ModoFacturacion } from '../../../core/services/facturacion.service';

type TipoDocumento = DatosFactura['tipo_documento'];

export interface SeleccionFactura {
  /** `null` = sin datos: sale a consumidor final. */
  datos: DatosFactura | null;
  valido: boolean;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Factura a nombre de»: los datos del comprador en un cobro, para un negocio que factura.
 *
 * Apagado, la factura sale a consumidor final y no se pide nada: es lo normal en un restaurante.
 * Se enciende sola —y no se puede apagar— cuando el total supera el tope a partir del cual la
 * factura tiene que identificar al comprador.
 *
 * El dígito de verificación del NIT no se pide: lo calcula el servidor.
 */
@Component({
  selector: 'app-datos-factura',
  standalone: true,
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './datos-factura.html',
  styleUrl: './datos-factura.scss',
})
export class DatosFacturaComponent {
  readonly total = input<number>(0);
  readonly tope = input<number>(Number.POSITIVE_INFINITY);
  readonly modo = input<ModoFacturacion>('POS');
  readonly disabled = input<boolean>(false);
  /** Sin interruptor: los datos se piden siempre (para completar una factura que los espera). */
  readonly siempre = input<boolean>(false);

  readonly cambio = output<SeleccionFactura>();

  /** Lo que eligió la persona. `null` = todavía no tocó el interruptor: manda el modo del negocio. */
  private readonly elegido = signal<boolean | null>(null);

  protected readonly tipo = signal<TipoDocumento>('13');
  protected readonly numero = signal('');
  protected readonly nombre = signal('');
  protected readonly correo = signal('');
  protected readonly telefono = signal('');

  /** Por encima del tope los datos son obligatorios: el interruptor queda encendido y fijo. */
  readonly obligatorio = computed(() => this.siempre() || this.total() > this.tope());
  readonly encendido = computed(() => this.obligatorio() || (this.elegido() ?? this.modo() === 'COMPLETO'));
  protected readonly esEmpresa = computed(() => this.tipo() === '31');

  readonly datos = computed<DatosFactura | null>(() => {
    if (!this.encendido()) return null;
    const nombre = this.nombre().trim();
    return {
      tipo_persona: this.esEmpresa() ? '1' : '2',
      tipo_documento: this.tipo(),
      numero_documento: this.numero().trim(),
      ...(this.esEmpresa() ? { razon_social: nombre } : { nombres: nombre }),
      correo: this.correo().trim() || null,
      telefono: this.telefono().trim() || null,
    };
  });

  readonly valido = computed(() => {
    if (!this.encendido()) return true;
    const correo = this.correo().trim();
    return (
      this.numero().trim().replace(/[^0-9A-Za-z]/g, '').length >= 3 &&
      this.nombre().trim().length > 0 &&
      (correo === '' || CORREO.test(correo))
    );
  });

  protected readonly correoMal = computed(() => {
    const c = this.correo().trim();
    return c !== '' && !CORREO.test(c);
  });

  constructor() {
    effect(() => this.cambio.emit({ datos: this.datos(), valido: this.valido() }));
  }

  protected alternar(valor: boolean): void {
    if (this.obligatorio()) return;
    this.elegido.set(valor);
  }

  protected setTipo(valor: string): void {
    this.tipo.set(valor as TipoDocumento);
  }
}
