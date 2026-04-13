import { Routes } from '@angular/router';

import { authGuard, permissionGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './layout/layout';

export const routes: Routes = [
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
        loadComponent: () =>
          import('./restaurante/features/pedidos/pedidos').then(m => m.PedidosComponent),
      },
      {
        path: 'cocina',
        title: 'Cocina',
        loadComponent: () =>
          import('./restaurante/features/cocina/cocina').then(m => m.CocinaComponent),
      },
      {
        path: 'menu',
        title: 'Menú',
        loadComponent: () =>
          import('./restaurante/features/menu/menu').then(m => m.MenuComponent),
      },
      {
        path: 'mesas',
        title: 'Mesas',
        loadComponent: () =>
          import('./restaurante/features/mesas/mesas').then(m => m.MesasComponent),
      },
      {
        path: 'inventario',
        title: 'Inventario',
        loadComponent: () =>
          import('./restaurante/features/inventario/inventario').then(m => m.InventarioComponent),
      },
      {
        path: 'usuarios',
        title: 'Usuarios',
        loadComponent: () =>
          import('./restaurante/features/usuarios').then(m => m.UsuariosComponent),
      },
      {
        path: 'reportes',
        title: 'Reportes',
        loadComponent: () =>
          import('./restaurante/features/reportes').then(m => m.ReportesComponent),
      },
      {
        path: 'sin-acceso',
        title: 'Sin acceso',
        loadComponent: () =>
          import('./restaurante/features/sin-acceso/sin-acceso').then(m => m.SinAccesoComponent),
      },
      {
        path: 'configuracion',
        title: 'Configuracion',
        loadComponent: () =>
          import('./restaurante/features/configuracion').then(m => m.ConfiguracionComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
