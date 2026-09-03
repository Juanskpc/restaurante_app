import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../core/services/auth.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { PaletteService } from '../../../core/theme/palette.service';
import { PaletaColor } from '../../../core/theme/palette.model';
import { ConfiguracionService, MetodoPago } from './configuracion.service';
import { ConfiguracionNegocio } from './configuracion.models';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

/**
 * Mezcla un hex con blanco. `cantidad` = proporción de blanco (0 = el color tal
 * cual, 1 = blanco puro).
 *
 * Se calcula en TS y no con `color-mix()` en el estilo inline para no depender
 * de cómo Angular trate una función CSS dentro de un binding de estilo.
 */
function aclarar(hex: string, cantidad: number): string {
  const limpio = String(hex).trim().replace('#', '');
  const full = limpio.length === 3
    ? limpio.split('').map((c) => c + c).join('')
    : limpio;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;

  const canal = (desde: number) => {
    const valor = parseInt(full.slice(desde, desde + 2), 16);
    const mezclado = Math.round(valor + (255 - valor) * cantidad);
    return mezclado.toString(16).padStart(2, '0');
  };

  return `#${canal(0)}${canal(2)}${canal(4)}`;
}

function optionalUrlValidator(control: AbstractControl): ValidationErrors | null {
  const rawValue = control.value ?? '';
  const value = String(rawValue).trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return null;
    }
  } catch {
    return { url: true };
  }
  return { url: true };
}

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
  private readonly catalogo = inject(CatalogoCacheService);
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
  readonly permiteMultipago = computed(() => this.configuracion()?.permite_multipago === true);
  readonly guardandoMultipago = signal(false);

  readonly permitePagoDomicilio = computed(() => this.configuracion()?.permite_pago_domicilio === true);
  readonly guardandoPagoDomicilio = signal(false);

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
    direccion: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(255)],
    }),
    url_whatsapp: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(255), optionalUrlValidator],
    }),
    url_facebook: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(255), optionalUrlValidator],
    }),
    url_instagram: this.fb.control('', {
      nonNullable: true,
      validators: [Validators.maxLength(255), optionalUrlValidator],
    }),
    permite_multipago: this.fb.control(false, { nonNullable: true }),
    permite_pago_domicilio: this.fb.control(false, { nonNullable: true }),
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

  /**
   * Pedidos y Despacho leen las formas de pago desde CatalogoCacheService, que
   * las guarda 5 minutos en sessionStorage. Sin este aviso, un método recién
   * creado o eliminado tarda en aparecer (o desaparecer) en el POS.
   */
  private invalidarCacheMetodos(): void {
    this.catalogo.invalidate('metodos-pago');
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
        this.invalidarCacheMetodos();
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
        this.invalidarCacheMetodos();
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
        this.invalidarCacheMetodos();
        this.cargarMetodosPago(idNegocio);
      },
      error: (e) => {
        const msg = e?.error?.message || 'No se pudo eliminar el método.';
        this.uiFeedback.error(msg);
      },
    });
  }

  /**
   * Activa/desactiva el Multipago del negocio. Guarda de inmediato (switch) y
   * refresca la sesión para que las vistas de cobro tomen el flag sin recargar.
   */
  toggleMultipago(activar: boolean): void {
    const idNegocio = this.negocioActivoId();
    if (!idNegocio || !this.canEdit()) return;

    this.guardandoMultipago.set(true);
    this.configuracionService
      .updateConfiguracion({ id_negocio: idNegocio, permite_multipago: activar })
      .pipe(finalize(() => this.guardandoMultipago.set(false)))
      .subscribe({
        next: async (config) => {
          this.configuracion.set(config);
          this.form.controls.permite_multipago.setValue(activar, { emitEvent: false });
          this.uiFeedback.success(
            activar ? 'Multipago activado.' : 'Multipago desactivado.',
            'Opciones de pago'
          );

          const token = this.auth.getAccessToken();
          if (token) {
            const ok = await this.auth.validateAndSetToken(token);
            if (ok) this.auth.setNegocioActivo(idNegocio);
          }
        },
        error: (e) => {
          this.uiFeedback.error(e?.error?.message || 'No se pudo actualizar el Multipago.');
        },
      });
  }

  /**
   * Activa/desactiva el cobro del domicilio. Guarda de inmediato (switch) y refresca
   * la sesión para que Pedidos vea la casilla sin necesidad de volver a entrar.
   */
  togglePagoDomicilio(activar: boolean): void {
    const idNegocio = this.negocioActivoId();
    if (!idNegocio || !this.canEdit()) return;

    this.guardandoPagoDomicilio.set(true);
    this.configuracionService
      .updateConfiguracion({ id_negocio: idNegocio, permite_pago_domicilio: activar })
      .pipe(finalize(() => this.guardandoPagoDomicilio.set(false)))
      .subscribe({
        next: async (config) => {
          this.configuracion.set(config);
          this.form.controls.permite_pago_domicilio.setValue(activar, { emitEvent: false });
          this.uiFeedback.success(
            activar ? 'Cobro de domicilio activado.' : 'Cobro de domicilio desactivado.',
            'Domicilios'
          );

          const token = this.auth.getAccessToken();
          if (token) {
            const ok = await this.auth.validateAndSetToken(token);
            if (ok) this.auth.setNegocioActivo(idNegocio);
          }
        },
        error: (e) => {
          this.uiFeedback.error(e?.error?.message || 'No se pudo actualizar el cobro de domicilio.');
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
            direccion: config.direccion || '',
            url_whatsapp: config.url_whatsapp || '',
            url_facebook: config.url_facebook || '',
            url_instagram: config.url_instagram || '',
            permite_multipago: config.permite_multipago === true,
            permite_pago_domicilio: config.permite_pago_domicilio === true,
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

  /**
   * Colores del recuadro de cada paleta.
   *
   * Las paletas se guardan como `{ primario, acento }`; la plantilla leía
   * `colores['color-primary']`, que no existe, y por eso los recuadros salían
   * vacíos. Se derivan cuatro tonos para anticipar cómo se verá la app.
   */
  coloresPreview(paleta: PaletaColor): string[] {
    const colores = (paleta?.colores ?? {}) as Record<string, string>;
    const primario = colores['primario'] || colores['color-primary'] || '#312E81';
    const acento = colores['acento'] || colores['color-primary-hover'] || primario;

    return [
      primario,
      acento,
      aclarar(acento, 0.55),
      aclarar(primario, 0.88),
    ];
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
        direccion: value.direccion?.trim() || null,
        url_whatsapp: value.url_whatsapp?.trim() || null,
        url_facebook: value.url_facebook?.trim() || null,
        url_instagram: value.url_instagram?.trim() || null,
        permite_multipago: value.permite_multipago,
        permite_pago_domicilio: value.permite_pago_domicilio,
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
