import {
  Component, inject, signal, computed,
  ChangeDetectionStrategy, OnInit, OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

// ============================================================
// Interfaces
// ============================================================

export type EstadoCocina = 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO' | 'ENTREGADO';

interface Exclusion {
  ingrediente: { id_ingrediente: number; nombre: string };
}

interface DetalleItem {
  id_detalle: number;
  cantidad: number;
  nota: string | null;
  estado: string;
  fecha_creacion: string;
  producto: { id_producto: number; nombre: string; icono: string };
  exclusiones: Exclusion[];
}

interface OrdenCocina {
  id_orden: number;
  numero_orden: string;
  mesaRef: { id_mesa: number; nombre: string; numero: number } | null;
  mesa: string | null;
  fecha_creacion: string;
  nota: string | null;
  estado_cocina: EstadoCocina;
  usuario: { id_usuario: number; primer_nombre: string; primer_apellido: string } | null;
  detalles: DetalleItem[];
}

/**
 * CocinaComponent — Kitchen Display System (KDS).
 * 
 * Kanban de 3 columnas: PENDIENTE → EN_PREPARACION → LISTO.
 * Se auto-refresca cada 30 s. Los timers reactivos se actualizan cada 30 s.
 * Notificación sonora al pasar una orden a LISTO.
 */
@Component({
  selector: 'app-cocina',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './cocina.html',
  styleUrl: './cocina.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CocinaComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly ordenes    = signal<OrdenCocina[]>([]);
  readonly cargando   = signal(false);
  readonly audioActivo = signal(true);

  /** Tick signal — actualizado cada 30 s para refrescar timers reactivamente. */
  readonly now = signal(Date.now());

  // ── Columnas del kanban (computed + ordenadas por tiempo) ──────────────────
  readonly ordenesPendientes = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'PENDIENTE')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  readonly ordenesPreparando = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'EN_PREPARACION')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  readonly ordenesListas = computed(() =>
    this.ordenes()
      .filter(o => o.estado_cocina === 'LISTO')
      .sort((a, b) => +new Date(a.fecha_creacion) - +new Date(b.fecha_creacion))
  );

  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  private get negocioId(): number | null {
    return this.auth.negocio()?.id_negocio ?? null;
  }

  ngOnInit(): void {
    this.loadOrdenes();
    this.refreshInterval = setInterval(() => this.loadOrdenes(), 30_000);
    this.tickInterval    = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.tickInterval)    clearInterval(this.tickInterval);
  }

  // ── Carga de datos ──────────────────────────────────────────────────────────

  loadOrdenes(): void {
    const id = this.negocioId;
    if (!id) return;
    this.cargando.set(true);
    this.http.get<{ success: boolean; data: OrdenCocina[] }>(
      `${environment.apiUrl}/cocina?id_negocio=${id}`
    ).subscribe({
      next: res => {
        this.ordenes.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => this.cargando.set(false),
    });
  }

  // ── Transiciones de estado KDS ──────────────────────────────────────────────

  cambiarEstado(orden: OrdenCocina, nuevoEstado: EstadoCocina): void {
    if (nuevoEstado === 'LISTO') this.playSound();
    this.http.patch(
      `${environment.apiUrl}/pedidos/${orden.id_orden}/estado-cocina`,
      { estado: nuevoEstado }
    ).subscribe({ next: () => this.loadOrdenes() });
  }

  // ── Timer y prioridad ───────────────────────────────────────────────────────

  /**
   * Calcula minutos transcurridos. Lee `this.now()` para que Angular 17+
   * re-evalúe el template cuando el tick cambia (OnPush reactivo).
   */
  getMinutos(fecha: string): number {
    this.now(); // dependency tracking
    return Math.floor((Date.now() - new Date(fecha).getTime()) / 60_000);
  }

  tiempoLabel(fecha: string): string {
    const m = this.getMinutos(fecha);
    if (m < 1) return '< 1 min';
    if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${m} min`;
  }

  timerClass(fecha: string): 'normal' | 'warning' | 'urgent' | 'critical' {
    const m = this.getMinutos(fecha);
    if (m < 5)  return 'normal';
    if (m < 10) return 'warning';
    if (m < 15) return 'urgent';
    return 'critical';
  }

  // ── Helpers de display ──────────────────────────────────────────────────────

  getNumeroMesa(orden: OrdenCocina): string {
    if (orden.mesaRef) return String(orden.mesaRef.numero);
    const raw = orden.mesa ?? '';
    const num = raw.replace(/\D/g, '');
    return num || raw.slice(0, 3).toUpperCase() || '—';
  }

  getNombreMesa(orden: OrdenCocina): string {
    return orden.mesaRef?.nombre ?? orden.mesa ?? '—';
  }

  getNombreMesero(orden: OrdenCocina): string {
    if (!orden.usuario) return '—';
    return `${orden.usuario.primer_nombre} ${orden.usuario.primer_apellido}`;
  }

  getExclusiones(detalle: DetalleItem): string[] {
    return detalle.exclusiones.map(e => e.ingrediente.nombre);
  }

  // ── Audio ───────────────────────────────────────────────────────────────────

  toggleAudio(): void {
    this.audioActivo.update(v => !v);
  }

  private playSound(): void {
    if (!this.audioActivo()) return;
    try {
      const ctx  = new AudioContext();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* audio no disponible */ }
  }

  trackOrden(_: number, orden: OrdenCocina): number {
    return orden.id_orden;
  }
}


