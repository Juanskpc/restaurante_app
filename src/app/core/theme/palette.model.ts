// ============================================================
// Modelo de paleta de colores del negocio.
// Representa la configuración visual que elige el administrador.
// ============================================================

/** Definición de una paleta de colores (viene del backend). */
export interface PaletaColor {
  id_paleta: number;
  nombre: string;
  descripcion: string | null;
  /** Tokens de color — clave = nombre CSS custom property (sin --), valor = color */
  colores: PaletaColores;
  es_default: boolean;
  estado: 'A' | 'I';
}

/** Tokens de color que componen una paleta. */
export interface PaletaColores {
  // --- Colores principales ---
  'color-primary': string;
  'color-primary-hover': string;
  'color-on-primary': string;

  // --- Fondo y superficies ---
  'color-bg': string;
  'color-surface': string;
  'color-surface-elevated': string;

  // --- Texto ---
  'color-text-primary': string;
  'color-text-secondary': string;

  // --- Bordes ---
  'color-border': string;

  // --- Estados ---
  'color-success': string;
  'color-success-bg': string;
  'color-error': string;
  'color-error-bg': string;
  'color-warning': string;

  // --- Focus ---
  'color-focus': string;

  // Permite tokens adicionales personalizados
  [key: string]: string;
}

/** Relación negocio ↔ paleta seleccionada. */
export interface NegocioPaleta {
  id_negocio: number;
  id_paleta: number;
  paleta?: PaletaColor;
}
