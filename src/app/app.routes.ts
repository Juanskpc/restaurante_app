import { Routes } from '@angular/router';

import { authGuard, permissionGuard, planGuard } from './core/guards/auth.guard';
import { pendingChangesGuard } from './core/guards/pending-changes.guard';
import { LayoutComponent } from './layout/layout';
import { horariosEnConfiguracion } from './core/guards/horarios-en-configuracion.guard';

export const routes: Routes = [
  {
    path: 'auth/callback',
    title: 'Acceso',
    loadComponent: () =>
      import('./features/auth-callback/auth-callback').then(m => m.AuthCallbackComponent),
  },
  {
    path: 'carta/:id',
    title: 'Carta',
    loadComponent: () =>
      import('./restaurante/features/menu-publico').then(m => m.MenuPublicoComponent),
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    canActivateChild: [permissionGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        title: 'Dashboard',
        loadComponent: () =>
          import('./restaurante/features/dashboard/dashboard').then(m => m.DashboardComponent),
      },
      {
        path: 'pedidos',
        title: 'Pedidos',
        canActivate: [planGuard],
        canDeactivate: [pendingChangesGuard],
        loadComponent: () =>
          import('./restaurante/features/pedidos/pedidos').then(m => m.PedidosComponent),
      },
      {
        path: 'despacho',
        title: 'Despacho',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/despacho/despacho').then(m => m.DespachoComponent),
      },
      {
        path: 'cocina',
        title: 'Cocina',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/cocina/cocina').then(m => m.CocinaComponent),
      },
      {
        path: 'menu',
        title: 'Menú',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/menu/menu').then(m => m.MenuComponent),
      },
      {
        // El asistente de WhatsApp. Vivía en `admin_app_v21` hasta el 2026-10-08; allá queda
        // la misma vista, pero solo para super admin (seguimiento interno de los inquilinos).
        path: 'conversaciones',
        // Bajo «WhatsApp» en el menú, con Promociones al lado (`layout/secciones.ts`).
        title: 'WhatsApp',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./features/conversaciones/conversaciones').then(m => m.ConversacionesComponent),
      },
      {
        path: 'clientes',
        title: 'Clientes',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/clientes/clientes').then(m => m.ClientesComponent),
      },
      {
        // Transversal, como `conversaciones`: el backend ya sirve a reserva cambiando el
        // adaptador de hechos, así que la vista no vive dentro de `restaurante/`.
        path: 'promociones',
        title: 'WhatsApp',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./features/promociones/promociones').then(m => m.PromocionesComponent),
      },
      {
        path: 'mesas',
        title: 'Mesas',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/mesas/mesas').then(m => m.MesasComponent),
      },
      {
        path: 'inventario',
        title: 'Inventario',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/inventario/inventario').then(m => m.InventarioComponent),
      },
      {
        path: 'proveedores',
        // Una pestaña de Inventario (`layout/secciones.ts`).
        title: 'Inventario',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/proveedores/proveedores').then(m => m.ProveedoresComponent),
      },
      {
        // Horarios es una pestaña de Configuración (2026-10-13). La ruta sigue existiendo para
        // los enlaces guardados y para quien tenga Horarios sin Configuración: a los demás los
        // lleva a la pestaña.
        path: 'horarios',
        title: 'Configuración',
        canActivate: [planGuard, horariosEnConfiguracion],
        loadComponent: () =>
          import('./restaurante/features/horarios/horarios').then(m => m.HorariosComponent),
      },
      {
        path: 'usuarios',
        title: 'Usuarios',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/usuarios').then(m => m.UsuariosComponent),
      },
      {
        path: 'reportes',
        title: 'Reportes',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/reportes').then(m => m.ReportesComponent),
      },
      {
        path: 'caja',
        title: 'Caja',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/caja/caja').then(m => m.CajaComponent),
      },
      {
        path: 'sin-acceso',
        title: 'Sin acceso',
        loadComponent: () =>
          import('./restaurante/features/sin-acceso/sin-acceso').then(m => m.SinAccesoComponent),
      },
      {
        path: 'sin-plan',
        title: 'Plan requerido',
        loadComponent: () =>
          import('./restaurante/features/sin-plan/sin-plan').then(m => m.SinPlanComponent),
      },
      {
        path: 'configuracion',
        title: 'Configuración',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/configuracion').then(m => m.ConfiguracionComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
