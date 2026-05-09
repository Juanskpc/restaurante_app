import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';

import { environment } from '../../../../environments/environment';

interface CategoriaPublica {
  id_categoria: number;
  nombre: string;
  descripcion: string | null;
  icono: string;
  total_productos: number;
}

interface IngredientePublico {
  id_producto_ingred: number;
  id_ingrediente: number;
  nombre: string;
  es_removible: boolean;
}

interface ProductoPublico {
  id_producto: number;
  nombre: string;
  descripcion: string | null;
  precio: number;
  imagen_url: string | null;
  icono: string;
  es_popular: boolean;
  ingredientes: IngredientePublico[];
}

interface NegocioPublico {
  id_negocio: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  url_whatsapp: string | null;
  url_facebook: string | null;
  url_instagram: string | null;
}

@Component({
  selector: 'app-menu-publico',
  imports: [LucideAngularModule],
  templateUrl: './menu-publico.html',
  styleUrl: './menu-publico.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MenuPublicoComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  readonly negocioId = signal<number | null>(null);
  readonly negocio = signal<NegocioPublico | null>(null);
  readonly categorias = signal<CategoriaPublica[]>([]);
  readonly productos = signal<ProductoPublico[]>([]);
  readonly negocioInvalido = signal(false);

  readonly cargandoNegocio = signal(false);
  readonly cargandoCategorias = signal(false);
  readonly cargandoProductos = signal(false);

  readonly categoriaActiva = signal<number | null>(null);

  readonly contactoDisponible = computed(() => {
    const info = this.negocio();
    if (!info) return false;
    return Boolean(
      info.direccion ||
      info.telefono ||
      info.url_whatsapp ||
      info.url_facebook ||
      info.url_instagram
    );
  });

  private readonly priceFormatter = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = Number(params.get('id'));
      if (!id) return;
      this.negocioInvalido.set(false);
      this.negocio.set(null);
      this.categorias.set([]);
      this.productos.set([]);
      this.negocioId.set(id);
      this.cargarNegocio(id);
      this.cargarCategorias(id);
    });
  }

  selectCategoria(idCategoria: number): void {
    this.categoriaActiva.set(idCategoria);
    this.cargarProductos(idCategoria);
  }

  formatPrice(value: number): string {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '$ 0';
    return `$ ${this.priceFormatter.format(numericValue)}`;
  }

  private cargarNegocio(idNegocio: number): void {
    this.cargandoNegocio.set(true);
    this.http
      .get<{ success: boolean; data: NegocioPublico }>(
        `${environment.apiUrl}/public/negocios/${idNegocio}`
      )
      .subscribe({
        next: (res) => {
          const negocio = res?.data ?? null;
          this.negocio.set(negocio);
          if (!negocio) {
            this.negocioInvalido.set(true);
            this.categorias.set([]);
            this.productos.set([]);
          }
          this.cargandoNegocio.set(false);
        },
        error: () => {
          this.negocioInvalido.set(true);
          this.categorias.set([]);
          this.productos.set([]);
          this.cargandoNegocio.set(false);
        },
      });
  }

  private cargarCategorias(idNegocio: number): void {
    if (this.negocioInvalido()) return;
    this.cargandoCategorias.set(true);
    this.http
      .get<{ success: boolean; data: CategoriaPublica[] }>(
        `${environment.apiUrl}/public/carta/categorias?id_negocio=${idNegocio}`
      )
      .subscribe({
        next: (res) => {
          const cats = res?.data ?? [];
          this.categorias.set(cats);
          this.cargandoCategorias.set(false);
          if (cats.length > 0) {
            this.selectCategoria(cats[0].id_categoria);
          } else {
            this.productos.set([]);
          }
        },
        error: () => this.cargandoCategorias.set(false),
      });
  }

  private cargarProductos(idCategoria: number): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;
    this.cargandoProductos.set(true);
    this.http
      .get<{ success: boolean; data: ProductoPublico[] }>(
        `${environment.apiUrl}/public/carta/productos?id_negocio=${idNegocio}&id_categoria=${idCategoria}`
      )
      .subscribe({
        next: (res) => {
          this.productos.set(res?.data ?? []);
          this.cargandoProductos.set(false);
        },
        error: () => this.cargandoProductos.set(false),
      });
  }
}
