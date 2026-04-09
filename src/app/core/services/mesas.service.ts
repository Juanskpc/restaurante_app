import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

export type MesaCardStatus = 'available' | 'occupied' | 'payment' | 'disabled';

export interface MesaOrderItem {
  name: string;
  price: number;
  cantidad: number;
}

export interface MesaOrder {
  id_orden?: number;
  total: number;
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

  crearMesa(payload: { id_negocio: number; nombre: string; numero: number; capacidad: number }): Observable<{ success: boolean; data: MesaBase }> {
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

  cerrarOrden(idOrden: number): Observable<{ success: boolean; data: unknown }> {
    return this.http.patch<{ success: boolean; data: unknown }>(`${environment.apiUrl}/pedidos/${idOrden}/cerrar`, {});
  }
}
