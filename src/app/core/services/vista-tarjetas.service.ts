import { Injectable, PLATFORM_ID, Signal, WritableSignal, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Tamaños de tarjeta que rota el botón de vista en Mesas y Despacho. */
export type DensidadTarjeta = 'normal' | 'compacta' | 'mini';

const CICLO: DensidadTarjeta[] = ['normal', 'compacta', 'mini'];
const STORAGE_PREFIX = 'vista_tarjetas_v1';

interface VistaGuardada {
  densidad?: DensidadTarjeta;
  verProductos?: boolean;
}

/**
 * Preferencias visuales de las rejillas de tarjetas (Mesas y Despacho):
 * qué tan grandes se ven y si muestran los productos del pedido sin abrir el detalle.
 *
 * Son preferencias del dispositivo, no del negocio: cada equipo del local tiene una
 * pantalla distinta y el mesero elige el tamaño que le sirve. Por eso viven en
 * localStorage y no en la BD. Arrancan siempre en 'normal' + productos ocultos, que es
 * exactamente como se ve la app hoy: quien no toque el botón no nota ningún cambio.
 */
@Injectable({ providedIn: 'root' })
export class VistaTarjetasService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly densidades = new Map<string, WritableSignal<DensidadTarjeta>>();
  private readonly productos = new Map<string, WritableSignal<boolean>>();

  /** Tamaño actual de las tarjetas del módulo. */
  densidad(modulo: string): Signal<DensidadTarjeta> {
    return this.densidadSignal(modulo).asReadonly();
  }

  /** ¿Se muestran los productos dentro de la tarjeta? */
  verProductos(modulo: string): Signal<boolean> {
    return this.verProductosSignal(modulo).asReadonly();
  }

  /** Avanza al siguiente tamaño: normal → compacta → mini → normal. */
  rotarDensidad(modulo: string): void {
    const actual = this.densidadSignal(modulo);
    const siguiente = CICLO[(CICLO.indexOf(actual()) + 1) % CICLO.length];
    actual.set(siguiente);
    this.persistir(modulo);
  }

  setVerProductos(modulo: string, valor: boolean): void {
    this.verProductosSignal(modulo).set(valor);
    this.persistir(modulo);
  }

  // ── Interno ──

  private densidadSignal(modulo: string): WritableSignal<DensidadTarjeta> {
    this.hidratar(modulo);
    return this.densidades.get(modulo)!;
  }

  private verProductosSignal(modulo: string): WritableSignal<boolean> {
    this.hidratar(modulo);
    return this.productos.get(modulo)!;
  }

  /** Crea las señales del módulo la primera vez, leyendo lo que haya guardado. */
  private hidratar(modulo: string): void {
    if (this.densidades.has(modulo)) return;

    const guardado = this.leer(modulo);
    this.densidades.set(
      modulo,
      signal<DensidadTarjeta>(
        guardado?.densidad && CICLO.includes(guardado.densidad) ? guardado.densidad : 'normal'
      )
    );
    this.productos.set(modulo, signal<boolean>(guardado?.verProductos === true));
  }

  private clave(modulo: string): string {
    return `${STORAGE_PREFIX}_${modulo}`;
  }

  private leer(modulo: string): VistaGuardada | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(this.clave(modulo));
      return raw ? (JSON.parse(raw) as VistaGuardada) : null;
    } catch {
      return null;
    }
  }

  private persistir(modulo: string): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(
        this.clave(modulo),
        JSON.stringify({
          densidad: this.densidades.get(modulo)?.(),
          verProductos: this.productos.get(modulo)?.(),
        } satisfies VistaGuardada)
      );
    } catch {
      // Modo privado o almacenamiento lleno: la preferencia solo dura la sesión.
    }
  }
}
