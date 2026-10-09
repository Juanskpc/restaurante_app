import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export type ModoFacturacion = 'NINGUNO' | 'POS' | 'COMPLETO';
export type EstadoDocumentoFe =
  | 'PENDIENTE_DATOS'
  | 'EN_COLA'
  | 'ENVIANDO'
  | 'ACEPTADO'
  | 'RECHAZADO'
  | 'ERROR'
  | 'ANULADO';

/** Lo que el servidor dice de la facturación electrónica de un negocio. */
export interface EstadoFe {
  activa: boolean;
  modo: ModoFacturacion;
  ambiente: 'PRUEBAS' | 'PRODUCCION' | null;
  /** Por encima de este total la factura tiene que llevar los datos del comprador (5 UVT). */
  tope_identificacion: number;
  motivo: string | null;
  medios_pago: { codigo: string; nombre: string }[];
  alertas: string[];
}

/** «Factura a nombre de»: lo que viaja en el cobro. El dígito de verificación lo calcula el servidor. */
export interface DatosFactura {
  tipo_persona: '1' | '2';
  tipo_documento: '13' | '22' | '31' | '41';
  numero_documento: string;
  razon_social?: string | null;
  nombres?: string | null;
  correo?: string | null;
  telefono?: string | null;
}

/** El resumen de la factura que devuelve un cobro. `null` si el negocio no factura. */
export interface FacturaResumen {
  id_documento: string;
  tipo: 'FV' | 'NC';
  estado: EstadoDocumentoFe;
  numero: string | null;
  cufe: string | null;
  url_publica: string | null;
  url_qr: string | null;
  mensaje: string;
}

/** Una fila de la pestaña «Facturas» de Caja. */
export interface DocumentoFe {
  id_documento: string;
  tipo: 'FV' | 'NC';
  estado: EstadoDocumentoFe;
  numero: string | null;
  origen_referencia: string | null;
  total: string | number;
  creado_en: string;
  ultimo_error: string | null;
  url_publica: string | null;
  comprador: string | null;
  consumidor_final: boolean;
  numero_factura_anulada: string | null;
}

interface Respuesta<T> {
  success: boolean;
  message?: string;
  data: T;
}

/**
 * La facturación electrónica vista desde el restaurante.
 *
 * El restaurante **no configura nada** aquí (eso lo hace EscalApp por negocio): solo pregunta si
 * está activa, manda «a nombre de quién» en el cobro y enseña los documentos en Caja.
 *
 * `activa()` es lo que decide si algo de esto se pinta. Para un negocio que no factura —casi
 * todos— es `false` y ninguna pantalla cambia.
 */
@Injectable({ providedIn: 'root' })
export class FacturacionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = `${environment.apiUrl}/facturacion`;

  private readonly _estado = signal<EstadoFe | null>(null);
  readonly estado = this._estado.asReadonly();
  readonly activa = computed(() => !!this._estado()?.activa);
  /** El negocio activó la facturación en sus datos fiscales, aunque todavía no esté emitiendo. */
  readonly configurable = computed(() => this.activa() || (this._estado()?.modo ?? 'NINGUNO') !== 'NINGUNO');
  readonly tope = computed(() => this._estado()?.tope_identificacion ?? Number.POSITIVE_INFINITY);

  constructor() {
    // Sigue al negocio activo: al cambiar de negocio en el selector de arriba, el estado del
    // anterior no puede quedarse pintando «Factura a nombre de» en uno que no factura.
    effect(() => {
      const id = this.auth.negocio()?.id_negocio ?? null;
      untracked(() => {
        this._estado.set(null);
        if (id) this.cargarEstado(id);
      });
    });
  }

  cargarEstado(idNegocio: number): void {
    this.http
      .get<Respuesta<EstadoFe>>(`${this.base}/estado`, { params: { id_negocio: idNegocio } })
      .subscribe({
        next: (r) => {
          if (this.auth.negocio()?.id_negocio === idNegocio) this._estado.set(r.data ?? null);
        },
        // Si la consulta falla, el negocio se trata como que no factura: el cobro no depende de esto.
        error: () => this._estado.set(null),
      });
  }

  listar(
    idNegocio: number,
    filtros: { desde?: string | null; hasta?: string | null; estado?: string | null } = {},
  ): Observable<DocumentoFe[]> {
    let params = new HttpParams().set('id_negocio', idNegocio);
    for (const [k, v] of Object.entries(filtros)) if (v) params = params.set(k, v);
    return this.http
      .get<Respuesta<DocumentoFe[]>>(`${this.base}/documentos`, { params })
      .pipe(map((r) => r.data ?? []));
  }

  /** El PDF como blob: va con la sesión, así que no sirve un enlace suelto. */
  pdf(idNegocio: number, idDocumento: string): Observable<Blob> {
    return this.http.get(`${this.base}/documentos/${idDocumento}/pdf`, {
      params: { id_negocio: idNegocio },
      responseType: 'blob',
    });
  }

  reintentar(idNegocio: number, idDocumento: string): Observable<FacturaResumen> {
    return this.http
      .post<Respuesta<FacturaResumen>>(`${this.base}/documentos/${idDocumento}/reintentar`, { id_negocio: idNegocio })
      .pipe(map((r) => r.data));
  }

  completarComprador(idNegocio: number, idDocumento: string, datos: DatosFactura): Observable<FacturaResumen> {
    return this.http
      .put<Respuesta<FacturaResumen>>(`${this.base}/documentos/${idDocumento}/comprador`, {
        id_negocio: idNegocio,
        ...datos,
      })
      .pipe(map((r) => r.data));
  }
}

/** El aviso que una pantalla de cobro enseña con el resultado de la factura. */
export function tonoDeFactura(f: FacturaResumen | null | undefined): 'success' | 'warning' | 'info' | null {
  if (!f) return null;
  if (f.estado === 'ACEPTADO') return 'success';
  if (f.estado === 'PENDIENTE_DATOS' || f.estado === 'RECHAZADO') return 'warning';
  return 'info';
}
