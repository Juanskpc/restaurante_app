import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Cómo lleva la cuenta este cliente: en plata o en tiquetes contados. */
export type ModoCuenta = 'DINERO' | 'TIQUETES';

export interface TiqueteDisponible {
  id_producto: number;
  producto: string;
  precio: number;
  disponibles: number;
}

export interface CuentaCliente {
  id_cuenta: number;
  id_persona_negocio: string;
  cliente: string;
  telefono: string | null;
  modo: ModoCuenta;
  cupo: number;
  estado: string;
  nota: string | null;
  /**
   * En pesos. **Positivo = tiene a favor** (pagó adelantado); **negativo = debe**.
   * En modo TIQUETES vale 0: lo que tiene son tiquetes, y el dinero ya entró a caja.
   */
  saldo: number;
  /** Solo en modo TIQUETES: cuántos le quedan de cada producto. */
  tiquetes?: TiqueteDisponible[];
  /** Lo que puede gastar hoy: saldo + cupo de fiado. `null` en modo TIQUETES. */
  disponible?: number | null;
  /** Los que le quedan. Se conserva por compatibilidad: es lo mismo que `tiquetes_restantes`. */
  total_tiquetes?: number;
  /** Solo en la lista y en modo TIQUETES: todos los que entraron (ventas y ajustes a favor). */
  tiquetes_comprados?: number;
  /** Solo en la lista y en modo TIQUETES: los que le quedan por comer. */
  tiquetes_restantes?: number;
  /** Solo en la lista: de qué productos lleva tiquetes, separados por coma. */
  productos?: string | null;
  ultimo_movimiento?: string | null;
}

export interface MovimientoCuenta {
  id_movimiento: number;
  tipo: 'ABONO' | 'CARGO';
  monto: number;
  tiquetes: number;
  concepto: string | null;
  fecha: string;
  id_orden: number | null;
  numero_orden: string | null;
  producto: string | null;
  primer_nombre: string | null;
  primer_apellido: string | null;
  metodo_pago: string | null;
  /** Lo que se pagó en caja por este apunte (en una tiquetera de tiquetes, el valor del paquete). */
  valor_pagado: number | null;
  anulado: boolean;
  id_movimiento_anula: number | null;
}

/** Lo que la cuenta puede pagar de un pedido concreto. */
export interface CoberturaCuenta {
  modo: ModoCuenta;
  monto_cubierto: number;
  tiquetes: Array<{ id_producto: number; producto: string; cantidad: number; valor: number }>;
  faltante: number;
  saldo: number;
  disponible: number | null;
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data?: T;
  errors?: { code?: string; [k: string]: unknown };
}

/**
 * ClientesService — cuentas de cliente: tiqueteras y fiado.
 *
 * Una tiquetera (paga adelantado) y un fiado (paga a fin de mes) son **la misma cuenta con el
 * signo cambiado**, por eso hay un solo servicio y no dos.
 *
 * Ojo con `cobertura()`: lo que devuelve es para **pintar**, no para decidir. El servidor
 * vuelve a calcular lo mismo al cobrar de verdad y rechaza lo que no cuadre — si no lo hiciera,
 * bastaría un navegador manipulado para fiarle a alguien por encima de su cupo.
 */
@Injectable({ providedIn: 'root' })
export class ClientesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/clientes`;

  listar(
    idNegocio: number,
    opciones: { busqueda?: string | null; filtro?: 'todos' | 'deben' | 'a_favor' } = {},
  ): Observable<ApiResponse<CuentaCliente[]>> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.busqueda) params = params.set('busqueda', opciones.busqueda);
    if (opciones.filtro) params = params.set('filtro', opciones.filtro);
    return this.http.get<ApiResponse<CuentaCliente[]>>(this.base, { params });
  }

  detalle(idCuenta: number, idNegocio: number): Observable<ApiResponse<CuentaCliente>> {
    return this.http.get<ApiResponse<CuentaCliente>>(
      `${this.base}/${idCuenta}?id_negocio=${idNegocio}`,
    );
  }

  movimientos(idCuenta: number, idNegocio: number): Observable<ApiResponse<MovimientoCuenta[]>> {
    return this.http.get<ApiResponse<MovimientoCuenta[]>>(
      `${this.base}/${idCuenta}/movimientos?id_negocio=${idNegocio}`,
    );
  }

  crear(payload: {
    id_negocio: number;
    nombre: string;
    telefono?: string | null;
    modo: ModoCuenta;
    cupo?: number;
    nota?: string | null;
  }): Observable<ApiResponse<CuentaCliente>> {
    return this.http.post<ApiResponse<CuentaCliente>>(this.base, payload);
  }

  actualizar(idCuenta: number, payload: {
    id_negocio: number;
    modo?: ModoCuenta;
    cupo?: number;
    estado?: string;
    nota?: string | null;
  }): Observable<ApiResponse<CuentaCliente>> {
    return this.http.put<ApiResponse<CuentaCliente>>(`${this.base}/${idCuenta}`, payload);
  }

  /**
   * Vender una tiquetera o recibir el pago de una cuenta. Entra plata a la caja.
   *
   * En una tiquetera por producto el `monto` es solo informativo: el servidor lo recalcula como
   * precio de la carta × cantidad − `descuento`, y es ese el que entra a la caja.
   */
  abonar(idCuenta: number, payload: {
    id_negocio: number;
    id_metodo_pago: number;
    monto?: number | null;
    tiquetes?: number;
    id_producto?: number | null;
    descuento?: number | null;
    concepto?: string | null;
  }): Observable<ApiResponse<CuentaCliente>> {
    return this.http.post<ApiResponse<CuentaCliente>>(`${this.base}/${idCuenta}/abonos`, payload);
  }

  /**
   * Quita la cuenta de la lista y del cobro. No borra su historial ni devuelve plata.
   * Exige el permiso `clientes_eliminar`, que se concede en Usuarios → Roles y permisos.
   */
  eliminar(idCuenta: number, idNegocio: number): Observable<ApiResponse<{
    id_cuenta: number;
    cliente: string;
    modo: ModoCuenta;
    saldo: number;
    tiquetes_restantes: number;
  }>> {
    return this.http.delete<ApiResponse<{
      id_cuenta: number;
      cliente: string;
      modo: ModoCuenta;
      saldo: number;
      tiquetes_restantes: number;
    }>>(`${this.base}/${idCuenta}?id_negocio=${idNegocio}`);
  }

  /** Mueve el saldo SIN que entre plata: perdonar una deuda, regalar un almuerzo. */
  ajustar(idCuenta: number, payload: {
    id_negocio: number;
    tipo: 'ABONO' | 'CARGO';
    monto?: number;
    tiquetes?: number;
    id_producto?: number | null;
    concepto: string;
  }): Observable<ApiResponse<CuentaCliente>> {
    return this.http.post<ApiResponse<CuentaCliente>>(`${this.base}/${idCuenta}/ajustes`, payload);
  }

  /** ¿Cuánto de este pedido puede pagar la cuenta? Solo para mostrarlo antes de cobrar. */
  cobertura(
    idCuenta: number,
    idNegocio: number,
    opciones: { idOrden?: number | null; total?: number | null } = {},
  ): Observable<ApiResponse<CoberturaCuenta>> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.idOrden) params = params.set('id_orden', String(opciones.idOrden));
    if (opciones.total != null) params = params.set('total', String(opciones.total));
    return this.http.get<ApiResponse<CoberturaCuenta>>(`${this.base}/${idCuenta}/cobertura`, { params });
  }
}
