import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, shareReplay, map, tap, finalize } from 'rxjs';

import { environment } from '../../../environments/environment';

/**
 * CatalogoCacheService — caché de datos de REFERENCIA del negocio.
 *
 * Cubre datos estables y de bajo cambio que hoy se re-piden en CADA entrada a
 * una vista (métodos de pago, domiciliarios, categorías de la carta). Antes,
 * navegar Pedidos → Despacho → Pedidos disparaba estas peticiones una y otra
 * vez aunque la respuesta no cambia entre vistas.
 *
 * Estrategia por clave:
 *  1. Estado en memoria (Map) con TTL → hit inmediato sin red.
 *  2. sessionStorage → sobrevive recargas de la pestaña (safe-SSR).
 *  3. Deduplicación de peticiones en vuelo (shareReplay) → dos vistas que
 *     piden lo mismo a la vez comparten una sola petición HTTP.
 *
 * Scope por `id_negocio` (multi-tenant): un cambio de negocio no reutiliza
 * el catálogo del anterior. TTL corto (5 min) como red de seguridad de
 * frescura; usar `invalidate()` tras mutaciones (editar carta / personal).
 *
 * NO cachear aquí datos críticos o de alta rotación: caja abierta, estado de
 * mesas, listas de despacho. Esos deben permanecer siempre frescos.
 */

interface CacheEntry<T> {
  data: T;
  ts: number;
  idNegocio: number;
}

const TTL_MS = 5 * 60 * 1000;
const STORAGE_PREFIX = 'catalogo_cache_v1:';

@Injectable({ providedIn: 'root' })
export class CatalogoCacheService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly mem = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Observable<unknown>>();

  // ---- API pública por catálogo ----

  metodosPago(idNegocio: number): Observable<Array<{ id_metodo_pago: number; nombre: string }>> {
    return this.get(`metodos-pago:${idNegocio}`, `${environment.apiUrl}/metodos-pago?id_negocio=${idNegocio}`, idNegocio);
  }

  domiciliarios(idNegocio: number): Observable<Array<{ id_usuario: number; nombre: string; telefono: string | null }>> {
    return this.get(`domiciliarios:${idNegocio}`, `${environment.apiUrl}/domiciliarios?id_negocio=${idNegocio}`, idNegocio);
  }

  categorias(idNegocio: number): Observable<unknown[]> {
    return this.get(`categorias:${idNegocio}`, `${environment.apiUrl}/carta/categorias?id_negocio=${idNegocio}`, idNegocio);
  }

  /**
   * Invalida entradas de caché. Llamar tras mutaciones que afecten a estos
   * catálogos (p. ej. editar la carta invalida 'categorias', gestionar personal
   * invalida 'domiciliarios'). `prefix` case-insensitive: 'categorias', etc.
   */
  invalidate(prefix?: string): void {
    for (const key of [...this.mem.keys()]) {
      if (!prefix || key.startsWith(prefix)) {
        this.mem.delete(key);
        this.removeStorage(key);
      }
    }
  }

  // ---- Núcleo ----

  private get<T>(key: string, url: string, idNegocio: number): Observable<T> {
    const cached = this.read<T>(key);
    if (cached && cached.idNegocio === idNegocio && Date.now() - cached.ts < TTL_MS) {
      return of(cached.data);
    }

    const pending = this.inflight.get(key) as Observable<T> | undefined;
    if (pending) return pending;

    const req$ = this.http.get<{ success: boolean; data: T }>(url).pipe(
      map((res) => (res?.data ?? ([] as unknown as T))),
      tap((data) => {
        // Un catálogo vacío NO se cachea. Es justo el caso de "acabo de crear el
        // primero y no aparece": guardar el [] lo esconde 5 minutos y, como la
        // caché vive en sessionStorage, ni recargar la página lo arregla.
        // Releer un catálogo vacío es barato; esconderlo sale caro.
        if (Array.isArray(data) && data.length === 0) return;
        this.write(key, { data, ts: Date.now(), idNegocio });
      }),
      finalize(() => this.inflight.delete(key)),
      shareReplay(1),
    );
    this.inflight.set(key, req$);
    return req$;
  }

  private read<T>(key: string): CacheEntry<T> | null {
    const inMem = this.mem.get(key) as CacheEntry<T> | undefined;
    if (inMem) return inMem;

    if (!this.isBrowser) return null;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      this.mem.set(key, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  private write<T>(key: string, entry: CacheEntry<T>): void {
    this.mem.set(key, entry);
    if (!this.isBrowser) return;
    try {
      window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
      // sessionStorage lleno / bloqueado → la caché en memoria sigue operando.
    }
  }

  private removeStorage(key: string): void {
    if (!this.isBrowser) return;
    try {
      window.sessionStorage.removeItem(STORAGE_PREFIX + key);
    } catch {
      // no-op
    }
  }
}
