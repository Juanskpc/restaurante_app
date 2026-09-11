import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export type MesaCardStatus = 'available' | 'occupied' | 'payment' | 'disabled';

export interface MesaOrderItem {
  name: string;
  price: number;
  cantidad: number;
  nota?: string | null;
}

export interface MesaOrder {
  id_orden?: number;
  total: number;
  /** Rebaja ya restada del total; editable desde el cobro de la mesa. */
  descuento?: number;
  estado_pago?: string | null;
  id_metodo_pago?: number | null;
  /** Cuenta de cliente elegida al tomar el pedido (tiquetera o fiado). */
  id_cuenta?: number | null;
  /** Desglose de multipago elegido al tomar el pedido; editable antes de cobrar. */
  pagos?: { id_metodo_pago: number; valor: number }[];
  nota?: string | null;
  items: MesaOrderItem[];
}

export interface MesaDashboard {
  id_mesa: number;
  nombre: string;
  numero: number;
  capacidad: number;
  estado: 'A' | 'I';
  estado_servicio: 'DISPONIBLE' | 'OCUPADA' | 'POR_COBRAR';
  status: MesaCardStatus;
  time: string;
  order: MesaOrder;
}

export interface MesaBase {
  id_mesa: number;
  nombre: string;
  numero: number;
  capacidad: number;
  estado: 'A' | 'I';
  estado_servicio: 'DISPONIBLE' | 'OCUPADA' | 'POR_COBRAR';
}

@Injectable({ providedIn: 'root' })
export class MesasService {
  private readonly http = inject(HttpClient);

  getMesasDashboard(idNegocio: number): Observable<{ success: boolean; data: MesaDashboard[] }> {
    return this.http.get<{ success: boolean; data: MesaDashboard[] }>(
      `${environment.apiUrl}/mesas/dashboard?id_negocio=${idNegocio}`,
    );
  }

  crearMesa(payload: { id_negocio: number; nombre: string; numero?: number; capacidad?: number }): Observable<{ success: boolean; data: MesaBase }> {
    return this.http.post<{ success: boolean; data: MesaBase }>(`${environment.apiUrl}/mesas`, payload);
  }

  editarMesa(idMesa: number, payload: { nombre?: string; numero?: number; capacidad?: number }): Observable<{ success: boolean; data: MesaBase }> {
    return this.http.put<{ success: boolean; data: MesaBase }>(`${environment.apiUrl}/mesas/${idMesa}`, payload);
  }

  cambiarEstado(idMesa: number, estado: 'A' | 'I'): Observable<{ success: boolean; data: MesaBase }> {
    return this.http.patch<{ success: boolean; data: MesaBase }>(`${environment.apiUrl}/mesas/${idMesa}/estado`, { estado });
  }

  cambiarEstadoServicio(idMesa: number, estado_servicio: 'DISPONIBLE' | 'OCUPADA' | 'POR_COBRAR'): Observable<{ success: boolean; data: MesaBase }> {
    return this.http.patch<{ success: boolean; data: MesaBase }>(`${environment.apiUrl}/mesas/${idMesa}/estado-servicio`, { estado_servicio });
  }

  liberarMesa(idMesa: number): Observable<{ success: boolean; data: MesaBase }> {
    return this.http.patch<{ success: boolean; data: MesaBase }>(`${environment.apiUrl}/mesas/${idMesa}/liberar`, {});
  }

  cerrarOrden(
    idOrden: number,
    idMetodoPago?: number | null,
    pagos?: { id_metodo_pago: number; valor: number }[] | null,
    idCuenta?: number | null,
  ): Observable<{ success: boolean; data: unknown }> {
    // Multipago tiene prioridad; si no, se cierra con la forma de pago simple.
    // `id_cuenta` viaja cuando se paga con la tiquetera o el fiado de un cliente: el servidor
    // lo exige y no lo adivina, porque adivinarlo se lo descontaría a otra persona.
    const body = {
      ...(pagos && pagos.length > 0 ? { pagos } : { id_metodo_pago: idMetodoPago || null }),
      ...(idCuenta ? { id_cuenta: idCuenta } : {}),
    };
    return this.http.patch<{ success: boolean; data: unknown }>(
      `${environment.apiUrl}/pedidos/${idOrden}/cerrar`,
      body,
    );
  }

  actualizarDescuento(
    idOrden: number,
    idNegocio: number,
    descuento: number,
  ): Observable<{ success: boolean; data: { total?: number; descuento?: number } }> {
    return this.http.patch<{ success: boolean; data: { total?: number; descuento?: number } }>(
      `${environment.apiUrl}/pedidos/${idOrden}/descuento`,
      { id_negocio: idNegocio, descuento },
    );
  }

  listarMetodosPago(idNegocio: number): Observable<{ success: boolean; data: Array<{ id_metodo_pago: number; nombre: string }> }> {
    return this.http.get<{ success: boolean; data: Array<{ id_metodo_pago: number; nombre: string }> }>(
      `${environment.apiUrl}/metodos-pago?id_negocio=${idNegocio}`,
    );
  }
}
