import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LUCIDE_ICONS, LucideIconProvider,
  X, Search, CircleAlert, ChevronUp, ChevronDown, NotebookPen, DollarSign, XCircle, RotateCcw,
} from 'lucide-angular';

import { SeguimientoPedidosComponent } from './seguimiento-pedidos';
import { CajaService, PedidoSeguimiento, SeguimientoPedidos } from '../../../../core/services/caja.service';

/** Solo los que usa esta plantilla: sin esto, `LucideAngularComponent` revienta en runtime. */
const ICONOS_DE_LA_PLANTILLA = { X, Search, CircleAlert, ChevronUp, ChevronDown, NotebookPen, DollarSign, XCircle, RotateCcw };

/**
 * Sección «Movimientos»: el flujo mesero → caja.
 *
 * Lo que más importa sostener: cambiar un filtro reinicia la lista (nunca la
 * mezcla con la página anterior) y «Cargar más» hace justo lo contrario — suma,
 * con el offset correcto—; y que un 403 (el permiso se lo quitaron a mitad de
 * sesión) se lee como lo que es, no como un error genérico de red.
 */
describe('SeguimientoPedidosComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<SeguimientoPedidosComponent>>;
  let comp: SeguimientoPedidosComponent;
  let getSeguimiento: ReturnType<typeof vi.fn>;

  const pedido = (id: number): PedidoSeguimiento => ({
    id_orden: id,
    numero_orden: `ORD-${id}`,
    tipo_pedido: 'LLEVAR',
    estado: 'CERRADA',
    estado_pago: 'pagado',
    total: 20000,
    mesa: null,
    punto_caja: null,
    fecha_creacion: '2026-09-28T10:00:00',
    mesero: 'Ana',
    eventos: [
      { tipo: 'tomado', fecha: '2026-09-28T10:00:00', id_usuario: 1, actor: 'Ana' },
      { tipo: 'cobrado', fecha: '2026-09-28T10:05:00', id_usuario: 2, actor: 'Luis', monto: 20000, metodo_pago: 'Efectivo' },
    ],
  });

  const respuesta = (rows: PedidoSeguimiento[], total: number): { success: true; message: string; data: SeguimientoPedidos } => ({
    success: true, message: 'ok',
    data: {
      rows, total, limite: 30, offset: 0,
      resumen: { abiertas: 0, cobradas: rows.length, canceladas: 0, anuladas: 0, monto_cobrado: 20000 * rows.length, monto_no_cobrado: 0 },
      rango: { desde: '2026-09-28', hasta: '2026-09-28' },
    },
  });

  beforeEach(() => {
    getSeguimiento = vi.fn(() => of(respuesta([pedido(1)], 1)));
    TestBed.configureTestingModule({
      imports: [SeguimientoPedidosComponent],
      providers: [
        { provide: CajaService, useValue: { getSeguimiento } },
        { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(ICONOS_DE_LA_PLANTILLA) },
      ],
    });
    fixture = TestBed.createComponent(SeguimientoPedidosComponent);
    comp = fixture.componentInstance;
    fixture.componentRef.setInput('idNegocio', 7);
  });

  it('al iniciar, pide el rango de hoy y pinta lo que llega', () => {
    fixture.detectChanges(); // ngOnInit

    expect(getSeguimiento).toHaveBeenCalledTimes(1);
    const [idNegocio, opciones] = getSeguimiento.mock.calls[0];
    expect(idNegocio).toBe(7);
    expect(opciones.offset).toBe(0);
    expect(comp.filas()).toHaveLength(1);
    expect(comp.total()).toBe(1);
    expect(comp.resumen()?.cobradas).toBe(1);
  });

  it('cambiar de filtro REINICIA la lista, no la mezcla con la anterior', () => {
    fixture.detectChanges();
    getSeguimiento.mockReturnValue(of(respuesta([pedido(2)], 1)));

    comp.cambiarFiltro('CANCELADA');

    expect(comp.filas().map((f) => f.id_orden)).toEqual([2]); // no [1, 2]
    const [, opciones] = getSeguimiento.mock.calls.at(-1)!;
    expect(opciones.estado).toBe('CANCELADA');
    expect(opciones.offset).toBe(0);
  });

  it('«cargar más» SUMA a lo que ya había, con el offset correcto', () => {
    fixture.detectChanges(); // trae [1]
    getSeguimiento.mockReturnValue(of(respuesta([pedido(2)], 2)));

    comp.buscar(false);

    expect(comp.filas().map((f) => f.id_orden)).toEqual([1, 2]);
    const [, opciones] = getSeguimiento.mock.calls.at(-1)!;
    expect(opciones.offset).toBe(1); // lo que ya había en pantalla
  });

  it('hayMas() es falso cuando ya se trajeron todos', () => {
    fixture.detectChanges();
    expect(comp.hayMas()).toBe(false); // 1 de 1

    getSeguimiento.mockReturnValue(of(respuesta([pedido(1), pedido(2)], 5)));
    comp.buscar(true);
    expect(comp.hayMas()).toBe(true); // 2 de 5
  });

  it('un 403 se lee como falta de permiso, no como un error genérico', () => {
    getSeguimiento.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { message: 'nope' } })));
    fixture.detectChanges();

    expect(comp.error()).toMatch(/no tiene permiso/i);
    expect(comp.filas()).toEqual([]);
  });

  it('un error de servidor conserva el mensaje del backend', () => {
    getSeguimiento.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Error al obtener el seguimiento de pedidos.' } })));
    fixture.detectChanges();

    expect(comp.error()).toBe('Error al obtener el seguimiento de pedidos.');
  });

  it('toggleFila abre y cierra la línea de tiempo de un pedido', () => {
    fixture.detectChanges();
    expect(comp.filaAbierta()).toBeNull();

    comp.toggleFila(1);
    expect(comp.filaAbierta()).toBe(1);

    comp.toggleFila(1); // vuelve a pulsarla: se cierra
    expect(comp.filaAbierta()).toBeNull();

    comp.toggleFila(2); // otra fila: cambia, no se acumula
    expect(comp.filaAbierta()).toBe(2);
  });

  it('buscar() con un filtro de texto lo manda saneado (sin espacios)', () => {
    fixture.detectChanges();
    comp.q.set('  ORD-9999  ');
    comp.buscar(true);

    const [, opciones] = getSeguimiento.mock.calls.at(-1)!;
    expect(opciones.q).toBe('ORD-9999');
  });
});
