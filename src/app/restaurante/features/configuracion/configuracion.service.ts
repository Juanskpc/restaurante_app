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
}
