import {
  ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

type ReporteTipo =
  | 'ventas_periodo'
  | 'productos_mas_vendidos'
  | 'rendimiento_mesas'
  | 'rendimiento_usuarios'
  | 'estado_cocina';

type ReportValueType = 'text' | 'number' | 'currency' | 'date';

interface ReportTypeOption {
  value: ReporteTipo;
  label: string;
  description: string;
}

interface ReportColumn {
  key: string;
  label: string;
  type: ReportValueType;
}

interface ReportSummaryItem {
  key: string;
  label: string;
  value: number | string | null;
  type: ReportValueType;
}

interface ReportPagination {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

interface GraficaPunto {
  fecha: string;
  ventas: number;
  ordenes: number;
}

interface GraficaTipo {
  tipo_pedido: string;
  ordenes: number;
  ventas: number;
}

interface GraficaProducto {
  producto: string;
  unidades: number;
  ingresos: number;
}

interface GraficaCategoria {
  categoria: string;
  unidades: number;
  ingresos: number;
}

interface GraficaUsuario {
  usuario: string;
  ordenes: number;
  ventas: number;
  ticket_promedio: number;
}

/** Cada reporte trae solo las series que le corresponden. */
interface ReportesGraficas {
  // ventas_periodo
  serie_diaria?: GraficaPunto[];
  por_tipo?: GraficaTipo[];
  periodo_anterior?: {
    ventas_totales: number;
    ordenes_cobradas: number;
    ticket_promedio: number;
  };
  // productos_mas_vendidos
  top_productos?: GraficaProducto[];
  por_categoria?: GraficaCategoria[];
  // rendimiento_usuarios
  por_usuario?: GraficaUsuario[];
}

interface DonutSegmento {
  key: string;
  label: string;
  clase: string;
  valor: number;
  conteo: number;
  pct: number;
  dash: string;
  offset: number;
}

interface BarraItem {
  key: string;
  label: string;
  valor: string;
  detalle: string;
  pct: number;
  rank: number;
}

type RangoRapido = 'hoy' | '7d' | '30d' | 'mes' | 'custom';

interface KpiVista {
  key: string;
  label: string;
  value: string;
  icon: string;
  tono: number;
  tendencia: { texto: string; sube: boolean } | null;
  nota: string | null;
}

interface ChartPunto {
  x: number;
  y: number;
  fecha: string;
  ventas: number;
  ordenes: number;
}

interface ReportesData {
  tipo: ReporteTipo;
  titulo: string;
  filtros: {
    fecha_desde: string;
    fecha_hasta: string;
  };
  columns: ReportColumn[];
  resumen: ReportSummaryItem[];
  graficas?: ReportesGraficas;
  rows: Array<Record<string, unknown>>;
  pagination: ReportPagination;
}

interface ReportesApiResponse {
  success: boolean;
  data: ReportesData;
}

interface VentaDetalleExclusion {
  id_ingrediente: number;
  nombre: string;
}

interface VentaDetalleItem {
  id_detalle: number;
  id_producto: number;
  producto: string;
  icono: string | null;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  estado: string;
  nota: string;
  exclusiones: VentaDetalleExclusion[];
}

interface VentaDetallePedido {
  id_orden: number;
  numero_orden: string;
  tipo_pedido: string;
  fecha_creacion: string | null;
  fecha_cierre: string | null;
  estado: string;
  estado_cocina: string;
  nota_orden: string;
  mesa: {
    id_mesa: number;
    nombre: string;
    numero: number;
  } | null;
  mesero: {
    id_usuario: number;
    nombre: string;
  } | null;
  domiciliario: {
    id_usuario: number;
    nombre: string;
  } | null;
  responsable: string;
  totales: {
    subtotal: number;
    impuesto: number;
    total: number;
  };
  metodo_pago: string;
  pagos: Array<{ metodo: string; valor: number }>;
  items: VentaDetalleItem[];
}

interface VentaDetalleApiResponse {
  success: boolean;
  data: VentaDetallePedido;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildDefaultRange(): { fechaDesde: string; fechaHasta: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);

  return {
    fechaDesde: toDateInputValue(start),
    fechaHasta: toDateInputValue(end),
  };
}

const CHART_W_INICIAL = 640;
const CHART_H = 250;
const CHART_PAD = { left: 58, right: 16, top: 16, bottom: 30 };

const KPI_ICONOS: Record<string, string> = {
  ventas_totales: 'dollar-sign',
  ordenes_cobradas: 'receipt',
  ticket_promedio: 'banknote',
  rango: 'calendar',
  productos_con_ventas: 'package',
  unidades_vendidas: 'shopping-bag',
  ingresos_brutos: 'dollar-sign',
  mesas_con_ventas: 'armchair',
  usuarios_activos: 'users',
  ordenes_cerradas: 'check-circle',
  ordenes_abiertas: 'clock',
  ordenes_totales: 'receipt',
  monto_total: 'dollar-sign',
};

const TIPO_PEDIDO_ORDEN = ['MESA', 'LLEVAR', 'DOMICILIO'];

/** Techo «redondo» para el eje Y: 1, 2, 2.5, 5 o 10 × 10^n. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const f = value / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Curva monótona (Fritsch–Carlson): suave, sin pasarse por debajo de cero entre puntos. */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push((pts[i + 1].y - pts[i].y) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  }
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      t[i] = (3 * a * m[i]) / h;
      t[i + 1] = (3 * b * m[i]) / h;
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (t[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

@Component({
  selector: 'app-reportes',
  imports: [LucideAngularModule, FormsModule],
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportesComponent {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly defaultRange = buildDefaultRange();

  readonly tipoOptions: ReportTypeOption[] = [
    {
      value: 'ventas_periodo',
      label: 'Ventas por pedido',
      description: 'Detalle por pedido cobrado.',
    },
    {
      value: 'productos_mas_vendidos',
      label: 'Productos más vendidos',
      description: 'Ranking por unidades e ingresos.',
    },
    {
      value: 'rendimiento_usuarios',
      label: 'Ventas por usuario',
      description: 'Ventas y ticket promedio de cada cajero o mesero.',
    },
  ];

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly tipoSeleccionado = signal<ReporteTipo>('ventas_periodo');
  readonly fechaDesdeInput = signal(this.defaultRange.fechaDesde);
  readonly fechaHastaInput = signal(this.defaultRange.fechaHasta);
  readonly page = signal(1);
  readonly pageSize = signal(10);

  readonly rangoRapido = signal<RangoRapido>('30d');
  readonly rangosRapidos: Array<{ value: RangoRapido; label: string }> = [
    { value: 'hoy', label: 'Hoy' },
    { value: '7d', label: '7 días' },
    { value: '30d', label: '30 días' },
    { value: 'mes', label: 'Este mes' },
    { value: 'custom', label: 'Personalizado' },
  ];
  readonly hoverIdx = signal<number | null>(null);
  /** Ancho real (px) de la tarjeta: el SVG se dibuja a 1:1 para ocupar todo el ancho, sin vacíos. */
  readonly chartW = signal(CHART_W_INICIAL);
  private readonly areaWrap = viewChild<ElementRef<HTMLElement>>('areaWrap');
  private readonly areaObserver = effect((onCleanup) => {
    const el = this.areaWrap()?.nativeElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w >= 240 && w !== this.chartW()) this.chartW.set(w);
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });
  readonly chartH = CHART_H;

  readonly filtrosAplicados = signal<{
    tipo: ReporteTipo;
    fecha_desde: string;
    fecha_hasta: string;
  }>({
    tipo: 'ventas_periodo',
    fecha_desde: this.defaultRange.fechaDesde,
    fecha_hasta: this.defaultRange.fechaHasta,
  });

  readonly cargando = signal(false);
  readonly exportando = signal<'xlsx' | 'pdf' | null>(null);
  readonly error = signal('');
  readonly reporte = signal<ReportesData | null>(null);
  readonly modalDetalleAbierto = signal(false);
  readonly cargandoDetalle = signal(false);
  readonly detalleError = signal('');
  readonly detallePedido = signal<VentaDetallePedido | null>(null);
  readonly detalleOrdenCargandoId = signal<number | null>(null);

  readonly summaryItems = computed(() => this.reporte()?.resumen ?? []);
  readonly columns = computed(() => this.reporte()?.columns ?? []);
  readonly rows = computed(() => this.reporte()?.rows ?? []);
  readonly esVentasPeriodo = computed(() => this.reporte()?.tipo === 'ventas_periodo');
  readonly tableColspan = computed(() => this.columns().length + (this.esVentasPeriodo() ? 1 : 0));
  readonly pagination = computed<ReportPagination>(() => this.reporte()?.pagination ?? {
    page: 1,
    page_size: this.pageSize(),
    total: 0,
    total_pages: 1,
  });

  readonly inicioPagina = computed(() => {
    const pag = this.pagination();
    if (pag.total === 0) return 0;
    return (pag.page - 1) * pag.page_size + 1;
  });

  readonly finPagina = computed(() => {
    const pag = this.pagination();
    if (pag.total === 0) return 0;
    return Math.min(pag.page * pag.page_size, pag.total);
  });

  /** Cambio de pestaña o primera carga: se muestran esqueletos en vez de dejar el reporte anterior. */
  readonly cambiandoTipo = computed(
    () => this.cargando() && this.reporte()?.tipo !== this.filtrosAplicados().tipo,
  );

  readonly canExport = computed(() => !this.cargando() && this.rows().length > 0);

  // ─── KPIs ──────────────────────────────────────────────────────────────
  private readonly diasDelRango = computed(() => {
    const f = this.reporte()?.filtros;
    if (!f) return 0;
    const a = Date.parse(`${f.fecha_desde}T00:00:00`);
    const b = Date.parse(`${f.fecha_hasta}T00:00:00`);
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((b - a) / 86_400_000) + 1;
  });

  readonly kpis = computed<KpiVista[]>(() => {
    const data = this.reporte();
    if (!data) return [];
    const previo = data.graficas?.periodo_anterior;
    const previoPorKey: Record<string, number | undefined> = {
      ventas_totales: previo?.ventas_totales,
      ordenes_cobradas: previo?.ordenes_cobradas,
      ticket_promedio: previo?.ticket_promedio,
    };
    return data.resumen.map((item, i) => {
      let tendencia: KpiVista['tendencia'] = null;
      const anterior = previoPorKey[item.key];
      if (anterior && anterior > 0 && typeof item.value === 'number') {
        const pct = ((item.value - anterior) / anterior) * 100;
        tendencia = {
          sube: pct >= 0,
          texto: `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`,
        };
      }
      let nota: string | null = tendencia ? 'vs. período anterior' : null;
      if (item.key === 'rango') {
        const dias = this.diasDelRango();
        nota = dias ? `${dias} ${dias === 1 ? 'día' : 'días'}` : null;
      }
      return {
        key: item.key,
        label: item.label,
        value: this.formatByType(item.value, item.type),
        icon: KPI_ICONOS[item.key] ?? 'chart-bar',
        tono: i % 4,
        tendencia,
        nota,
      };
    });
  });

  // ─── Gráficas ──────────────────────────────────────────────────────────
  readonly graficas = computed(() => this.reporte()?.graficas ?? null);
  readonly tipoActual = computed(() => this.reporte()?.tipo ?? null);

  readonly chartVentas = computed(() => {
    const serie = this.graficas()?.serie_diaria ?? [];
    const chartW = this.chartW();
    const innerW = chartW - CHART_PAD.left - CHART_PAD.right;
    const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom;
    const baseY = CHART_PAD.top + innerH;
    const max = niceMax(Math.max(0, ...serie.map((p) => p.ventas)));
    const n = serie.length;

    const puntos: ChartPunto[] = serie.map((p, i) => ({
      x: n === 1 ? CHART_PAD.left + innerW / 2 : CHART_PAD.left + (i * innerW) / (n - 1),
      y: baseY - (p.ventas / max) * innerH,
      fecha: p.fecha,
      ventas: p.ventas,
      ordenes: p.ordenes,
    }));

    const linea = smoothPath(puntos);
    const area = puntos.length > 1
      ? `${linea} L${puntos[n - 1].x},${baseY} L${puntos[0].x},${baseY} Z`
      : '';

    const ticks = [0, 1, 2, 3, 4].map((k) => ({
      y: baseY - (k / 4) * innerH,
      label: this.formatCompacto((max * k) / 4),
    }));

    const cuantasEtiquetas = Math.min(n, 6);
    const etiquetas: Array<{ x: number; label: string }> = [];
    for (let k = 0; k < cuantasEtiquetas; k++) {
      const idx = cuantasEtiquetas === 1 ? 0 : Math.round((k * (n - 1)) / (cuantasEtiquetas - 1));
      etiquetas.push({ x: puntos[idx].x, label: this.formatFechaCorta(puntos[idx].fecha) });
    }

    return {
      puntos,
      linea,
      area,
      ticks,
      etiquetas,
      baseY,
      total: serie.reduce((a, p) => a + p.ventas, 0),
      hayVentas: serie.some((p) => p.ventas > 0),
    };
  });

  readonly hoverPunto = computed(() => {
    const i = this.hoverIdx();
    const pts = this.chartVentas().puntos;
    return i !== null && i >= 0 && i < pts.length ? pts[i] : null;
  });

  /** Anillo: por tipo de pedido / por categoría / por usuario, según el reporte activo. */
  readonly donut = computed(() => {
    const g = this.graficas();
    const tipo = this.tipoActual();
    let items: Array<{ key: string; label: string; clase: string; valor: number; conteo: number }> = [];
    let titulo = '';
    let subtitulo = '';
    let unidad = { uno: 'orden', varios: 'órdenes' };

    if (tipo === 'ventas_periodo') {
      titulo = 'Distribución por tipo de pedido';
      subtitulo = 'Participación en las ventas';
      items = [...(g?.por_tipo ?? [])]
        .sort((a, b) => {
          const ia = TIPO_PEDIDO_ORDEN.indexOf(a.tipo_pedido);
          const ib = TIPO_PEDIDO_ORDEN.indexOf(b.tipo_pedido);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        })
        .map((t) => ({
          key: t.tipo_pedido,
          label: this.formatTipoPedidoLabel(t.tipo_pedido),
          clase: this.tipoPedidoClase(t.tipo_pedido),
          valor: t.ventas,
          conteo: t.ordenes,
        }));
    } else if (tipo === 'productos_mas_vendidos') {
      titulo = 'Ingresos por categoría';
      subtitulo = 'Qué categorías generan más plata';
      unidad = { uno: 'unidad', varios: 'unidades' };
      items = (g?.por_categoria ?? []).map((c, i) => ({
        key: c.categoria,
        label: c.categoria,
        clase: `c${i % 8}`,
        valor: c.ingresos,
        conteo: c.unidades,
      }));
    } else if (tipo === 'rendimiento_usuarios') {
      titulo = 'Participación en las ventas';
      subtitulo = 'Cuánto aporta cada usuario';
      items = (g?.por_usuario ?? []).map((u, i) => ({
        key: u.usuario,
        label: u.usuario,
        clase: `c${i % 8}`,
        valor: u.ventas,
        conteo: u.ordenes,
      }));
    }

    const total = items.reduce((a, t) => a + t.valor, 0);
    const totalConteo = items.reduce((a, t) => a + t.conteo, 0);
    const R = 52;
    const C = 2 * Math.PI * R;
    let acumulado = 0;
    const segmentos: DonutSegmento[] = items.map((t) => {
      const frac = total > 0 ? t.valor / total : 0;
      const largo = frac * C;
      const seg: DonutSegmento = {
        ...t,
        pct: frac * 100,
        dash: `${Math.max(0, largo - (items.length > 1 && largo > 3 ? 2 : 0))} ${C}`,
        offset: -acumulado,
      };
      acumulado += largo;
      return seg;
    });
    return { titulo, subtitulo, unidad, segmentos, total, totalConteo, r: R };
  });

  /** Barras horizontales: top de productos o ventas por usuario. */
  readonly barras = computed(() => {
    const g = this.graficas();
    const tipo = this.tipoActual();
    let titulo = '';
    let subtitulo = '';
    let items: BarraItem[] = [];

    if (tipo === 'productos_mas_vendidos') {
      titulo = 'Top 10 productos';
      subtitulo = 'Unidades vendidas en el rango';
      const datos = g?.top_productos ?? [];
      const max = Math.max(1, ...datos.map((d) => d.unidades));
      items = datos.map((d, i) => ({
        key: d.producto,
        label: d.producto,
        valor: `${this.numberFormatter.format(d.unidades)} uds`,
        detalle: this.formatCurrency(d.ingresos),
        pct: (d.unidades / max) * 100,
        rank: i,
      }));
    } else if (tipo === 'rendimiento_usuarios') {
      titulo = 'Ventas por usuario';
      subtitulo = 'Total cobrado por cada cajero o mesero';
      const datos = g?.por_usuario ?? [];
      const max = Math.max(1, ...datos.map((d) => d.ventas));
      items = datos.map((d, i) => ({
        key: d.usuario,
        label: d.usuario,
        valor: this.formatCurrency(d.ventas),
        detalle: `${d.ordenes} ${d.ordenes === 1 ? 'orden' : 'órdenes'} · ticket ${this.formatCurrency(d.ticket_promedio)}`,
        pct: (d.ventas / max) * 100,
        rank: i,
      }));
    }
    return { titulo, subtitulo, items };
  });

  private readonly currencyFormatter = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });

  private readonly numberFormatter = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 0,
  });

  private readonly negocioEffect = effect(() => {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    untracked(() => {
      this.page.set(1);
      this.loadReportes();
    });
  });

  seleccionarRango(rango: RangoRapido): void {
    this.rangoRapido.set(rango);
    if (rango === 'custom') return;

    const hoy = new Date();
    const desde = new Date(hoy);
    if (rango === '7d') desde.setDate(desde.getDate() - 6);
    else if (rango === '30d') desde.setDate(desde.getDate() - 29);
    else if (rango === 'mes') desde.setDate(1);

    this.fechaDesdeInput.set(toDateInputValue(desde));
    this.fechaHastaInput.set(toDateInputValue(hoy));
    this.aplicarFiltros();
  }

  onTipoChange(value: string): void {
    this.setTipo(value);
    this.aplicarFiltros();
  }

  onChartMove(event: MouseEvent | TouchEvent): void {
    const pts = this.chartVentas().puntos;
    if (pts.length === 0) return;
    const el = event.currentTarget as SVGElement;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const clientX = 'touches' in event ? (event.touches[0]?.clientX ?? 0) : event.clientX;
    const x = ((clientX - rect.left) / rect.width) * this.chartW();
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.abs(pts[i].x - x);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    this.hoverIdx.set(best);
  }

  onChartLeave(): void {
    this.hoverIdx.set(null);
  }

  setTipo(value: string): void {
    const option = this.tipoOptions.find((item) => item.value === value);
    if (!option) return;
    this.tipoSeleccionado.set(option.value);
  }

  setFechaDesde(value: string): void {
    this.rangoRapido.set('custom');
    this.fechaDesdeInput.set(value);
  }

  setFechaHasta(value: string): void {
    this.rangoRapido.set('custom');
    this.fechaHastaInput.set(value);
  }

  setPageSize(size: number): void {
    const safeSize = Number.isFinite(size) ? Math.min(100, Math.max(10, Math.floor(size))) : 10;
    this.pageSize.set(safeSize);
    this.page.set(1);
    this.loadReportes();
  }

  aplicarFiltros(): void {
    const fechaDesde = this.fechaDesdeInput().trim();
    const fechaHasta = this.fechaHastaInput().trim();

    if (!fechaDesde || !fechaHasta) {
      this.error.set('Debes seleccionar fecha inicial y fecha final.');
      return;
    }

    if (fechaDesde > fechaHasta) {
      this.error.set('La fecha inicial no puede ser mayor que la fecha final.');
      return;
    }

    this.error.set('');
    this.filtrosAplicados.set({
      tipo: this.tipoSeleccionado(),
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
    this.page.set(1);
    this.loadReportes();
  }

  recargar(): void {
    if (this.cargando()) return;
    this.loadReportes();
  }

  prevPage(): void {
    const currentPage = this.page();
    if (currentPage <= 1 || this.cargando()) return;
    this.page.set(currentPage - 1);
    this.loadReportes();
  }

  nextPage(): void {
    const currentPage = this.page();
    const totalPages = this.pagination().total_pages;
    if (currentPage >= totalPages || this.cargando()) return;
    this.page.set(currentPage + 1);
    this.loadReportes();
  }

  exportar(formato: 'xlsx' | 'pdf'): void {
    if (!this.canExport() || this.exportando()) return;

    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    this.exportando.set(formato);

    const filtros = this.filtrosAplicados();
    const params = new URLSearchParams({
      id_negocio: String(idNegocio),
      tipo: filtros.tipo,
      fecha_desde: filtros.fecha_desde,
      fecha_hasta: filtros.fecha_hasta,
      formato,
    });

    this.http.get(`${environment.apiUrl}/reportes/exportar?${params.toString()}`, {
      observe: 'response',
      responseType: 'blob',
    }).pipe(
      finalize(() => this.exportando.set(null)),
    ).subscribe({
      next: (response: HttpResponse<Blob>) => {
        if (!response.body || response.body.size === 0) {
          this.error.set('El archivo generado esta vacio.');
          return;
        }

        const filename = this.extractFilename(response, formato);
        this.downloadBlob(response.body, filename);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.getHttpErrorMessage(err) || 'No se pudo exportar el reporte.');
      },
    });
  }

  abrirDetallePedido(row: Record<string, unknown>): void {
    if (!this.esVentasPeriodo()) return;

    const idNegocio = this.negocioId();
    const idOrden = this.getRowOrderId(row);
    if (!idNegocio || !idOrden) {
      this.error.set('No se pudo identificar la orden seleccionada.');
      return;
    }

    this.modalDetalleAbierto.set(true);
    this.detallePedido.set(null);
    this.detalleError.set('');
    this.cargandoDetalle.set(true);
    this.detalleOrdenCargandoId.set(idOrden);

    const params = new URLSearchParams({ id_negocio: String(idNegocio) });
    this.http.get<VentaDetalleApiResponse>(
      `${environment.apiUrl}/reportes/ventas/${idOrden}/detalle?${params.toString()}`,
    ).pipe(
      finalize(() => {
        this.cargandoDetalle.set(false);
        this.detalleOrdenCargandoId.set(null);
      }),
    ).subscribe({
      next: (response) => {
        this.detallePedido.set(response?.data ?? null);
      },
      error: (err: HttpErrorResponse) => {
        this.detalleError.set(this.getHttpErrorMessage(err) || 'No se pudo cargar el detalle del pedido.');
      },
    });
  }

  cerrarDetallePedido(): void {
    this.modalDetalleAbierto.set(false);
    this.cargandoDetalle.set(false);
    this.detallePedido.set(null);
    this.detalleError.set('');
    this.detalleOrdenCargandoId.set(null);
  }

  isDetalleLoading(row: Record<string, unknown>): boolean {
    const currentLoadingId = this.detalleOrdenCargandoId();
    if (currentLoadingId === null) return false;

    const rowOrderId = this.getRowOrderId(row);
    return rowOrderId !== null && rowOrderId === currentLoadingId;
  }

  puedeVerDetalle(row: Record<string, unknown>): boolean {
    return this.getRowOrderId(row) !== null;
  }

  getTipoDescripcion(): string {
    const selected = this.tipoOptions.find((opt) => opt.value === this.filtrosAplicados().tipo);
    return selected?.description ?? '';
  }

  formatSummary(item: ReportSummaryItem): string {
    return this.formatByType(item.value, item.type);
  }

  formatCell(value: unknown, type: ReportValueType, key?: string): string {
    if (key === 'tipo_pedido') {
      return this.formatTipoPedidoLabel(String(value ?? ''));
    }
    return this.formatByType(value, type);
  }

  trackColumn(_: number, column: ReportColumn): string {
    return column.key;
  }

  trackSummary(_: number, item: ReportSummaryItem): string {
    return item.key;
  }

  trackDetalleItem(_: number, item: VentaDetalleItem): number {
    return item.id_detalle;
  }

  formatCurrency(value: number): string {
    return this.currencyFormatter.format(Number(value || 0));
  }

  formatDateValue(value: string | null): string {
    return this.formatByType(value, 'date');
  }

  formatTipoPedidoLabel(value: string): string {
    const safe = (value || '').toUpperCase();
    if (safe === 'MESA') return 'En mesa';
    if (safe === 'LLEVAR') return 'Para llevar';
    if (safe === 'DOMICILIO') return 'Domicilio';
    return value || 'No aplica';
  }

  tipoPedidoClase(value: string): string {
    const safe = (value || '').toUpperCase();
    if (safe === 'MESA') return 'tipo-mesa';
    if (safe === 'LLEVAR') return 'tipo-llevar';
    if (safe === 'DOMICILIO') return 'tipo-domicilio';
    return 'tipo-otro';
  }

  /** $1,2 M · $350 mil: para los ejes, donde el número completo no cabe. */
  formatCompacto(value: number): string {
    if (value === 0) return '$0';
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} mil`;
    }
    return `$${Math.round(value)}`;
  }

  formatFechaCorta(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' })
      .format(d)
      .replace('.', '');
  }

  formatFechaLarga(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat('es-CO', {
      weekday: 'short', day: 'numeric', month: 'short',
    }).format(d);
  }

  formatPct(value: number): string {
    return `${value.toLocaleString('es-CO', { maximumFractionDigits: 0 })}%`;
  }

  formatMesaLabel(detalle: VentaDetallePedido): string {
    if (!detalle.mesa || detalle.tipo_pedido !== 'MESA') return 'No aplica';
    return `${detalle.mesa.nombre} · #${detalle.mesa.numero}`;
  }

  formatEstadoLabel(value: string): string {
    const safe = (value || '').toUpperCase();
    if (safe === 'ABIERTA') return 'Abierta';
    if (safe === 'CERRADA') return 'Cerrada';
    if (safe === 'PENDIENTE') return 'Pendiente';
    if (safe === 'EN_PREPARACION') return 'En preparacion';
    if (safe === 'LISTO') return 'Listo';
    if (safe === 'ENTREGADO') return 'Entregado';
    if (safe === 'SIN_ESTADO') return 'Sin estado';
    return value || '--';
  }

  estadoClase(value: string): 'ok' | 'neutro' | 'aviso' {
    const safe = (value || '').toUpperCase();
    if (safe === 'ENTREGADO' || safe === 'LISTO') return 'ok';
    if (safe === 'PENDIENTE' || safe === 'EN_PREPARACION' || safe === 'EN_COCINA') return 'aviso';
    return 'neutro';
  }

  atendidoPor(detalle: VentaDetallePedido): string {
    return detalle.mesero?.nombre || detalle.responsable || 'No aplica';
  }

  canalLabel(detalle: VentaDetallePedido): string {
    if (detalle.tipo_pedido === 'MESA') return this.formatMesaLabel(detalle);
    if (detalle.tipo_pedido === 'DOMICILIO') {
      const domi = detalle.domiciliario?.nombre;
      return domi ? `Domicilio · ${domi}` : 'Domicilio';
    }
    return this.formatTipoPedidoLabel(detalle.tipo_pedido);
  }

  /** Lo que el total trae por encima de subtotal + impuesto (el cobro del domicilio). */
  costoDomicilio(detalle: VentaDetallePedido): number {
    const extra = detalle.totales.total - detalle.totales.subtotal - detalle.totales.impuesto;
    return extra > 0.5 ? extra : 0;
  }

  /** Imprime solo el comprobante: se arma en un iframe oculto para no arrastrar la pantalla. */
  imprimirComprobante(): void {
    const d = this.detallePedido();
    if (!d || typeof document === 'undefined') return;

    const esc = (v: unknown) =>
      String(v ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
      ));

    const filas = d.items.map((i) => {
      const extras = [
        i.nota ? `Nota: ${esc(i.nota)}` : '',
        i.exclusiones.length ? `Sin ${i.exclusiones.map((e) => esc(e.nombre)).join(', ')}` : '',
      ].filter(Boolean).join(' · ');
      return `<tr><td class="c">${i.cantidad}</td><td>${esc(i.producto)}${extras ? `<div class="s">${extras}</div>` : ''}</td>` +
        `<td class="r">${esc(this.formatCurrency(i.precio_unitario))}</td><td class="r b">${esc(this.formatCurrency(i.subtotal))}</td></tr>`;
    }).join('');

    const domicilio = this.costoDomicilio(d);
    const negocio = esc(this.auth.negocio()?.nombre ?? '');
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante ${esc(d.numero_orden)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;max-width:420px}
  h1{font-size:16px;margin:0 0 2px;text-align:center} .sub{text-align:center;font-size:12px;color:#555;margin-bottom:14px}
  .n{font-size:22px;font-weight:700} .m{font-size:12px;color:#555;margin:2px 0}
  .head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed #999;padding-bottom:10px;margin-bottom:10px}
  .head .r{text-align:right;font-size:12px} .head b{display:block;font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:12px} th{text-align:left;border-bottom:1px solid #999;padding:4px 0;font-size:10px;text-transform:uppercase}
  td{padding:4px 0;border-bottom:1px solid #eee;vertical-align:top} .c{width:34px} .r{text-align:right;white-space:nowrap;padding-left:8px} .b{font-weight:700} .s{font-size:10px;color:#666}
  .t{margin:12px 0 0 auto;width:220px;font-size:12px} .t div{display:flex;justify-content:space-between;padding:2px 0}
  .t .g{border-top:1px solid #111;margin-top:4px;padding-top:6px;font-size:16px;font-weight:700}
  .f{text-align:center;font-size:11px;color:#666;margin-top:18px}
</style></head><body>
  <h1>${negocio}</h1><div class="sub">Comprobante de venta</div>
  <div class="head"><div><div class="n">#${esc(d.numero_orden)}</div><div class="m">${esc(this.formatDateValue(d.fecha_cierre))}</div>
  <div class="m">${esc(this.formatTipoPedidoLabel(d.tipo_pedido))} · ${esc(this.formatEstadoLabel(d.estado))}</div></div>
  <div class="r"><span>Atendido por</span><b>${esc(this.atendidoPor(d))}</b><span>Mesa / Canal</span><b>${esc(this.canalLabel(d))}</b></div></div>
  <table><thead><tr><th>Cant.</th><th>Producto</th><th class="r">P. unit.</th><th class="r">Subtotal</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="t"><div><span>Subtotal</span><span>${esc(this.formatCurrency(d.totales.subtotal))}</span></div>
  <div><span>Impuestos</span><span>${esc(this.formatCurrency(d.totales.impuesto))}</span></div>
  <div><span>Forma de pago</span><span>${esc(d.metodo_pago || 'Sin registrar')}</span></div>
  ${domicilio > 0 ? `<div><span>Domicilio</span><span>${esc(this.formatCurrency(domicilio))}</span></div>` : ''}
  <div class="g"><span>TOTAL</span><span>${esc(this.formatCurrency(d.totales.total))}</span></div></div>
  <div class="f">Gracias por su compra</div>
</body></html>`;

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc || !frame.contentWindow) {
      frame.remove();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    }, 150);
  }

  private loadReportes(): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) return;

    const filtros = this.filtrosAplicados();

    this.cargando.set(true);
    this.error.set('');

    const params = new URLSearchParams({
      id_negocio: String(idNegocio),
      tipo: filtros.tipo,
      fecha_desde: filtros.fecha_desde,
      fecha_hasta: filtros.fecha_hasta,
      page: String(this.page()),
      page_size: String(this.pageSize()),
    });

    this.http.get<ReportesApiResponse>(`${environment.apiUrl}/reportes?${params.toString()}`).subscribe({
      next: (response) => {
        const data = response?.data ?? null;
        this.reporte.set(data);
        this.hoverIdx.set(null);
        if (data?.tipo !== 'ventas_periodo' && this.modalDetalleAbierto()) {
          this.cerrarDetallePedido();
        }
        if (data?.pagination) {
          this.page.set(data.pagination.page);
          this.pageSize.set(data.pagination.page_size);
        }
        this.cargando.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.error.set(this.getHttpErrorMessage(err) || 'No se pudo cargar el reporte.');
        this.cargando.set(false);
      },
    });
  }

  private getHttpErrorMessage(err: HttpErrorResponse): string {
    const message = err?.error?.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    return '';
  }

  private formatByType(value: unknown, type: ReportValueType): string {
    if (value === null || value === undefined || value === '') return '--';

    if (type === 'currency') {
      return this.currencyFormatter.format(Number(value) || 0);
    }

    if (type === 'number') {
      return this.numberFormatter.format(Number(value) || 0);
    }

    if (type === 'date') {
      const date = new Date(String(value));
      if (Number.isNaN(date.getTime())) return String(value);
      return new Intl.DateTimeFormat('es-CO', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }

    return String(value);
  }

  private extractFilename(response: HttpResponse<Blob>, fallbackFormat: 'xlsx' | 'pdf'): string {
    const header = response.headers.get('content-disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
    return `reporte_restaurante.${fallbackFormat}`;
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private getRowOrderId(row: Record<string, unknown>): number | null {
    const value = Number(row['id_orden']);
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
  }
}
