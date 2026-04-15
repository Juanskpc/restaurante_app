import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
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

interface ReportesData {
  tipo: ReporteTipo;
  titulo: string;
  filtros: {
    fecha_desde: string;
    fecha_hasta: string;
  };
  columns: ReportColumn[];
  resumen: ReportSummaryItem[];
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
  totales: {
    subtotal: number;
    impuesto: number;
    total: number;
  };
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
      label: 'Productos mas vendidos',
      description: 'Ranking por unidades e ingresos.',
    },
    {
      value: 'rendimiento_mesas',
      label: 'Rendimiento por mesa',
      description: 'Comparativo de ticket y ventas.',
    },
    {
      value: 'rendimiento_usuarios',
      label: 'Rendimiento por usuario',
      description: 'Productividad por cajero.',
    },
    {
      value: 'estado_cocina',
      label: 'Estado de cocina',
      description: 'Distribucion de estados de orden.',
    },
  ];

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly tipoSeleccionado = signal<ReporteTipo>('ventas_periodo');
  readonly fechaDesdeInput = signal(this.defaultRange.fechaDesde);
  readonly fechaHastaInput = signal(this.defaultRange.fechaHasta);
  readonly page = signal(1);
  readonly pageSize = signal(20);

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

  readonly warningPdf = computed(() => {
    const data = this.reporte();
    if (!data) return false;
    return data.tipo === 'ventas_periodo' && data.pagination.total > 250;
  });

  readonly canExport = computed(() => !this.cargando() && this.rows().length > 0);

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

  setTipo(value: string): void {
    const option = this.tipoOptions.find((item) => item.value === value);
    if (!option) return;
    this.tipoSeleccionado.set(option.value);
  }

  setFechaDesde(value: string): void {
    this.fechaDesdeInput.set(value);
  }

  setFechaHasta(value: string): void {
    this.fechaHastaInput.set(value);
  }

  setPageSize(size: number): void {
    const safeSize = Number.isFinite(size) ? Math.min(100, Math.max(10, Math.floor(size))) : 20;
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

  formatCell(value: unknown, type: ReportValueType): string {
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

  formatMesaLabel(detalle: VentaDetallePedido): string {
    if (!detalle.mesa) return 'Para llevar';
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
