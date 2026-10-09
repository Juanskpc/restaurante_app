import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../../environments/environment';
import {
  DisenoTiqueteGuardado,
  FuenteEjemplo,
} from '../../../shared/tiquete-diseno/tiquete-diseno';

export interface TiqueteDisenoAdmin extends FuenteEjemplo {
  diseno: {
    comun: DisenoTiqueteGuardado;
    electronica: DisenoTiqueteGuardado;
    actualizado_en: string | null;
  };
  /** `false`: el negocio nunca guardó y usa el tiquete por defecto. */
  personalizado: boolean;
  /** El plan incluye facturación electrónica. Sin ella el diseño se puede preparar igual. */
  facturacion_habilitada: boolean;
  can_edit: boolean;
}

interface Respuesta<T> {
  success: boolean;
  message: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class TiqueteDisenoService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/tiquete/diseno`;

  obtener(idNegocio: number): Observable<TiqueteDisenoAdmin> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http
      .get<Respuesta<TiqueteDisenoAdmin>>(this.base, { params })
      .pipe(map((res) => res.data));
  }

  guardar(
    idNegocio: number,
    comun: DisenoTiqueteGuardado,
    electronica: DisenoTiqueteGuardado,
  ): Observable<TiqueteDisenoAdmin> {
    return this.http
      .put<Respuesta<TiqueteDisenoAdmin>>(this.base, { id_negocio: idNegocio, comun, electronica })
      .pipe(map((res) => res.data));
  }
}
