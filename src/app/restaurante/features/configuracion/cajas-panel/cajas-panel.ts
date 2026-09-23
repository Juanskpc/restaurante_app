import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import { CajaService, ListadoCajas, PuntoCajaAdmin } from '../../../../core/services/caja.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';

/**
 * Configuración → Cajas.
 *
 * Una caja aquí es un RUBRO de ingreso (Restaurante, Tienda de abarrotes…): cada una lleva
 * sus turnos y su arqueo por separado. El negocio de una sola caja no necesita entrar nunca.
 *
 * Quién usa cada caja se decide al editar el usuario (Usuarios), no aquí: es donde el
 * administrador ya está pensando en esa persona. Aquí solo se cuenta cuántos tiene.
 *
 * El número de cajas lo limita el plan (incluidas + complemento «Caja adicional»); el
 * backend es quien lo hace cumplir, esto solo lo anticipa.
 */
@Component({
  selector: 'app-cajas-panel',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './cajas-panel.html',
  styleUrl: './cajas-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CajasPanelComponent implements OnInit {
  private readonly cajaSvc = inject(CajaService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  private readonly idNegocio = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly datos = signal<ListadoCajas | null>(null);

  readonly cajas = computed(() => this.datos()?.rows ?? []);
  readonly limite = computed(() => this.datos()?.limite ?? null);
  /** `null` = sin tope. */
  readonly sinCupo = computed(() => {
    const l = this.limite();
    return !!l && l.total != null && (l.disponibles ?? 0) <= 0;
  });

  readonly nuevoNombre = signal('');
  readonly nuevaDescripcion = signal('');
  readonly guardando = signal(false);

  readonly editandoId = signal<number | null>(null);
  readonly editandoNombre = signal('');
  readonly editandoDescripcion = signal('');

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.cargando.set(true);
    this.cajaSvc.listarCajas(id).subscribe({
      next: (res) => {
        this.datos.set(res?.data ?? null);
        this.error.set('');
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudieron cargar las cajas.');
        this.cargando.set(false);
      },
    });
  }

  crear(): void {
    const id = this.idNegocio();
    const nombre = this.nuevoNombre().trim();
    if (!id || nombre.length < 2 || this.guardando()) return;

    this.guardando.set(true);
    this.cajaSvc.crearCaja({
      id_negocio: id,
      nombre,
      descripcion: this.nuevaDescripcion().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.nuevoNombre.set('');
        this.nuevaDescripcion.set('');
        this.ui.success(`La caja «${nombre}» quedó creada. Todos los usuarios la ven hasta que les asignes cajas.`, 'Caja creada');
        this.cargar();
        this.recargarMias(id);
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo crear la caja.');
      },
    });
  }

  iniciarEdicion(c: PuntoCajaAdmin): void {
    this.editandoId.set(c.id_punto_caja);
    this.editandoNombre.set(c.nombre);
    this.editandoDescripcion.set(c.descripcion ?? '');
  }

  cancelarEdicion(): void {
    this.editandoId.set(null);
  }

  guardarEdicion(): void {
    const id = this.idNegocio();
    const idPunto = this.editandoId();
    const nombre = this.editandoNombre().trim();
    if (!id || !idPunto || nombre.length < 2 || this.guardando()) return;

    this.guardando.set(true);
    this.cajaSvc.actualizarCaja(idPunto, {
      id_negocio: id,
      nombre,
      descripcion: this.editandoDescripcion().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editandoId.set(null);
        this.cargar();
        this.recargarMias(id);
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo guardar la caja.');
      },
    });
  }

  async cambiarEstado(c: PuntoCajaAdmin): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;
    const desactivar = c.estado === 'A';

    if (desactivar) {
      const ok = await this.ui.confirm({
        title: 'Desactivar caja',
        message: `«${c.nombre}» dejará de aparecer para tomar pedidos y cobrar. Sus turnos y su historial se conservan.`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        tone: 'warning',
      });
      if (!ok) return;
    }

    this.guardando.set(true);
    this.cajaSvc.actualizarCaja(c.id_punto_caja, {
      id_negocio: id,
      estado: desactivar ? 'I' : 'A',
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
        this.recargarMias(id);
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo cambiar el estado de la caja.');
      },
    });
  }

  /** El selector del POS y de Caja tiene que enterarse de la caja nueva o renombrada. */
  private recargarMias(idNegocio: number): void {
    this.cajaSvc.cargarMisCajas(idNegocio, true).subscribe();
  }
}
