import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

import { environment } from '../../../environments/environment';

export interface CajaUsuario {
  id_usuario: number;
  primer_nombre: string;
  primer_apellido: string;
}

export interface Caja {
  id_caja: number;
  id_negocio: number;
  id_usuario: number;
  monto_apertura: number | null;
  monto_cierre?: number | null;
  monto_reportado?: number | null;
  diferencia?: number | null;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  estado: 'A' | 'C';
  observaciones?: string | null;
  usuario?: CajaUsuario | null;
  /** Calculados por el backend al consultar la caja abierta. */
  ingresos?: number | null;
  egresos?: number | null;
  monto_esperado?: number | null;
  ingresos_por_metodo?: Array<{ id_metodo_pago: number | null; nombre: string; total: number }>;
  /**
   * El backend vació las cifras porque el rol no tiene el subnivel
   * `caja_ver_ingresos`. El turno sigue llegando entero (id, usuario, fechas):
   * lo único que falta es el dinero.
   */
  importes_ocultos?: boolean;
}

export interface MovimientoCaja {
  id_movimiento: number;
  id_caja: number;
  tipo: 'INGRESO' | 'EGRESO';
  /** `null` cuando el rol no puede ver importes (ver `Caja.importes_ocultos`). */
  monto: number | null;
  concepto?: string | null;
  id_orden?: number | null;
  id_usuario: number;
  fecha: string;
  usuario?: CajaUsuario | null;
  orden?: { id_orden: number; numero_orden: string; tipo_pedido?: string | null; estado?: string | null } | null;
  /** La fila reversa a otro movimiento (es el compensatorio de una anulación). */
  es_anulacion?: boolean;
  /** A esta fila la reversó otra: el pedido fue eliminado, pero el registro queda. */
  anulado?: boolean;
  /** Egreso del pago al domiciliario: se etiqueta como Domicilio en el listado. */
  es_pago_domicilio?: boolean;
  id_movimiento_anula?: number | null;
}

export interface DomiciliarioResumen {
  id_domiciliario: number | null;
  domiciliario: string;
  total_pedidos: number;
  pedidos_adelantados: number;
  pedidos_cobrados: number;
  pedidos_en_posesion: number;
  monto_adelantado: number | null;
  monto_cobrado: number | null;
  monto_en_posesion: number | null;
}

export interface DomiciliariosResumen {
  resumen: {
    domiciliarios: number;
    total_pedidos: number;
    pedidos_adelantados: number;
    pedidos_cobrados: number;
    pedidos_en_posesion: number;
    monto_adelantado: number | null;
    monto_cobrado: number | null;
    monto_en_posesion: number | null;
  };
  rows: DomiciliarioResumen[];
}

/** Un turno ya cerrado, tal como lo lista el historial. */
export interface CajaHistorial {
  id_caja: number;
  fecha_apertura: string;
  fecha_cierre: string | null;
  estado: string;
  observaciones?: string | null;
  usuario: CajaUsuario;
  /** Todos los importes llegan en `null` si el rol no tiene `caja_ver_ingresos`. */
  monto_apertura: number | null;
  ingresos: number | null;
  egresos: number | null;
  monto_esperado: number | null;
  monto_reportado: number | null;
  diferencia: number | null;
  total_movimientos: number;
  importes_ocultos?: boolean;
}

export interface HistorialCajas {
  total: number;
  rows: CajaHistorial[];
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  errors?: { code?: string; [k: string]: unknown };
}

/**
 * CajaService — wrapper HTTP + estado reactivo de la caja del negocio activo.
 *
 * Mantiene un `cajaAbierta` signal que el resto de la app (pedidos, sidebar)
 * puede observar para bloquear acciones cuando no hay caja abierta.
 */
