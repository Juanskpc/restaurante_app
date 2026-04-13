import { Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';

import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/theme/theme.service';
import { environment } from '../../../environments/environment';

interface InventarioInsumoApi {
  id_ingrediente: number;
  nombre: string;
  unidad_medida: string | null;
  stock_actual: number;
}

interface InventarioResumenApi {
  insumos: InventarioInsumoApi[];
}

interface StockNotification {
  id_ingrediente: number;
  nombre: string;
  unidad_medida: string;
  stock_actual: number;
}

/**
 * HeaderComponent — Barra superior de la app.
 *
 * Muestra:
 *  • Título dinámico de la página
 *  • Selector de negocio / sede (si tiene más de uno)
 *  • Toggle de tema claro/oscuro
 *  • Campana de notificaciones
 */
@Component({
  selector: 'app-header',
  imports: [LucideAngularModule],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class HeaderComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly theme = inject(ThemeService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly notificationPollingMs = 60_000;
  private notificationsPollingSub: Subscription | null = null;

  /** Título mostrado. Puede sobreescribirse por la ruta activa. */
  readonly pageTitle = input<string>('Dashboard');

  /** Lista de negocios del usuario. */
  readonly negocios = computed(() => this.auth.negocios());

  /** Dropdown abierto. */
  readonly selectorOpen = signal(false);
  readonly notificationsOpen = signal(false);

  readonly stockNotifications = signal<StockNotification[]>([]);
  private readonly dismissedNotifications = signal<Record<number, true>>({});
  readonly stockNotificationsCount = computed(() => this.stockNotifications().length);

  constructor() {
    effect((onCleanup) => {
      const idNegocio = this.auth.negocio()?.id_negocio ?? null;

      this.closeNotifications();
      this.stockNotifications.set([]);
      this.dismissedNotifications.set({});

      if (!idNegocio) {
        this.stopNotificationsPolling();
        return;
      }

      this.startNotificationsPolling(idNegocio);
      onCleanup(() => this.stopNotificationsPolling());
    });
  }

  ngOnDestroy(): void {
    this.stopNotificationsPolling();
  }

  /** Fecha formateada (ej: "Jueves 10 de Julio, 2025"). */
  get formattedDate(): string {
    const now = new Date();
    return now.toLocaleDateString('es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  toggleTheme(): void {
    const current = this.theme.theme();
    this.theme.setTheme(current === 'dark' ? 'light' : 'dark');
  }

  toggleSelector(): void {
    const next = !this.selectorOpen();
    this.selectorOpen.set(next);
    if (next) {
      this.closeNotifications();
    }
  }

  selectNegocio(id: number): void {
    this.auth.setNegocioActivo(id);
    this.selectorOpen.set(false);
  }

  closeSelector(): void {
    this.selectorOpen.set(false);
  }

  toggleNotifications(): void {
    const next = !this.notificationsOpen();
    this.notificationsOpen.set(next);
    if (next) {
      this.selectorOpen.set(false);
    }
  }

  closeNotifications(): void {
    this.notificationsOpen.set(false);
  }

  verNotificacion(notificacion: StockNotification): void {
    this.closeNotifications();
    void this.router.navigate(['/inventario'], {
      queryParams: { insumo: notificacion.id_ingrediente },
    });
  }

  eliminarNotificacion(idIngrediente: number): void {
    this.dismissedNotifications.update((prev) => ({
      ...prev,
      [idIngrediente]: true,
    }));

    this.stockNotifications.update((rows) =>
      rows.filter((item) => item.id_ingrediente !== idIngrediente)
    );

    if (this.stockNotificationsCount() === 0) {
      this.closeNotifications();
    }
  }

  stockLabel(notificacion: StockNotification): string {
    return `Stock actual: ${notificacion.stock_actual} ${notificacion.unidad_medida}`;
  }

  private startNotificationsPolling(idNegocio: number): void {
    this.stopNotificationsPolling();

    this.notificationsPollingSub = timer(0, this.notificationPollingMs).pipe(
      switchMap(() =>
        this.http
          .get<{ success: boolean; data: InventarioResumenApi }>(
            `${environment.apiUrl}/inventario/resumen?id_negocio=${idNegocio}`
          )
          .pipe(catchError(() => of(null)))
      )
    ).subscribe((res) => {
      this.syncStockNotifications(res?.data?.insumos ?? []);
    });
  }

  private stopNotificationsPolling(): void {
    this.notificationsPollingSub?.unsubscribe();
    this.notificationsPollingSub = null;
  }

  private syncStockNotifications(insumos: InventarioInsumoApi[]): void {
    const sinStock = insumos
      .filter((insumo) => Number(insumo.stock_actual ?? 0) <= 0)
      .map((insumo) => ({
        id_ingrediente: insumo.id_ingrediente,
        nombre: insumo.nombre,
        unidad_medida: insumo.unidad_medida || 'und',
        stock_actual: Number(insumo.stock_actual ?? 0),
      }));

    const sinStockIds = new Set(sinStock.map((item) => item.id_ingrediente));
    const dismissed = this.dismissedNotifications();
    const dismissedActivos: Record<number, true> = {};

    Object.keys(dismissed).forEach((rawId) => {
      const id = Number(rawId);
      if (sinStockIds.has(id)) {
        dismissedActivos[id] = true;
      }
    });

    this.dismissedNotifications.set(dismissedActivos);

    this.stockNotifications.set(
      sinStock.filter((item) => !dismissedActivos[item.id_ingrediente])
    );

    if (this.stockNotificationsCount() === 0) {
      this.closeNotifications();
    }
  }
}
