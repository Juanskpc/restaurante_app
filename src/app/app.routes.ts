import { Routes } from '@angular/router';

import { authGuard, permissionGuard, planGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './layout/layout';

export const routes: Routes = [
  {
    path: 'auth/callback',
    title: 'Acceso',
    loadComponent: () =>
      import('./features/auth-callback/auth-callback').then(m => m.AuthCallbackComponent),
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
        title: 'Configuracion',
        canActivate: [planGuard],
        loadComponent: () =>
          import('./restaurante/features/configuracion').then(m => m.ConfiguracionComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
