import { PaletaColor } from '../../../core/theme/palette.model';

export interface ConfiguracionNegocio {
  id_negocio: number;
  nombre: string;
  nit: string | null;
  email_contacto: string | null;
  telefono: string | null;
  direccion: string | null;
  url_whatsapp: string | null;
  url_facebook: string | null;
  url_instagram: string | null;
  id_tipo_negocio: number | null;
  tipo_negocio: string | null;
  id_paleta: number | null;
  paleta: PaletaColor | null;
  permite_multipago: boolean;
  permite_pago_domicilio: boolean;
  permite_descuento: boolean;
  pregunta_cobro_envio: boolean;
  can_edit: boolean;
}

export interface ConfiguracionNegocioPayload {
  id_negocio: number;
  nombre?: string;
  nit?: string | null;
  email_contacto?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  url_whatsapp?: string | null;
  url_facebook?: string | null;
  url_instagram?: string | null;
  permite_multipago?: boolean;
  permite_pago_domicilio?: boolean;
  permite_descuento?: boolean;
  pregunta_cobro_envio?: boolean;
  id_paleta?: number | null;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}
