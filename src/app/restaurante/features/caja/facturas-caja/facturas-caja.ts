import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import {
  DocumentoFe,
  EstadoDocumentoFe,
  FacturacionService,
  FacturaResumen,
  tonoDeFactura,
} from '../../../../core/services/facturacion.service';
import { RealtimeService } from '../../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import { DatosFacturaCambio, DatosFacturaComponent } from '../../../shared/datos-factura/datos-factura';

type Accion = 'pdf' | 'ver' | 'reintentar' | 'completar';

const ETIQUETA: Record<EstadoDocumentoFe, string> = {
  ACEPTADO: 'Aceptada',
  EN_COLA: 'En cola',
  ENVIANDO: 'Enviando',
  PENDIENTE_DATOS: 'Faltan datos',
  ERROR: 'Con error',
  RECHAZADO: 'Rechazada',
  ANULADO: 'Anulada',
};

/** El color de cada estado: verde lo que salió, ámbar lo que espera a una persona, rojo lo que falló. */
const TONO: Record<EstadoDocumentoFe, 'ok' | 'espera' | 'aviso' | 'mal' | 'neutro'> = {
  ACEPTADO: 'ok',
  EN_COLA: 'espera',
  ENVIANDO: 'espera',
  PENDIENTE_DATOS: 'aviso',
  ERROR: 'mal',
  RECHAZADO: 'mal',
  ANULADO: 'neutro',
};

/** Qué se puede hacer con un documento según su estado. */
export function accionesDe(d: Pick<DocumentoFe, 'estado' | 'url_publica'>): Accion[] {
  switch (d.estado) {
    case 'ACEPTADO':
      return d.url_publica ? ['pdf', 'ver'] : ['pdf'];
    case 'ERROR':
      return ['reintentar'];
    case 'RECHAZADO':
      return ['reintentar', 'completar'];
    case 'PENDIENTE_DATOS':
      return ['completar'];
    default:
      return [];
  }
}

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/**
 * La pestaña «Facturas» de Caja: los documentos electrónicos del negocio y lo que una persona
 * puede hacer con cada uno — ver el PDF, reintentar el que no salió, o ponerle los datos del
 * comprador al que los espera.
 *
 * Aquí no se anula nada: una factura se anula anulando el pedido, que es lo que dispara su nota
 * crédito.
 */
@Component({
  selector: 'app-facturas-caja',
  standalone: true,
  imports: [CurrencyPipe, DatePipe, LucideAngularModule, DatosFacturaComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './facturas-caja.html',
  styleUrl: './facturas-caja.scss',
})
export class FacturasCajaComponent implements OnDestroy {
  private readonly api = inject(FacturacionService);
  private readonly realtime = inject(RealtimeService);
  private readonly uiFeedback = inject(UiFeedbackService);

  readonly idNegocio = input.required<number>();

  protected readonly estados = Object.entries(ETIQUETA) as [EstadoDocumentoFe, string][];
  protected readonly alertas = computed(() => this.api.estado()?.alertas ?? []);

  protected readonly documentos = signal<DocumentoFe[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly desde = signal(hoy());
  protected readonly hasta = signal(hoy());
  protected readonly estado = signal<EstadoDocumentoFe | ''>('');

  /** El documento sobre el que hay una acción en curso. */
  protected readonly ocupado = signal<string | null>(null);
  /** El documento al que se le están completando los datos del comprador. */
  protected readonly completando = signal<string | null>(null);
  protected readonly comprador = signal<DatosFacturaCambio | null>(null);

  private readonly dejarDeEscuchar: () => void;

  constructor() {
    effect(() => {
      this.idNegocio();
      this.desde();
      this.hasta();
      this.estado();
      untracked(() => this.cargar());
    });
    // Cada cobro mueve la caja y puede traer una factura nueva: entra sola, sin recargar.
    this.dejarDeEscuchar = this.realtime.alCambiar(['caja', 'pedidos'], () => this.cargar(true));
  }

  ngOnDestroy(): void {
    this.dejarDeEscuchar();
  }

  protected cargar(silencioso = false): void {
    if (!silencioso) this.cargando.set(true);
    this.api
      .listar(this.idNegocio(), { desde: this.desde(), hasta: this.hasta(), estado: this.estado() || null })
      .subscribe({
        next: (lista) => {
          this.documentos.set(lista);
          this.error.set('');
          this.cargando.set(false);
        },
        error: (e) => {
          // En un refresco silencioso se conserva la lista que ya estaba.
          if (!silencioso) this.error.set(this.mensaje(e, 'No se pudieron cargar las facturas.'));
          this.cargando.set(false);
        },
      });
  }

  protected etiqueta = (e: EstadoDocumentoFe) => ETIQUETA[e];
  protected tono = (e: EstadoDocumentoFe) => TONO[e];
  protected acciones = accionesDe;
  protected puede = (d: DocumentoFe, a: Accion) => accionesDe(d).includes(a);

  protected verPdf(d: DocumentoFe): void {
    this.ocupado.set(d.id_documento);
    this.api.pdf(this.idNegocio(), d.id_documento).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        // El navegador ya tiene el documento abierto; se libera la referencia un rato después.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        this.ocupado.set(null);
      },
      error: () => {
        this.uiFeedback.warning('El PDF todavía no está disponible. Inténtalo en un momento.', 'Factura electrónica');
        this.ocupado.set(null);
      },
    });
  }

  protected reintentar(d: DocumentoFe): void {
    this.ocupado.set(d.id_documento);
    this.api.reintentar(this.idNegocio(), d.id_documento).subscribe({
      next: (f) => this.alTerminar(f),
      error: (e) => this.alFallar(e),
    });
  }

  protected abrirCompletar(d: DocumentoFe): void {
    this.comprador.set(null);
    this.completando.set(this.completando() === d.id_documento ? null : d.id_documento);
  }

  protected guardarComprador(d: DocumentoFe): void {
    const { datos, valido } = this.comprador() ?? { datos: null, valido: false };
    if (!datos || !valido) return;
    this.ocupado.set(d.id_documento);
    this.api.completarComprador(this.idNegocio(), d.id_documento, datos).subscribe({
      next: (f) => {
        this.completando.set(null);
        this.alTerminar(f);
      },
      error: (e) => this.alFallar(e),
    });
  }

  private alTerminar(f: FacturaResumen): void {
    const tono = tonoDeFactura(f);
    if (tono) this.uiFeedback[tono](f.mensaje, 'Factura electrónica');
    this.ocupado.set(null);
    this.cargar(true);
  }

  private alFallar(e: unknown): void {
    this.uiFeedback.error(this.mensaje(e, 'No se pudo completar la acción.'), 'Factura electrónica');
    this.ocupado.set(null);
  }

  private mensaje(e: unknown, defecto: string): string {
    return (e as HttpErrorResponse)?.error?.message || defecto;
  }
}
