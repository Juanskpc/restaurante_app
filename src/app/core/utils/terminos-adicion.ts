/**
 * Cómo llama el negocio a lo que se le agrega a un producto (`gener_negocio.termino_adiciones`).
 *
 * Solo cambia la PALABRA que se enseña; la función es la misma. Un restaurante dice «adición de
 * queso», una heladería «toppings».
 *
 * ⚠️ Copia de `admin_ws/app_core/helpers/terminosAdicion.js`: añadir un término = añadir la fila
 * en los dos sitios (el backend rechaza el código que no conozca).
 */
export interface TerminoAdicion {
  codigo: string;
  singular: string;
  plural: string;
}

export const TERMINOS_ADICION: readonly TerminoAdicion[] = [
  { codigo: 'ADICION', singular: 'Adición', plural: 'Adiciones' },
  { codigo: 'TOPPING', singular: 'Topping', plural: 'Toppings' },
  { codigo: 'EXTRA', singular: 'Extra', plural: 'Extras' },
  { codigo: 'AGREGADO', singular: 'Agregado', plural: 'Agregados' },
  { codigo: 'ACOMPANAMIENTO', singular: 'Acompañamiento', plural: 'Acompañamientos' },
  { codigo: 'COMPLEMENTO', singular: 'Complemento', plural: 'Complementos' },
  { codigo: 'INGREDIENTE_EXTRA', singular: 'Ingrediente extra', plural: 'Ingredientes extra' },
  { codigo: 'SALSA', singular: 'Salsa', plural: 'Salsas' },
];

/** El término de un código; el de por defecto («Adición») si no existe o no viene. */
export function terminoAdicion(codigo: string | null | undefined): TerminoAdicion {
  return TERMINOS_ADICION.find((t) => t.codigo === codigo) ?? TERMINOS_ADICION[0];
}
