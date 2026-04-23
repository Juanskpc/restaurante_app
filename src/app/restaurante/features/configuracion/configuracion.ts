import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { PaletteService } from '../../../core/theme/palette.service';
import { PaletaColor } from '../../../core/theme/palette.model';
import { ConfiguracionService, MetodoPago } from './configuracion.service';
import { ConfiguracionNegocio } from './configuracion.models';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

@Component({
  selector: 'app-configuracion',
  imports: [ReactiveFormsModule, LucideAngularModule],
  templateUrl: './configuracion.html',
  styleUrl: './configuracion.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfiguracionComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly paletteService = inject(PaletteService);
  private readonly configuracionService = inject(ConfiguracionService);
  private readonly uiFeedback = inject(UiFeedbackService);

  readonly negocioActivoId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly successMessage = signal<string | null>(null);
  readonly configuracion = signal<ConfiguracionNegocio | null>(null);
  readonly paletas = signal<PaletaColor[]>([]);

  readonly canEdit = computed(() => this.configuracion()?.can_edit === true);

  // ── Métodos de pago ──
  readonly metodosPago = signal<MetodoPago[]>([]);
  readonly cargandoMetodos = signal(false);
  readonly nuevoMetodoNombre = signal('');
  readonly editandoMetodoId = signal<number | null>(null);
  readonly editandoMetodoNombre = signal('');
  readonly guardandoMetodo = signal(false);
  readonly errorMetodo = signal<string | null>(null);

  readonly form = this.fb.group({
    nombre: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2), Validators.maxLength(255)],
    }),
    nit: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    email_contacto: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.email, Validators.maxLength(255)],
    }),
    telefono: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    id_paleta: this.fb.control<number | null>(null),
  });

  constructor() {
    effect(() => {
      const idNegocio = this.negocioActivoId();
      if (!idNegocio) {
        this.configuracion.set(null);
        return;
      }

      this.cargarCatalogos();
      this.cargarConfiguracion(idNegocio);
      this.cargarMetodosPago(idNegocio);
    });
  }

  // ── Métodos de pago ──
  cargarMetodosPago(idNegocio: number): void {
    this.cargandoMetodos.set(true);
    this.errorMetodo.set(null);
    this.configuracionService.listarMetodosPago(idNegocio).subscribe({
      next: (rows) => { this.metodosPago.set(rows); this.cargandoMetodos.set(false); },
      error: () => { this.metodosPago.set([]); this.cargandoMetodos.set(false); },
    });
  }

  agregarMetodoPago(): void {
    const idNegocio = this.negocioActivoId();
    const nombre = this.nuevoMetodoNombre().trim();
    if (!idNegocio || !nombre) return;
    this.guardandoMetodo.set(true);
    this.errorMetodo.set(null);
    this.configuracionService.crearMetodoPago(idNegocio, nombre).subscribe({
      next: () => {
        this.guardandoMetodo.set(false);
        this.nuevoMetodoNombre.set('');
        this.uiFeedback.success(`"${nombre}" se agregó correctamente.`, 'Método creado');
        this.cargarMetodosPago(idNegocio);
      },
      error: (e) => {
        this.guardandoMetodo.set(false);
        const msg = e?.error?.message || 'No se pudo crear el método de pago.';
        this.errorMetodo.set(msg);
        this.uiFeedback.error(msg);
      },
    });
  }

  iniciarEdicionMetodo(m: MetodoPago): void {
    this.editandoMetodoId.set(m.id_metodo_pago);
    this.editandoMetodoNombre.set(m.nombre);
    this.errorMetodo.set(null);
  }

  cancelarEdicionMetodo(): void {
    this.editandoMetodoId.set(null);
    this.editandoMetodoNombre.set('');
  }

  guardarEdicionMetodo(): void {
    const idNegocio = this.negocioActivoId();
    const id = this.editandoMetodoId();
    const nombre = this.editandoMetodoNombre().trim();
    if (!idNegocio || !id || !nombre) return;
    this.guardandoMetodo.set(true);
    this.configuracionService.actualizarMetodoPago(id, idNegocio, nombre).subscribe({
      next: () => {
        this.guardandoMetodo.set(false);
        this.uiFeedback.success(`Se actualizó a "${nombre}".`, 'Método actualizado');
        this.cancelarEdicionMetodo();
        this.cargarMetodosPago(idNegocio);
      },
      error: (e) => {
        this.guardandoMetodo.set(false);
        const msg = e?.error?.message || 'No se pudo actualizar.';
        this.errorMetodo.set(msg);
        this.uiFeedback.error(msg);
      },
    });
  }

  async inactivarMetodo(m: MetodoPago): Promise<void> {
    const idNegocio = this.negocioActivoId();
    if (!idNegocio) return;
    const confirmar = await this.uiFeedback.confirm({
      title: 'Eliminar método de pago',
      message: `¿Estás seguro de eliminar "${m.nombre}"? No afectará pedidos ya cobrados.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmar) return;
    this.configuracionService.inactivarMetodoPago(m.id_metodo_pago, idNegocio).subscribe({
      next: () => {
        this.uiFeedback.success(`"${m.nombre}" fue eliminado.`, 'Método eliminado');
        this.cargarMetodosPago(idNegocio);
      },
      error: (e) => {
        const msg = e?.error?.message || 'No se pudo eliminar el método.';
        this.uiFeedback.error(msg);
      },
    });
  }

  cargarConfiguracion(idNegocio: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.configuracionService
      .getConfiguracion(idNegocio)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (config) => {
          this.configuracion.set(config);
          this.form.patchValue({
            nombre: config.nombre || '',
            nit: config.nit || '',
            email_contacto: config.email_contacto || '',
            telefono: config.telefono || '',
            id_paleta: config.id_paleta ?? null,
          });

          if (config.paleta) {
            this.paletteService.applyPalette(config.paleta);
          }
        },
        error: (error) => {
          this.errorMessage.set(error?.error?.message || 'No fue posible cargar la configuracion.');
          this.configuracion.set(null);
        },
      });
  }

  cargarCatalogos(): void {
    this.configuracionService.getPaletas().subscribe({
      next: (rows) => this.paletas.set(rows),
      error: () => this.paletas.set([]),
    });
  }

  seleccionarPaleta(idPaleta: number): void {
    this.form.controls.id_paleta.setValue(idPaleta);
    const paleta = this.paletas().find((item) => item.id_paleta === idPaleta);
    if (paleta) {
      this.paletteService.applyPalette(paleta);
    }
  }

  guardarConfiguracion(): void {
    const idNegocio = this.negocioActivoId();
    if (!idNegocio) {
      this.errorMessage.set('No se encontro un negocio activo.');
      return;
    }

    if (!this.canEdit()) {
      this.errorMessage.set('No tienes permisos para editar esta configuracion.');
      return;
    }

    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const value = this.form.getRawValue();
    this.saving.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    this.configuracionService
      .updateConfiguracion({
        id_negocio: idNegocio,
        nombre: value.nombre.trim(),
        nit: value.nit?.trim() || null,
        email_contacto: value.email_contacto?.trim() || null,
        telefono: value.telefono?.trim() || null,
        id_paleta: value.id_paleta,
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: async (config) => {
          this.configuracion.set(config);
          this.successMessage.set('Configuracion guardada correctamente.');

          if (config.paleta) {
            this.paletteService.applyPalette(config.paleta);
          }

          const token = this.auth.getAccessToken();
          if (token) {
            const ok = await this.auth.validateAndSetToken(token);
            if (ok) {
              this.auth.setNegocioActivo(idNegocio);
            }
          }
        },
        error: (error) => {
          this.errorMessage.set(error?.error?.message || 'No fue posible guardar la configuracion.');
        },
      });
  }
}
