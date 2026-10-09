import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { DatosFactura } from '../../../core/services/facturacion.service';

type TipoDocumento = DatosFactura['tipo_documento'];

/** Los datos del cliente tal como están escritos, y si ya sirven para facturar. */
export interface DatosFacturaCambio {
  datos: DatosFactura;
  valido: boolean;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Los datos del cliente para una factura a su nombre: documento, nombre o razón social, y a
 * dónde enviársela.
 *
 * Es solo el formulario. Quién decide si se piden —y cuándo— es quien lo contiene: el modal de
 * «Factura electrónica» en el cobro, o la fila de una factura que espera datos en Caja.
 *
 * El dígito de verificación del NIT no se pide: lo calcula el servidor.
 */
@Component({
  selector: 'app-datos-factura',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './datos-factura.html',
  styleUrl: './datos-factura.scss',
})
export class DatosFacturaComponent {
  readonly disabled = input<boolean>(false);
  /** Con qué abre el formulario: los datos que ya se habían puesto, para corregirlos. */
  readonly inicial = input<DatosFactura | null>(null);

  readonly cambio = output<DatosFacturaCambio>();

  protected readonly tipo = signal<TipoDocumento>('13');
  protected readonly numero = signal('');
  protected readonly nombre = signal('');
  protected readonly correo = signal('');
  protected readonly telefono = signal('');

  protected readonly esEmpresa = computed(() => this.tipo() === '31');

  readonly datos = computed<DatosFactura>(() => {
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
    // Siembra los datos que ya había. Solo cuando cambia `inicial`: después manda lo que se escriba.
    effect(() => {
      const d = this.inicial();
      if (!d) return;
      untracked(() => {
        this.tipo.set(d.tipo_documento);
        this.numero.set(d.numero_documento ?? '');
        this.nombre.set(d.razon_social ?? d.nombres ?? '');
        this.correo.set(d.correo ?? '');
        this.telefono.set(d.telefono ?? '');
      });
    });
    effect(() => this.cambio.emit({ datos: this.datos(), valido: this.valido() }));
  }

  protected setTipo(valor: string): void {
    this.tipo.set(valor as TipoDocumento);
  }
}
