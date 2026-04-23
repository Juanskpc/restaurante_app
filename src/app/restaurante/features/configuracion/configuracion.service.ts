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

  actualizarMetodoPago(idMetodo: number, idNegocio: number, nombre: string): Observable<MetodoPago> {
    return this.http
      .put<ApiResponse<MetodoPago>>(`${environment.apiUrl}/metodos-pago/${idMetodo}`, { id_negocio: idNegocio, nombre })
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
  fecha_creacion: string;
}
