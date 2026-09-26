import type { MesaCardStatus } from '../../../core/services/mesas.service';

/**
 * La acción principal de la tarjeta de una mesa: UN botón que dice qué va a pasar, en vez de
 * íconos sueltos. Depende del estado de la mesa y de si el rol puede ir al POS.
 *
 * - `tomar`  → mesa libre: abre el POS con la mesa elegida para empezar un pedido.
 * - `editar` → mesa con cuenta abierta: abre el POS con el pedido de la mesa cargado.
 * - `ver`    → mesa con cuenta abierta pero el rol NO puede editar: abre el detalle (solo lectura).
 */
export interface AccionMesa {
  tipo: 'tomar' | 'editar' | 'ver';
  /** Texto completo, para tarjetas con sitio. */
  largo: string;
  /** Texto corto, para las angostas: nunca se queda solo el ícono. */
  corto: string;
  icono: string;
}

export function accionPrincipalDe(status: MesaCardStatus, puedeIrAPedidos: boolean): AccionMesa | null {
  if (status === 'disabled') return null;

  if (status === 'available') {
    // Una mesa libre sin permiso para tomar pedidos no tiene nada que ofrecer.
    return puedeIrAPedidos
      ? { tipo: 'tomar', largo: 'Tomar pedido', corto: 'Pedido', icono: 'circle-plus' }
      : null;
  }

  return puedeIrAPedidos
    ? { tipo: 'editar', largo: 'Editar pedido', corto: 'Editar', icono: 'square-pen' }
    : { tipo: 'ver', largo: 'Ver pedido', corto: 'Ver', icono: 'eye' };
}
