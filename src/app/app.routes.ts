import { Routes } from '@angular/router';

import { authGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './layout/layout';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
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
      // { path: 'reportes',       loadComponent: () => import('./restaurante/features/reportes/reportes').then(m => m.ReportesComponent) },
      // { path: 'configuracion',  loadComponent: () => import('./restaurante/features/configuracion/configuracion').then(m => m.ConfiguracionComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
