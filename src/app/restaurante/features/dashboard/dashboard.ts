import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

interface KpiCard {
  icon: string;
  label: string;
  value: string;
  trend: string;
  trendPositive: boolean;
  trendLabel: string;
}

interface RecentOrder {
  id: string;
  mesa: string;
  items: string;
  total: number;
  estado: 'pendiente' | 'preparando' | 'listo' | 'cobrado';
  hora: string;
}

interface DashboardResumenApi {
  kpis: {
    ventas_hoy: { valor: number; valor_ayer: number; tendencia: number };
    pedidos_hoy: { valor: number; valor_ayer: number; tendencia: number };
    ordenes_abiertas: { valor: number };
    mesas_ocupadas: { ocupadas: number; total: number; porcentaje: number };
    mesas_por_cobrar: { valor: number };
  };
  estado_cocina: { pendiente: number; en_preparacion: number; listo: number };
  ultimos_pedidos: RecentOrder[];
  ventas_por_hora: Array<{ hora: string; total: number }>;
}

/**
 * DashboardComponent — Vista principal del restaurante.
 *
 * Contiene:
 *  • 4 tarjetas KPI (ventas, pedidos, mesas, calificación)
 *  • Fila de gráficos (placeholders para charts reales)
 *  • Tabla de pedidos recientes
 */
@Component({
  selector: 'app-dashboard',
  imports: [LucideAngularModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly cargando = signal(false);
  readonly error = signal('');
  readonly resumen = signal<DashboardResumenApi | null>(null);

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly kpis = computed<KpiCard[]>(() => {
    const r = this.resumen();
    if (!r) return [];

    return [
      {
        icon: 'dollar-sign',
        label: 'Ventas del Día',
        value: this.formatMoney(r.kpis.ventas_hoy.valor),
        trend: `${r.kpis.ventas_hoy.tendencia}%`,
        trendPositive: r.kpis.ventas_hoy.tendencia >= 0,
        trendLabel: 'vs ayer',
      },
      {
        icon: 'receipt',
        label: 'Pedidos Hoy',
        value: String(r.kpis.pedidos_hoy.valor),
        trend: `${r.kpis.pedidos_hoy.tendencia}%`,
        trendPositive: r.kpis.pedidos_hoy.tendencia >= 0,
        trendLabel: 'vs ayer',
      },
      {
        icon: 'armchair',
        label: 'Mesas Ocupadas',
        value: `${r.kpis.mesas_ocupadas.ocupadas}/${r.kpis.mesas_ocupadas.total}`,
        trend: `${r.kpis.mesas_ocupadas.porcentaje}%`,
        trendPositive: true,
        trendLabel: 'ocupacion',
      },
      {
        icon: 'credit-card',
        label: 'Por Cobrar',
        value: String(r.kpis.mesas_por_cobrar.valor),
        trend: `${r.kpis.ordenes_abiertas.valor}`,
        trendPositive: true,
        trendLabel: 'ordenes abiertas',
      },
    ];
  });

  readonly recentOrders = computed(() => this.resumen()?.ultimos_pedidos ?? []);
  readonly ventasPorHora = computed(() => this.resumen()?.ventas_por_hora ?? []);
  readonly maxVentaHora = computed(() => {
    const values = this.ventasPorHora().map((h) => h.total);
    return values.length ? Math.max(...values, 1) : 1;
  });
  readonly cocina = computed(() => this.resumen()?.estado_cocina ?? {
    pendiente: 0,
    en_preparacion: 0,
    listo: 0,
  });

  private readonly negocioEffect = effect(() => {
    const idNegocio = this.negocioId();
    if (idNegocio) this.loadDashboard(idNegocio);
  });

  private loadDashboard(idNegocio: number): void {
    this.cargando.set(true);
    this.error.set('');

    this.http.get<{ success: boolean; data: DashboardResumenApi }>(
      `${environment.apiUrl}/dashboard/resumen?id_negocio=${idNegocio}`
    ).subscribe({
      next: (res) => {
        this.resumen.set(res?.data ?? null);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No se pudo cargar la informacion del dashboard.');
        this.cargando.set(false);
      },
    });
  }

  hourWidth(total: number): number {
    return Math.max(6, Math.round((total / this.maxVentaHora()) * 100));
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  /** Clase CSS según estado. */
  estadoClass(estado: string): string {
    const map: Record<string, string> = {
      pendiente: 'badge-muted',
      preparando: 'badge-warning',
      listo: 'badge-info',
      cobrado: 'badge-muted',
    };
    return map[estado] ?? '';
  }
}
