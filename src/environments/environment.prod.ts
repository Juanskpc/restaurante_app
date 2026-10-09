/**
 * Configuración de entorno — producción.
 * Backend servido vía Nginx reverse proxy con SSL en api.escalapp.cloud.
 * Frontend raíz: escalapp.cloud
 */
export const environment = {
  production: true,
  apiUrl: 'https://api.escalapp.cloud/restaurante',
  /** Ver el comentario de `environment.ts`: las Conversaciones cuelgan del API de admin. */
  adminApiUrl: 'https://api.escalapp.cloud/admin',
  adminUrl: 'https://escalapp.cloud/admin',
  menuPublicoUrl: 'https://escalapp.cloud/restaurante',
  assetPath: '/restaurante',
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
