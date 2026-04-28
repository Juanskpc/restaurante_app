import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
  monto_apertura: number;
  monto_cierre?: number | null;
  monto_reportado?: number | null;
  diferencia?: number | null;
  fecha_apertura: string;
  fecha_cierre?: string | null;
  estado: 'A' | 'C';
  observaciones?: string | null;
  usuario?: CajaUsuario | null;
  /** Calculados por el backend al consultar la caja abierta. */
  ingresos?: number;
  egresos?: number;
  monto_esperado?: number;
  ingresos_por_metodo?: Array<{ id_metodo_pago: number | null; nombre: string; total: number }>;
}

export interface MovimientoCaja {
  id_movimiento: number;
  id_caja: number;
  tipo: 'INGRESO' | 'EGRESO';
  monto: number;
  concepto?: string | null;
  id_orden?: number | null;
  id_usuario: number;
  fecha: string;
  usuario?: CajaUsuario | null;
  orden?: { id_orden: number; numero_orden: string } | null;
}

interface ApiResponse<T> {
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

  registrarMovimiento(payload: {
    id_caja: number;
    tipo: 'INGRESO' | 'EGRESO';
    monto: number;
    concepto?: string | null;
  }): Observable<ApiResponse<MovimientoCaja>> {
    return this.http.post<ApiResponse<MovimientoCaja>>(`${this.base}/movimientos`, payload);
  }
}
