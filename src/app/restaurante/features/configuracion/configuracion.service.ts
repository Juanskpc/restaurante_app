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

  /** `valor: null` = que use el de su zona (solo con `idZona`). */
  crearBarrio(
    idNegocio: number,
    nombre: string,
    valor: number | null,
    idZona: number | null = null,
  ): Observable<BarrioDomicilio> {
    return this.http
      .post<ApiResponse<BarrioDomicilio>>(`${environment.apiUrl}/barrios-domicilio`, {
        id_negocio: idNegocio,
        nombre,
        valor,
        id_zona_domicilio: idZona,
      })
      .pipe(map((res) => res.data));
  }

  /** `valor: null` = que use el de su comuna/corregimiento. */
  actualizarBarrio(
    idBarrio: number,
    idNegocio: number,
    nombre: string,
    valor: number | null,
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

  // ── Comunas / corregimientos (precio por zona) ──
  listarZonas(idNegocio: number): Observable<ZonasDomicilio> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http
      .get<ApiResponse<ZonasDomicilio>>(`${environment.apiUrl}/zonas-domicilio`, { params })
      .pipe(map((res) => res.data ?? { zonas: [], catalogos: [] }));
  }

  /** `aplicarATodos`: además les quita el precio propio a sus barrios (toda la zona a un precio). */
  actualizarZona(
    idZona: number,
    idNegocio: number,
    valor: number | null,
    aplicarATodos = false,
  ): Observable<{ igualados: number }> {
    return this.http
      .put<ApiResponse<{ igualados: number }>>(`${environment.apiUrl}/zonas-domicilio/${idZona}`, {
        id_negocio: idNegocio,
        valor,
        aplicar_a_todos: aplicarATodos,
      })
      .pipe(map((res) => res.data));
  }

  eliminarZona(idZona: number, idNegocio: number): Observable<unknown> {
    const params = new HttpParams().set('id_negocio', String(idNegocio));
    return this.http.delete(`${environment.apiUrl}/zonas-domicilio/${idZona}`, { params });
  }

  importarCatalogoBarrios(
    idNegocio: number,
    ciudad: string,
  ): Observable<{ zonas_nuevas: number; barrios_nuevos: number }> {
    return this.http
      .post<ApiResponse<{ zonas_nuevas: number; barrios_nuevos: number }>>(
        `${environment.apiUrl}/barrios-domicilio/catalogo`,
        { id_negocio: idNegocio, ciudad },
      )
      .pipe(map((res) => res.data));
  }

  /** Suma (o resta, negativo) `monto` a todos los precios de domicilio a la vez. */
  ajustarPreciosBarrios(
    idNegocio: number,
    monto: number,
  ): Observable<{ monto: number; zonas: number; barrios: number }> {
    return this.http
      .post<ApiResponse<{ monto: number; zonas: number; barrios: number }>>(
        `${environment.apiUrl}/barrios-domicilio/ajuste`,
        { id_negocio: idNegocio, monto },
      )
      .pipe(map((res) => res.data));
  }

  descargarPlantillaBarrios(idNegocio: number, ciudad: string | null): Observable<Blob> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (ciudad) params = params.set('ciudad', ciudad);
    return this.http.get(`${environment.apiUrl}/barrios-domicilio/plantilla`, {
      params,
      responseType: 'blob',
    });
  }

  subirPlantillaBarrios(idNegocio: number, archivo: File): Observable<ResumenPlantillaBarrios> {
    const datos = new FormData();
    datos.append('id_negocio', String(idNegocio));
    datos.append('archivo', archivo);
    return this.http
      .post<ApiResponse<ResumenPlantillaBarrios>>(
        `${environment.apiUrl}/barrios-domicilio/plantilla`,
        datos,
      )
      .pipe(map((res) => res.data));
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
  /** El precio propio; `null` = el de su zona. */
  valor: number | null;
  tipo?: 'BARRIO' | 'VEREDA';
  id_zona_domicilio?: number | null;
  zona?: string | null;
  /** Lo que se cobra: el propio o el de su zona. `null` = sin precio (no se ofrece). */
  valor_efectivo?: number | null;
}

/** Comuna o corregimiento del negocio, con su precio. */
export interface ZonaDomicilio {
  id_zona_domicilio: number;
  nombre: string;
  tipo: 'COMUNA' | 'CORREGIMIENTO';
  valor: number | null;
  barrios: number;
  con_precio_propio: number;
}

export interface ZonasDomicilio {
  zonas: ZonaDomicilio[];
  /** Las ciudades cuyo listado de barrios se puede cargar de una vez. */
  catalogos: Array<{ ciudad: string; zonas: number; lugares: number }>;
}

export interface ResumenPlantillaBarrios {
  zonas_creadas: number;
  zonas_actualizadas: number;
  barrios_creados: number;
  barrios_actualizados: number;
}
