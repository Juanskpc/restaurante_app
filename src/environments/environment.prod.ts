/**
 * Configuración de entorno — producción.
 * Backend servido vía Nginx reverse proxy con SSL en api.escalapp.cloud.
 * Frontend raíz: escalapp.cloud
 */
export const environment = {
  production: true,
  apiUrl: 'https://api.escalapp.cloud/restaurante',
  adminUrl: 'https://escalapp.cloud/admin',
};
