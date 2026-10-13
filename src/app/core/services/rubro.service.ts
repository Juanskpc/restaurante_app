import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Un sector de ingreso tal como lo pinta un selector o una gráfica. */
export interface Rubro {
  id_rubro: number;
  nombre: string;
  descripcion: string | null;
  color: string | null;
  orden: number;
  estado: 'A' | 'I';
  /** Cuántas categorías de la carta tiene asignadas. */
  categorias: number;
}

/** Una categoría de la carta con el sector al que pertenece. `null` = «General». */
export interface CategoriaDeRubro {
  id_categoria: number;
  nombre: string;
  id_rubro: number | null;
  productos: number;
}

export interface ListadoRubros {
  rows: Rubro[];
  /** Todas las categorías activas del negocio, para poder repartirlas sin otra petición. */
  categorias: CategoriaDeRubro[];
}

interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

/**
 * Los sectores de ingreso del negocio (rubros).
 *
 * Un sector agrupa categorías de la carta para contestar «cuánto deja la parrilla y cuánto el
 * sushi», aunque la mesa pida de las dos y pague una sola vez. No son las cajas: la caja es
 * del pedido (su turno, su arqueo) y el sector es del producto.
 *
 * ## `tieneRubros()` es el interruptor de toda la función
 *
 * No hay flag en el negocio: si la lista viene vacía, el negocio no separa sectores y ni la
 * pestaña de informes ni el desglose del cierre de caja se pintan. Por eso la respuesta se
 * cachea por negocio —la preguntan varias pantallas— y por eso las escrituras la invalidan.
 */
@Injectable({ providedIn: 'root' })
export class RubroService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/rubros`;

  private readonly listaState = signal<Rubro[]>([]);
  /** De qué negocio es lo que hay en caché. `null` = nada cargado todavía. */
  private negocioCargado: number | null = null;

  readonly lista = this.listaState.asReadonly();

  /** Los sectores activos: los únicos que se ofrecen para repartir categorías nuevas. */
  activos(): Rubro[] {
    return this.listaState().filter((r) => r.estado === 'A');
  }

  /** ¿Este negocio separa sus ingresos por sector? Decide si la función existe en pantalla. */
  tieneRubros(): boolean {
    return this.activos().length > 0;
  }

  /**
   * Carga la lista si todavía no está, o la fuerza. Nunca falla hacia arriba: un error aquí
   * significa «este negocio no tiene sectores», que es el estado de la inmensa mayoría, y no
   * una pantalla roja.
   */
  cargar(idNegocio: number, forzar = false): Observable<ListadoRubros> {
    if (!forzar && this.negocioCargado === idNegocio) {
      return of({ rows: this.listaState(), categorias: [] });
    }
    return this.listar(idNegocio).pipe(
      catchError(() => of({ rows: [], categorias: [] } as ListadoRubros)),
    );
  }

  listar(idNegocio: number): Observable<ListadoRubros> {
    return this.http
      .get<ApiResponse<ListadoRubros>>(this.base, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(
        map((res) => res?.data ?? { rows: [], categorias: [] }),
        tap((data) => {
          this.negocioCargado = idNegocio;
          this.listaState.set(data.rows ?? []);
        }),
      );
  }

  crear(payload: { id_negocio: number; nombre: string; descripcion?: string | null; color?: string | null }) {
    return this.http.post<ApiResponse<Rubro>>(this.base, payload).pipe(tap(() => this.olvidar()));
  }

  actualizar(
    idRubro: number,
    payload: { id_negocio: number; nombre?: string; descripcion?: string | null; color?: string | null; estado?: 'A' | 'I' },
  ) {
    return this.http
      .put<ApiResponse<Rubro>>(`${this.base}/${idRubro}`, payload)
      .pipe(tap(() => this.olvidar()));
  }

  /** Fija de una vez las categorías del sector. Lista vacía = todas vuelven a «General». */
  fijarCategorias(idRubro: number, idNegocio: number, idsCategoria: number[]) {
    return this.http
      .put<ApiResponse<{ id_rubro: number; categorias: number }>>(`${this.base}/${idRubro}/categorias`, {
        id_negocio: idNegocio,
        id_categorias: idsCategoria,
      })
      .pipe(tap(() => this.olvidar()));
  }

  eliminar(idRubro: number, idNegocio: number) {
    return this.http
      .delete<ApiResponse<{ id_rubro: number }>>(`${this.base}/${idRubro}`, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(tap(() => this.olvidar()));
  }

  /** Invalida la caché: la siguiente pantalla que pregunte vuelve a pedirla. */
  private olvidar(): void {
    this.negocioCargado = null;
  }
}
