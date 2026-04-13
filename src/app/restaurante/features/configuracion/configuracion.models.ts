import { PaletaColor } from '../../../core/theme/palette.model';

export interface ConfiguracionNegocio {
  id_negocio: number;
  nombre: string;
  nit: string | null;
  email_contacto: string | null;
  telefono: string | null;
  id_tipo_negocio: number | null;
  tipo_negocio: string | null;
  id_paleta: number | null;
  paleta: PaletaColor | null;
  can_edit: boolean;
}

export interface ConfiguracionNegocioPayload {
  id_negocio: number;
  nombre?: string;
  nit?: string | null;
  email_contacto?: string | null;
  telefono?: string | null;
  id_paleta?: number | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
