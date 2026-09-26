import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import { BarrioDomicilio, ConfiguracionService } from '../configuracion.service';

/**
 * Configuración → Operación → Barrios con precio de domicilio.
 *
 * La lista que ve el cliente en la carta virtual al pedir a domicilio. El servidor relee el
 * valor por id al crear la orden: lo que se escribe aquí es lo único que se cobra.
 */
@Component({
  selector: 'app-barrios-panel',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './barrios-panel.html',
  styleUrl: './barrios-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarriosPanelComponent implements OnInit {
  private readonly api = inject(ConfiguracionService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  /** Solo el administrador escribe; los demás ven la lista. */
  readonly canEdit = input(false);

  private readonly idNegocio = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly barrios = signal<BarrioDomicilio[]>([]);
  readonly guardando = signal(false);

  readonly nuevoNombre = signal('');
  readonly nuevoValor = signal('');

  readonly editandoId = signal<number | null>(null);
  readonly editandoNombre = signal('');
  readonly editandoValor = signal('');

  private readonly formato = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });

  readonly puedeCrear = computed(
    () => this.nuevoNombre().trim().length >= 2 && this.aNumero(this.nuevoValor()) !== null,
  );

  ngOnInit(): void {
    this.cargar();
  }

  dinero(valor: number): string {
    return this.formato.format(valor);
  }

  /** «4500», «4.500» o «$ 4,500» → 4500. `null` si no es un valor válido. */
  private aNumero(texto: string): number | null {
    const limpio = texto.replace(/[^\d]/g, '');
    if (!limpio) return null;
    const n = Number(limpio);
    return Number.isFinite(n) && n <= 1_000_000 ? n : null;
  }

  cargar(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.cargando.set(true);
    this.api.listarBarrios(id).subscribe({
      next: (lista) => {
        this.barrios.set(lista);
        this.error.set('');
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudieron cargar los barrios.');
        this.cargando.set(false);
      },
    });
  }

  crear(): void {
    const id = this.idNegocio();
    const valor = this.aNumero(this.nuevoValor());
    if (!id || valor === null || !this.puedeCrear() || this.guardando()) return;

    this.guardando.set(true);
    this.api.crearBarrio(id, this.nuevoNombre().trim(), valor).subscribe({
      next: () => {
        this.guardando.set(false);
        this.nuevoNombre.set('');
        this.nuevoValor.set('');
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo crear el barrio.');
      },
    });
  }

  iniciarEdicion(b: BarrioDomicilio): void {
    this.editandoId.set(b.id_barrio);
    this.editandoNombre.set(b.nombre);
    this.editandoValor.set(String(b.valor));
  }

  cancelarEdicion(): void {
    this.editandoId.set(null);
  }

  guardarEdicion(): void {
    const id = this.idNegocio();
    const idBarrio = this.editandoId();
    const valor = this.aNumero(this.editandoValor());
    const nombre = this.editandoNombre().trim();
    if (!id || !idBarrio || valor === null || nombre.length < 2 || this.guardando()) return;

    this.guardando.set(true);
    this.api.actualizarBarrio(idBarrio, id, nombre, valor).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editandoId.set(null);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo guardar el barrio.');
      },
    });
  }

  async eliminar(b: BarrioDomicilio): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;
    const ok = await this.ui.confirm({
      title: 'Quitar barrio',
      message: `«${b.nombre}» dejará de aparecer en la carta. Los pedidos ya hechos no cambian.`,
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;

    this.guardando.set(true);
    this.api.eliminarBarrio(b.id_barrio, id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo quitar el barrio.');
      },
    });
  }
}
