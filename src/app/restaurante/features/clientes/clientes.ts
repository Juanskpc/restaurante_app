import {
  ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import {
  ClientesService, CuentaCliente, ModoCuenta, MovimientoCuenta,
} from '../../../core/services/clientes.service';
import { RealtimeService } from '../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

type Filtro = 'todos' | 'deben' | 'a_favor';
type Modal = null | 'nueva' | 'abono' | 'ajuste' | 'editar';

/**
 * ClientesComponent — tiqueteras y fiado.
 *
 * En un restaurante de barrio hay clientes de confianza que **pagan el mes por adelantado**
 * (la tiquetera) y otros que **comen y pagan al final** (el fiado). No son dos cosas: es la
 * misma cuenta con el signo cambiado, y por eso es una sola pantalla.
 *
 *   saldo positivo → tiene comida pagada por delante
 *   saldo negativo → debe plata, hasta donde llegue su cupo
 *
 * La lista arranca ordenada por quién debe, porque «¿quién me debe?» es la pregunta que el
 * dueño se hace todos los días; «¿cuánto tengo cobrado por adelantado?» es la de fin de mes.
 */
@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, LucideAngularModule],
  templateUrl: './clientes.html',
  styleUrl: './clientes.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientesComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ClientesService);
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly realtime = inject(RealtimeService);
  private readonly ui = inject(UiFeedbackService);
  private readonly destroyRef = inject(DestroyRef);

  readonly cuentas = signal<CuentaCliente[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly busqueda = signal('');
  readonly filtro = signal<Filtro>('todos');

  readonly seleccionada = signal<CuentaCliente | null>(null);
  readonly movimientos = signal<MovimientoCuenta[]>([]);
  readonly cargandoMovimientos = signal(false);

  readonly modal = signal<Modal>(null);
  readonly metodosPago = signal<Array<{ id_metodo_pago: number; nombre: string; es_cuenta?: boolean }>>([]);
  readonly productos = signal<Array<{ id_producto: number; nombre: string; precio: number }>>([]);

  // ── Formularios ──
  readonly formNombre = signal('');
  readonly formTelefono = signal('');
  readonly formModo = signal<ModoCuenta>('DINERO');
  readonly formCupo = signal<number | null>(null);
  readonly formNota = signal('');

  readonly abonoMonto = signal<number | null>(null);
  readonly abonoTiquetes = signal<number | null>(null);
  readonly abonoProducto = signal<number | null>(null);
  readonly abonoMetodo = signal<number | null>(null);
  readonly abonoConcepto = signal('');

  readonly ajusteTipo = signal<'ABONO' | 'CARGO'>('ABONO');
  readonly ajusteMonto = signal<number | null>(null);
  readonly ajusteTiquetes = signal<number | null>(null);
  readonly ajusteProducto = signal<number | null>(null);
  readonly ajusteMotivo = signal('');

  readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  /** Vender tiqueteras y recibir pagos mueve plata: va detrás de su propio permiso. */
  readonly puedeAbonar = computed(() => this.auth.canAccessSubnivel('clientes_abonar'));
  /** Perdonar deudas NO mueve plata y por eso es más delicado: no deja rastro en caja. */
  readonly puedeAjustar = computed(() => this.auth.canAccessSubnivel('clientes_ajustar'));

  /** Lo que el negocio tiene cobrado por adelantado y lo que le deben, de un vistazo. */
  readonly totalPorCobrar = computed(() =>
    this.cuentas().filter((c) => c.saldo < 0).reduce((s, c) => s + Math.abs(c.saldo), 0),
  );
  readonly totalAnticipado = computed(() =>
    this.cuentas().filter((c) => c.saldo > 0).reduce((s, c) => s + c.saldo, 0),
  );
  readonly cuentasEnTiquetes = computed(() => this.cuentas().filter((c) => c.modo === 'TIQUETES').length);

  readonly esTiquetes = computed(() => this.seleccionada()?.modo === 'TIQUETES');

  /** Formas de pago con las que se puede RECIBIR dinero (la de la propia cuenta no cuenta). */
  readonly metodosCobrables = computed(() => this.metodosPago().filter((m) => !m.es_cuenta));

  private timerBusqueda: ReturnType<typeof setTimeout> | null = null;

  private readonly recargaPorBusqueda = effect(() => {
    // Se leen para que el efecto dependa de ellas.
    this.busqueda();
    this.filtro();
    if (this.timerBusqueda) clearTimeout(this.timerBusqueda);
    this.timerBusqueda = setTimeout(() => this.cargar(), 300);
  });

  ngOnInit(): void {
    this.cargarCatalogos();
    this.destroyRef.onDestroy(
      this.realtime.alCambiar(['clientes'], () => {
        this.cargar();
        const sel = this.seleccionada();
        if (sel) this.refrescarSeleccionada(sel.id_cuenta);
      }),
    );
  }

  // ============================================================
  // Carga
  // ============================================================

  cargar(): void {
    const id = this.negocioId();
    if (!id) return;

    this.cargando.set(true);
    this.api.listar(id, { busqueda: this.busqueda().trim() || null, filtro: this.filtro() }).subscribe({
      next: (res) => {
        this.cuentas.set(res?.data ?? []);
        this.cargando.set(false);
      },
      error: () => {
        this.cuentas.set([]);
        this.cargando.set(false);
      },
    });
  }

  private cargarCatalogos(): void {
    const id = this.negocioId();
    if (!id) return;

    this.catalogo.metodosPago(id).subscribe({
      next: (data) => this.metodosPago.set((data as never[]) ?? []),
      error: () => this.metodosPago.set([]),
    });

    this.catalogo.productos(id).subscribe({
      next: (data) => this.productos.set((data as never[]) ?? []),
      error: () => this.productos.set([]),
    });
  }

  seleccionar(cuenta: CuentaCliente): void {
    this.seleccionada.set(cuenta);
    this.refrescarSeleccionada(cuenta.id_cuenta);
  }

  cerrarDetalle(): void {
    this.seleccionada.set(null);
    this.movimientos.set([]);
  }

  private refrescarSeleccionada(idCuenta: number): void {
    const id = this.negocioId();
    if (!id) return;

    this.cargandoMovimientos.set(true);
    this.api.detalle(idCuenta, id).subscribe({
      next: (res) => {
        if (res?.data) this.seleccionada.set(res.data);
      },
    });
    this.api.movimientos(idCuenta, id).subscribe({
      next: (res) => {
        this.movimientos.set(res?.data ?? []);
        this.cargandoMovimientos.set(false);
      },
      error: () => {
        this.movimientos.set([]);
        this.cargandoMovimientos.set(false);
      },
    });
  }

  // ============================================================
  // Modales
  // ============================================================

  abrirNueva(): void {
    this.formNombre.set('');
    this.formTelefono.set('');
    this.formModo.set('DINERO');
    this.formCupo.set(null);
    this.formNota.set('');
    this.modal.set('nueva');
  }

  abrirEditar(): void {
    const c = this.seleccionada();
    if (!c) return;
    this.formModo.set(c.modo);
    this.formCupo.set(c.cupo || null);
    this.formNota.set(c.nota ?? '');
    this.modal.set('editar');
  }

  abrirAbono(): void {
    this.abonoMonto.set(null);
    this.abonoTiquetes.set(null);
    this.abonoProducto.set(this.productos()[0]?.id_producto ?? null);
    this.abonoMetodo.set(this.metodosCobrables()[0]?.id_metodo_pago ?? null);
    this.abonoConcepto.set('');
    this.modal.set('abono');
  }

  abrirAjuste(): void {
    this.ajusteTipo.set('ABONO');
    this.ajusteMonto.set(null);
    this.ajusteTiquetes.set(null);
    this.ajusteProducto.set(this.productos()[0]?.id_producto ?? null);
    this.ajusteMotivo.set('');
    this.modal.set('ajuste');
  }

  cerrarModal(): void {
    if (this.guardando()) return;
    this.modal.set(null);
  }

  // ============================================================
  // Acciones
  // ============================================================

  guardarNueva(): void {
    const id = this.negocioId();
    if (!id || this.guardando()) return;

    const nombre = this.formNombre().trim();
    if (nombre.length < 2) {
      this.ui.error('Escribe el nombre del cliente.');
      return;
    }

    this.guardando.set(true);
    this.api.crear({
      id_negocio: id,
      nombre,
      // El teléfono es opcional: media clientela de tiquetera no lo da, y exigirlo llevaría a
      // inventar números. Si lo hay, la cuenta queda enlazada con la ficha de WhatsApp.
      telefono: this.formTelefono().trim() || null,
      modo: this.formModo(),
      cupo: this.formCupo() ?? 0,
      nota: this.formNota().trim() || null,
    }).subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.created('Cuenta creada correctamente.');
        this.cargar();
        if (res?.data) this.seleccionar(res.data);
      },
      error: (err) => this.fallo(err, 'No se pudo crear la cuenta.'),
    });
  }

  guardarEdicion(): void {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    this.guardando.set(true);
    this.api.actualizar(cuenta.id_cuenta, {
      id_negocio: id,
      modo: this.formModo(),
      cupo: this.formCupo() ?? 0,
      nota: this.formNota().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.updated('Cuenta actualizada.');
        this.cargar();
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo actualizar la cuenta.'),
    });
  }

  guardarAbono(): void {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    const monto = Number(this.abonoMonto());
    if (!(monto > 0)) {
      this.ui.error('Escribe cuánto dinero está entrando.');
      return;
    }
    if (!this.abonoMetodo()) {
      this.ui.error('Elige con qué está pagando.');
      return;
    }
    if (cuenta.modo === 'TIQUETES' && !(Number(this.abonoTiquetes()) > 0)) {
      this.ui.error('Escribe cuántos tiquetes se compran.');
      return;
    }

    this.guardando.set(true);
    this.api.abonar(cuenta.id_cuenta, {
      id_negocio: id,
      id_metodo_pago: Number(this.abonoMetodo()),
      monto,
      tiquetes: cuenta.modo === 'TIQUETES' ? Number(this.abonoTiquetes()) : 0,
      id_producto: cuenta.modo === 'TIQUETES' ? this.abonoProducto() : null,
      concepto: this.abonoConcepto().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.success('El dinero quedó registrado en la caja del turno.', 'Abono registrado');
        this.cargar();
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo registrar el abono.'),
    });
  }

  async guardarAjuste(): Promise<void> {
    const id = this.negocioId();
    const cuenta = this.seleccionada();
    if (!id || !cuenta || this.guardando()) return;

    const motivo = this.ajusteMotivo().trim();
    if (motivo.length < 3) {
      this.ui.error('Un ajuste necesita un motivo escrito.');
      return;
    }

    // Se confirma a propósito: es la única operación que cambia un saldo sin que entre ni
    // salga un peso de la caja, así que nadie debería hacerla sin querer.
    const seguir = await this.ui.confirm({
      title: 'Ajustar el saldo',
      message: 'Esto cambia el saldo del cliente sin que entre ni salga dinero de la caja. ¿Continuar?',
      confirmText: 'Ajustar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!seguir) return;

    this.guardando.set(true);
    this.api.ajustar(cuenta.id_cuenta, {
      id_negocio: id,
      tipo: this.ajusteTipo(),
      monto: cuenta.modo === 'DINERO' ? Number(this.ajusteMonto()) || 0 : 0,
      tiquetes: cuenta.modo === 'TIQUETES' ? Number(this.ajusteTiquetes()) || 0 : 0,
      id_producto: cuenta.modo === 'TIQUETES' ? this.ajusteProducto() : null,
      concepto: motivo,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.modal.set(null);
        this.ui.updated('Ajuste registrado.');
        this.cargar();
        this.refrescarSeleccionada(cuenta.id_cuenta);
      },
      error: (err) => this.fallo(err, 'No se pudo registrar el ajuste.'),
    });
  }

  // ============================================================
  // Presentación
  // ============================================================

  /** Cómo se lee el saldo en la lista, sin que el usuario tenga que pensar en signos. */
  etiquetaSaldo(cuenta: CuentaCliente): string {
    if (cuenta.modo === 'TIQUETES') {
      const total = cuenta.total_tiquetes ?? 0;
      return total === 1 ? '1 tiquete' : `${total} tiquetes`;
    }
    if (cuenta.saldo < 0) return 'Debe';
    if (cuenta.saldo > 0) return 'A favor';
    return 'Al día';
  }

  claseSaldo(cuenta: CuentaCliente): string {
    if (cuenta.modo === 'TIQUETES') return (cuenta.total_tiquetes ?? 0) > 0 ? 'ok' : 'neutro';
    if (cuenta.saldo < 0) return 'debe';
    if (cuenta.saldo > 0) return 'ok';
    return 'neutro';
  }

  private fallo(err: HttpErrorResponse, porDefecto: string): void {
    this.guardando.set(false);
    this.ui.error(err?.error?.message || porDefecto);
  }
}
