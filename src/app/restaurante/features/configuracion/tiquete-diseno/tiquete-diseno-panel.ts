import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { LucideAngularModule } from 'lucide-angular';
import { finalize } from 'rxjs/operators';

import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import {
  CUFE_EJEMPLO,
  CampoDef,
  CampoId,
  DisenoTiquete,
  GRUPOS_CAMPOS,
  LETRAS,
  LetraId,
  MAX_TEXTO,
  OBLIGATORIOS_FE,
  PAPELES,
  PapelId,
  SEPARADORES,
  SeparadorId,
  TipoTiquete,
  claveDiseno,
  construirTiqueteHtml,
  datosDeEjemplo,
  diferenciasConDefecto,
  resolverDiseno,
  urlConsultaDian,
} from '../../../shared/tiquete-diseno/tiquete-diseno';
import { TiqueteDisenoAdmin, TiqueteDisenoService } from './tiquete-diseno.service';

type Disenos = Record<TipoTiquete, DisenoTiquete>;

function resolverAmbos(datos: TiqueteDisenoAdmin | null): Disenos {
  return {
    comun: resolverDiseno(datos?.diseno.comun, 'comun'),
    electronica: resolverDiseno(datos?.diseno.electronica, 'electronica'),
  };
}

/**
 * Editor del tiquete impreso, en Configuración → Tiquete.
 *
 * El administrador arma sus dos tiquetes —el común y el de factura electrónica— marcando qué
 * datos salen, y ve el resultado al instante con un pedido de ejemplo y los datos reales de su
 * negocio. Nada cambia en la impresión hasta pulsar «Guardar tiquete».
 *
 * La vista previa es el mismo HTML que se imprime (`construirTiqueteHtml`) dentro de un iframe:
 * los estilos del tiquete no se mezclan con los de la aplicación, y lo que se ve aquí es lo que
 * sale en papel.
 */
