import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { environment } from '../../../../../environments/environment';
import { DisenoCarta, EstadisticasCarta } from '../../../shared/carta-diseno/carta-diseno';

export interface DisenoAdmin {
  diseno: DisenoCarta & { publicado_en: string | null };
  /** `false`: el negocio nunca publicó y usa la carta por defecto. */
  personalizado: boolean;
  negocio: {
    id_negocio: number;
    nombre: string;
    logo_url: string | null;
    url_whatsapp: string | null;
    color_negocio: string | null;
  };
  caracteristicas: {
    id_plan: number | null;
    carta_whatsapp: boolean;
    carta_color_libre: boolean;
    carta_plantillas: '*' | string[];
  };
  estadisticas: EstadisticasCarta;
  can_edit: boolean;
}

interface Respuesta<T> {
  success: boolean;
  message: string;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class CartaDisenoService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/carta/diseno`;

  obtener(idNegocio: number): Observable<DisenoAdmin> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http
      .get<Respuesta<DisenoAdmin>>(this.base, { params })
      .pipe(map((res) => res.data));
  }

  publicar(idNegocio: number, diseno: DisenoCarta): Observable<DisenoAdmin> {
    return this.http
      .put<Respuesta<DisenoAdmin>>(this.base, { id_negocio: idNegocio, ...diseno })
      .pipe(map((res) => res.data));
  }

  subirLogo(idNegocio: number, imagen: Blob): Observable<{ logo_url: string }> {
    const formData = new FormData();
    // El id va antes que el archivo: el validador del servidor lo lee del mismo cuerpo multipart.
    formData.append('id_negocio', String(idNegocio));
    formData.append('imagen', imagen, `logo.${imagen.type === 'image/webp' ? 'webp' : 'jpg'}`);
    return this.http
      .post<Respuesta<{ logo_url: string }>>(`${this.base}/logo`, formData)
      .pipe(map((res) => res.data));
  }

  eliminarLogo(idNegocio: number): Observable<{ logo_url: null }> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http
      .delete<Respuesta<{ logo_url: null }>>(`${this.base}/logo`, { params })
      .pipe(map((res) => res.data));
  }
}
