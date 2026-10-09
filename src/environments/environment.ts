/**
 * Configuración de entorno — desarrollo.
 */
export const environment = {
  production: false,
  /** URL base del API de restaurante */
  apiUrl: 'http://localhost:3000/restaurante',
  /**
   * URL base del API de admin. Las Conversaciones del asistente viven ahí
   * (`/admin/intelligence/bandeja/*`) y no bajo `/restaurante`: el asistente es
   * cross-vertical —lo usan restaurante y reserva— y su API nunca colgó de un vertical.
   * El token es el mismo y el interceptor lo adjunta igual.
   */
  adminApiUrl: 'http://localhost:3000/admin',
  /** URL del admin_app para redirección de login */
  adminUrl: 'http://localhost:4002',
  /** URL base del menu digital */
  menuPublicoUrl: 'http://localhost:6002',
  /** Ruta base para assets (imágenes, etc.) */
  assetPath: '',
  /** WhatsApp de soporte (wa.me). Lo usa «Conectar WhatsApp» para pedir la alta gestionada. */
  whatsappUrl: 'https://wa.me/573114682492',
  /**
   * Meta: App ID y config ID del Registro insertado (Embedded Signup), para el SDK de JS de la
   * pantalla «Conectar WhatsApp». El config ID sale del checklist manual de
   * developers.facebook.com (ver `admin_ws/docs/embedded-signup.md` §1); no se automatiza.
   * Vacíos, el botón de «tu propio número» queda deshabilitado y solo se ofrece la alta gestionada.
   * Son los MISMOS valores que `admin_app_v21`: la app de Meta es una sola.
   */
  metaAppId: '1552342763052863',
  metaConfigId: '3007420636275811',
  /** Versión de la Graph API con la que se inicializa el SDK. v23.0 por la coexistencia. */
  metaSdkVersion: 'v23.0',
};