@Component({
  selector: 'app-tiquete-diseno-panel',
  imports: [LucideAngularModule],
  templateUrl: './tiquete-diseno-panel.html',
  styleUrl: './tiquete-diseno-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TiqueteDisenoPanelComponent {
  readonly idNegocio = input.required<number>();

  private readonly servicio = inject(TiqueteDisenoService);
  private readonly ui = inject(UiFeedbackService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly papeles = PAPELES;
  readonly letras = LETRAS;
  readonly separadores = SEPARADORES;
  readonly obligatoriosFe = OBLIGATORIOS_FE;
  readonly maxTexto = MAX_TEXTO;

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly guardando = signal(false);
  readonly datos = signal<TiqueteDisenoAdmin | null>(null);

  private readonly guardados = signal<Disenos>(resolverAmbos(null));
  readonly borradores = signal<Disenos>(resolverAmbos(null));

  readonly tipo = signal<TipoTiquete>('comun');
  readonly altoPrevia = signal(600);
  /** El QR de ejemplo se genera en el navegador; hasta entonces sale solo el CUFE. */
  private readonly qr = signal<string | null>(null);

  // ── Derivados ──

  readonly canEdit = computed(() => this.datos()?.can_edit === true);
  readonly actual = computed(() => this.borradores()[this.tipo()]);
  readonly esFe = computed(() => this.tipo() === 'electronica');
  readonly hayCambios = computed(() => {
    const b = this.borradores();
    const g = this.guardados();
    return (
      claveDiseno(b.comun) !== claveDiseno(g.comun) ||
      claveDiseno(b.electronica) !== claveDiseno(g.electronica)
    );
  });
  readonly cambiosPorTipo = computed(() => {
    const b = this.borradores();
    const g = this.guardados();
    return {
      comun: claveDiseno(b.comun) !== claveDiseno(g.comun),
      electronica: claveDiseno(b.electronica) !== claveDiseno(g.electronica),
    };
  });

  /** Los grupos de campos del tipo actual. En la factura, lo obligatorio no se ofrece. */
  readonly grupos = computed(() => {
    const fe = this.esFe();
    return GRUPOS_CAMPOS.map((g) => ({
      titulo: g.titulo,
      campos: g.campos.filter((c) => !(fe && c.obligatorioEnFe)),
    })).filter((g) => g.campos.length > 0);
  });

  /** Lo que la vista previa de la factura dice que falta en la ficha fiscal. */
  readonly faltantesFiscales = computed(() => {
    const d = this.datos();
    if (!d) return [];
    const faltan: string[] = [];
    if (!d.fiscal?.numero_documento) faltan.push('NIT');
    if (!d.fiscal?.razon_social) faltan.push('razón social');
    if (!d.fiscal?.direccion_fiscal) faltan.push('dirección fiscal');
    if (!d.resolucion) faltan.push('resolución de facturación');
    return faltan;
  });

  readonly estado = computed(() => {
    if (this.hayCambios()) return { tono: 'pendiente', texto: 'Cambios sin guardar' };
    if (this.datos()?.personalizado) return { tono: 'ok', texto: 'Guardado' };
    return { tono: 'neutro', texto: 'Tiquete por defecto' };
  });

  readonly anchoPrevia = computed(
    () => (PAPELES.find((p) => p.id === this.actual().papel)?.anchoPx ?? 280) + 32,
  );

  readonly htmlPrevia = computed<SafeHtml | null>(() => {
    const d = this.datos();
    if (!d) return null;
    const datos = datosDeEjemplo(d, this.qr());
    const html = construirTiqueteHtml(this.actual(), datos, this.tipo());
    // El HTML lo arma `construirTiqueteHtml`, que escapa todo lo que viene del negocio.
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  constructor() {
    effect(() => {
      const id = this.idNegocio();
      untracked(() => this.cargar(id));
    });

    if (this.esNavegador) void this.generarQr();
  }

  private async generarQr(): Promise<void> {
    try {
      const { toDataURL } = await import('qrcode');
      this.qr.set(await toDataURL(urlConsultaDian(CUFE_EJEMPLO), { margin: 0, width: 240 }));
    } catch {
      // Sin QR la vista previa sigue sirviendo: se ve el CUFE.
    }
  }

  recargar(): void {
    this.cargar(this.idNegocio());
  }

  private cargar(idNegocio: number): void {
    if (!idNegocio) return;
    this.cargando.set(!this.datos());
    this.error.set(null);
    this.servicio
      .obtener(idNegocio)
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (datos) => {
          this.datos.set(datos);
          const disenos = resolverAmbos(datos);
          this.guardados.set(disenos);
          this.borradores.set(structuredClone(disenos));
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(err.error?.message ?? 'No se pudo cargar el diseño del tiquete.');
        },
      });
  }

  // ── Edición ──

  elegirTipo(tipo: TipoTiquete): void {
    this.tipo.set(tipo);
  }

  private editar(cambio: (d: DisenoTiquete) => DisenoTiquete): void {
    if (!this.canEdit()) return;
    const tipo = this.tipo();
    this.borradores.update((b) => ({ ...b, [tipo]: cambio(b[tipo]) }));
  }

  elegirPapel(papel: PapelId): void {
    this.editar((d) => ({ ...d, papel }));
  }

  elegirLetra(letra: LetraId): void {
    this.editar((d) => ({ ...d, letra }));
  }

  elegirSeparador(separador: SeparadorId): void {
    this.editar((d) => ({ ...d, separador }));
  }

  alternarCampo(campo: CampoDef): void {
    this.editar((d) => ({ ...d, campos: { ...d.campos, [campo.id]: !d.campos[campo.id] } }));
  }

  campoActivo(id: CampoId): boolean {
    return this.actual().campos[id];
  }

  cambiarTexto(clave: 'encabezado' | 'pie', evento: Event): void {
    const valor = (evento.target as HTMLTextAreaElement).value.slice(0, MAX_TEXTO);
    this.editar((d) => ({ ...d, [clave]: valor }));
  }

  /** Copia el diseño de la otra pestaña: papel, letra y textos. Los campos no se tocan. */
  copiarDelOtro(): void {
    const otro: TipoTiquete = this.tipo() === 'comun' ? 'electronica' : 'comun';
    const fuente = this.borradores()[otro];
    this.editar((d) => ({
      ...d,
      papel: fuente.papel,
      letra: fuente.letra,
      separador: fuente.separador,
      encabezado: fuente.encabezado,
      pie: fuente.pie,
    }));
  }

  restablecer(): void {
    const tipo = this.tipo();
    this.editar(() => resolverDiseno(null, tipo));
  }

  descartar(): void {
    this.borradores.set(structuredClone(this.guardados()));
  }

  guardar(): void {
    if (!this.canEdit() || !this.hayCambios() || this.guardando()) return;
    const b = this.borradores();
    this.guardando.set(true);
    this.servicio
      .guardar(
        this.idNegocio(),
        diferenciasConDefecto(b.comun, 'comun'),
        diferenciasConDefecto(b.electronica, 'electronica'),
      )
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (datos) => {
          this.datos.set(datos);
          const disenos = resolverAmbos(datos);
          this.guardados.set(disenos);
          this.borradores.set(structuredClone(disenos));
          this.ui.success('El diseño de tus tiquetes quedó guardado.', 'Tiquete guardado');
        },
        error: (err: HttpErrorResponse) => {
          this.ui.error(err.error?.message ?? 'No se pudo guardar el diseño del tiquete.');
        },
      });
  }

  /** El iframe crece con el tiquete: así la vista previa no tiene su propia barra de scroll. */
  ajustarAlto(evento: Event): void {
    const doc = (evento.target as HTMLIFrameElement).contentDocument;
    const alto = doc?.documentElement?.scrollHeight;
    if (alto) this.altoPrevia.set(alto + 8);
  }
}