@Injectable({ providedIn: 'root' })
export class CajaService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/caja`;

  readonly cajaAbierta = signal<Caja | null>(null);
  readonly cargando = signal(false);
  readonly hayCajaAbierta = computed(() => this.cajaAbierta() !== null);

  /** Carga la caja abierta del negocio y actualiza el signal. */
  refrescar(idNegocio: number): Observable<ApiResponse<Caja | null>> {
    this.cargando.set(true);
    const req = this.http.get<ApiResponse<Caja | null>>(
      `${this.base}/abierta?id_negocio=${idNegocio}`,
    );
    return req.pipe(
      tap({
        next: (res) => {
          this.cajaAbierta.set(res?.data ?? null);
          this.cargando.set(false);
        },
        error: () => {
          this.cajaAbierta.set(null);
          this.cargando.set(false);
        },
      }),
    );
  }

  /** Limpia el estado al cambiar de negocio o al hacer logout. */
  reset(): void {
    this.cajaAbierta.set(null);
    this.cargando.set(false);
  }

  abrirCaja(payload: { id_negocio: number; monto_apertura: number; observaciones?: string | null; }): Observable<ApiResponse<Caja>> {
    return this.http.post<ApiResponse<Caja>>(`${this.base}/abrir`, payload).pipe(
      tap((res) => {
        if (res?.data) this.cajaAbierta.set(res.data);
      }),
    );
  }

  cerrarCaja(idCaja: number, payload: { id_negocio: number; monto_reportado?: number | null; observaciones?: string | null; }): Observable<ApiResponse<Caja>> {
    return this.http.put<ApiResponse<Caja>>(`${this.base}/${idCaja}/cerrar`, payload).pipe(
      tap(() => this.cajaAbierta.set(null)),
    );
  }

  getMovimientos(idCaja: number): Observable<ApiResponse<MovimientoCaja[]>> {
    return this.http.get<ApiResponse<MovimientoCaja[]>>(`${this.base}/${idCaja}/movimientos`);
  }

  /**
   * Turnos ya cerrados, del más reciente al más antiguo.
   * `desde`/`hasta` son fechas de pared (YYYY-MM-DD) y el rango incluye ambos días.
   */
  getHistorial(
    idNegocio: number,
    opciones: { desde?: string | null; hasta?: string | null; limite?: number; offset?: number } = {},
  ): Observable<ApiResponse<HistorialCajas>> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.desde) params = params.set('desde', opciones.desde);
    if (opciones.hasta) params = params.set('hasta', opciones.hasta);
    if (opciones.limite != null) params = params.set('limite', String(opciones.limite));
    if (opciones.offset != null) params = params.set('offset', String(opciones.offset));

    return this.http.get<ApiResponse<HistorialCajas>>(`${this.base}/historial`, { params });
  }

  /** Un turno concreto con sus totales y el desglose por forma de pago. */
  getDetalleCaja(idCaja: number, idNegocio: number): Observable<ApiResponse<Caja>> {
    return this.http.get<ApiResponse<Caja>>(
      `${this.base}/${idCaja}/detalle?id_negocio=${idNegocio}`,
    );
  }

  /** Elimina de la caja un pedido ya cobrado. No borra el historial: lo reversa. */
  anularPedido(idOrden: number, idNegocio: number): Observable<ApiResponse<{
    id_orden: number;
    numero_orden: string;
    movimientos_revertidos: number;
    monto_revertido: number;
  }>> {
    return this.http.post<ApiResponse<{
      id_orden: number;
      numero_orden: string;
      movimientos_revertidos: number;
      monto_revertido: number;
    }>>(`${this.base}/ordenes/${idOrden}/anular`, { id_negocio: idNegocio });
  }

  /** Devuelve a la caja un egreso (o un ingreso manual), dejándolo marcado. */
  anularMovimiento(idMovimiento: number, idNegocio: number): Observable<ApiResponse<{
    id_movimiento: number;
    tipo: 'INGRESO' | 'EGRESO';
    concepto?: string | null;
    monto: number;
  }>> {
    return this.http.post<ApiResponse<{
      id_movimiento: number;
      tipo: 'INGRESO' | 'EGRESO';
      concepto?: string | null;
      monto: number;
    }>>(`${this.base}/movimientos/${idMovimiento}/anular`, { id_negocio: idNegocio });
  }

  getDomiciliariosResumen(idNegocio: number): Observable<ApiResponse<DomiciliariosResumen>> {
    return this.http.get<ApiResponse<DomiciliariosResumen>>(
      `${this.base}/domiciliarios?id_negocio=${idNegocio}`,
    );
  }

  transferirDomiciliario(idNegocio: number, idDomiciliario: number): Observable<ApiResponse<{ total_pedidos: number; total_monto: number }>> {
    return this.http.post<ApiResponse<{ total_pedidos: number; total_monto: number }>>(
      `${this.base}/domiciliarios/transferir`,
      { id_negocio: idNegocio, id_domiciliario: idDomiciliario },
    );
  }

  registrarMovimiento(payload: {
    id_caja: number;
    tipo: 'INGRESO' | 'EGRESO';
    monto: number;
    concepto?: string | null;
  }): Observable<ApiResponse<MovimientoCaja>> {
    return this.http.post<ApiResponse<MovimientoCaja>>(`${this.base}/movimientos`, payload);
  }
}
