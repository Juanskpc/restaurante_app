import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../../environments/environment';
import { PaletaColor, PaletaColores } from './palette.model';

/**
 * PaletteService — Gestiona la paleta de colores dinámica del negocio.
 *
 * Responsabilidades:
 *  • Carga las paletas disponibles desde el backend.
 *  • Aplica los CSS custom properties de la paleta seleccionada en <html>.
 *  • Permite cambiar de paleta en tiempo real.
 *  • Persiste la elección del negocio (a través del backend).
 *
 * Las paletas vienen de la tabla general.gener_paleta_color.
 * El negocio está ligado a una paleta via general.gener_negocio.id_paleta.
 */

const PALETTE_STORAGE_KEY = 'negocio_palette_id';

@Injectable({ providedIn: 'root' })
export class PaletteService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);

  /** Lista de paletas disponibles (cargadas del backend). */
  readonly paletas = signal<PaletaColor[]>([]);

  /** Paleta actualmente aplicada. */
  readonly activePalette = signal<PaletaColor | null>(null);

  /** Indica si se está cargando. */
  readonly loading = signal(false);

  // ============================================================
  // API pública
  // ============================================================

  /**
   * Carga todas las paletas disponibles desde el backend.
   */
  async loadPaletas(): Promise<PaletaColor[]> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: PaletaColor[] }>(
          `${environment.apiUrl}/paletas`
        )
      );
      const paletas = res?.data ?? [];
      this.paletas.set(paletas);
      return paletas;
    } catch (err) {
      console.error('[PaletteService] Error cargando paletas:', err);
      return [];
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Aplica una paleta de colores al documento.
   * Inyecta las CSS custom properties directamente en <html>.
   *
   * @param paleta — Paleta a aplicar
   */
  applyPalette(paleta: PaletaColor): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const root = this.document.documentElement;
    const colores = paleta.colores;

    // Inyectar cada token como CSS custom property
    Object.entries(colores).forEach(([key, value]) => {
      root.style.setProperty(`--${key}`, value);
    });

    this.activePalette.set(paleta);

    // Persistir localmente para carga rápida
    localStorage.setItem(PALETTE_STORAGE_KEY, String(paleta.id_paleta));
  }

  /**
   * Carga y aplica la paleta de un negocio específico.
   *
   * @param idNegocio — ID del negocio
   */
  async loadAndApplyForNegocio(idNegocio: number): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: PaletaColor }>(
          `${environment.apiUrl}/negocios/${idNegocio}/paleta`
        )
      );
      if (res?.data) {
        this.applyPalette(res.data);
      }
    } catch (err) {
      console.error('[PaletteService] Error cargando paleta del negocio:', err);
      // Aplicar paleta default si está disponible
      this.applyDefaultPalette();
    }
  }

  /**
   * Guarda la paleta seleccionada para un negocio (persistencia en backend).
   *
   * @param idNegocio — ID del negocio
   * @param idPaleta — ID de la paleta elegida
   */
  async savePaletaForNegocio(idNegocio: number, idPaleta: number): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.patch(`${environment.apiUrl}/negocios/${idNegocio}/paleta`, {
          id_paleta: idPaleta,
        })
      );
      return true;
    } catch (err) {
      console.error('[PaletteService] Error guardando paleta:', err);
      return false;
    }
  }

  /**
   * Aplica la paleta marcada como default.
   */
  applyDefaultPalette(): void {
    const defaultPaleta = this.paletas().find(p => p.es_default);
    if (defaultPaleta) {
      this.applyPalette(defaultPaleta);
    }
  }

  /**
   * Restaura la última paleta usada (desde localStorage) sin consultar al backend.
   * Útil para evitar flash de contenido sin estilos.
   */
  restoreFromCache(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const cachedId = localStorage.getItem(PALETTE_STORAGE_KEY);
    if (cachedId) {
      const paleta = this.paletas().find(p => p.id_paleta === Number(cachedId));
      if (paleta) {
        this.applyPalette(paleta);
      }
    }
  }

  /**
   * Resetea los custom properties inyectados (vuelve al tema base del CSS).
   */
  resetPalette(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const root = this.document.documentElement;
    const current = this.activePalette();
    if (current) {
      Object.keys(current.colores).forEach(key => {
        root.style.removeProperty(`--${key}`);
      });
    }
    this.activePalette.set(null);
    localStorage.removeItem(PALETTE_STORAGE_KEY);
  }
}
