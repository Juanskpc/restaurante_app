import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // Rutas protegidas → CSR (dependen del token/sesión del navegador)
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
