import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../environments/environment';
import { PaletaColor } from '../../../core/theme/palette.model';
import {
  ApiResponse,
  ConfiguracionNegocio,
  ConfiguracionNegocioPayload,
} from './configuracion.models';

@Injectable({ providedIn: 'root' })
export class ConfiguracionService {
  private readonly http = inject(HttpClient);

  getConfiguracion(idNegocio?: number | null): Observable<ConfiguracionNegocio> {
    let params = new HttpParams();
    if (idNegocio) {
      params = params.set('id_negocio', String(idNegocio));
    }

    return this.http
      .get<ApiResponse<ConfiguracionNegocio>>(`${environment.apiUrl}/configuracion`, { params })
      .pipe(map((res) => res.data));
  }

  updateConfiguracion(payload: ConfiguracionNegocioPayload): Observable<ConfiguracionNegocio> {
    return this.http
      .patch<ApiResponse<ConfiguracionNegocio>>(`${environment.apiUrl}/configuracion`, payload)
      .pipe(map((res) => res.data));
  }

  getPaletas(): Observable<PaletaColor[]> {
    return this.http
      .get<ApiResponse<PaletaColor[]>>(`${environment.apiUrl}/paletas`)
      .pipe(map((res) => res.data ?? []));
  }

  // ── Barrios con precio de domicilio ──
  listarBarrios(idNegocio: number): Observable<BarrioDomicilio[]> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http
      .get<ApiResponse<BarrioDomicilio[]>>(`${environment.apiUrl}/barrios-domicilio`, { params })
      .pipe(map((res) => res.data ?? []));
  }

  crearBarrio(idNegocio: number, nombre: string, valor: number): Observable<BarrioDomicilio> {
    return this.http
      .post<ApiResponse<BarrioDomicilio>>(`${environment.apiUrl}/barrios-domicilio`, {
        id_negocio: idNegocio,
        nombre,
        valor,
      })
      .pipe(map((res) => res.data));
  }

  actualizarBarrio(
    idBarrio: number,
    idNegocio: number,
    nombre: string,
    valor: number,
  ): Observable<BarrioDomicilio> {
    return this.http
      .put<ApiResponse<BarrioDomicilio>>(`${environment.apiUrl}/barrios-domicilio/${idBarrio}`, {
        id_negocio: idNegocio,
        nombre,
        valor,
      })
      .pipe(map((res) => res.data));
  }

  eliminarBarrio(idBarrio: number, idNegocio: number): Observable<unknown> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http.delete(`${environment.apiUrl}/barrios-domicilio/${idBarrio}`, { params });
  }

  // ── Métodos de pago ──
  listarMetodosPago(idNegocio: number, incluirInactivos = false): Observable<MetodoPago[]> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (incluirInactivos) params = params.set('incluir_inactivos', 'true');
    return this.http
      .get<ApiResponse<MetodoPago[]>>(`${environment.apiUrl}/metodos-pago`, { params })
      .pipe(map((res) => res.data ?? []));
  }

  crearMetodoPago(idNegocio: number, nombre: string): Observable<MetodoPago> {
    return this.http
      .post<ApiResponse<MetodoPago>>(`${environment.apiUrl}/metodos-pago`, { id_negocio: idNegocio, nombre })
      .pipe(map((res) => res.data));
  }

  /**
   * `codigoMedioPagoDian` solo viaja cuando se pasa: quien renombra una forma de pago no le
   * cambia —ni le borra— el tipo con el que sale en la factura.
   */
  actualizarMetodoPago(
    idMetodo: number,
    idNegocio: number,
    nombre: string,
    codigoMedioPagoDian?: string | null,
  ): Observable<MetodoPago> {
    return this.http
      .put<ApiResponse<MetodoPago>>(`${environment.apiUrl}/metodos-pago/${idMetodo}`, {
        id_negocio: idNegocio,
        nombre,
        ...(codigoMedioPagoDian !== undefined ? { codigo_medio_pago_dian: codigoMedioPagoDian } : {}),
      })
      .pipe(map((res) => res.data));
  }

  inactivarMetodoPago(idMetodo: number, idNegocio: number): Observable<MetodoPago> {
    return this.http
      .patch<ApiResponse<MetodoPago>>(
        `${environment.apiUrl}/metodos-pago/${idMetodo}/inactivar?id_negocio=${idNegocio}`, {}
      )
      .pipe(map((res) => res.data));
  }
}

export interface MetodoPago {
  id_metodo_pago: number;
  id_negocio: number;
  nombre: string;
  estado: 'A' | 'I';
  /** La forma de pago «Cuenta / Tiquetera». Ese dinero no está en el cajón. */
  es_cuenta?: boolean;
  /** Con qué tipo de pago sale en la factura electrónica (10 efectivo, 47 transferencia…). null = «otro». */
  codigo_medio_pago_dian?: string | null;
  fecha_creacion: string;
}

export interface BarrioDomicilio {
  id_barrio: number;
  nombre: string;
  valor: number;
}
