import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DecimalPipe, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { LucideAngularModule } from 'lucide-angular';
import { finalize } from 'rxjs/operators';

import { environment } from '../../../../../environments/environment';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import { ImageCropperComponent } from '../../menu/image-cropper/image-cropper';
import {
  Aviso,
  BORDES,
  BordeId,
  DisenoCarta,
  FORMATOS,
  FUENTES,
  FormatoId,
  FuenteId,
  PLANTILLAS,
  PlantillaDef,
  PlantillaId,
  acentoEfectivo,
  claveDiseno,
  clonarDiseno,
  contraste,
  evaluarAvisos,
  fuentePorId,
  inicialesNegocio,
  normalizarHex,
  plantillaPorId,
  textoSobre,
  urlGoogleFonts,
} from '../../../shared/carta-diseno/carta-diseno';
import { CartaDisenoService, DisenoAdmin } from './carta-diseno.service';

type Vista = 'movil' | 'escritorio';

/** Tamaño real al que se pinta la carta dentro del iframe, antes de escalarla. */
const LIENZO: Record<Vista, { ancho: number; alto: number }> = {
  movil: { ancho: 390, alto: 760 },
  escritorio: { ancho: 1280, alto: 820 },
};

/**
 * Editor de la carta virtual, dentro de Configuración → Apariencia.
 *
 * ## Borrador en pantalla, publicado en el servidor
 *
 * Todo lo que el administrador toca vive en `borrador` y se ve al instante en la vista
 * previa, pero nadie más lo ve hasta pulsar «Publicar carta». No hay borrador guardado en el
 * servidor: la carta de los clientes solo cambia por una decisión explícita.
 *
 * ## La vista previa es la carta real, en un iframe
 *
 * Se carga `/carta/:id?vista=previa` de esta misma aplicación y se le manda el borrador por
 * `postMessage`. Un iframe y no un componente incrustado porque la carta tiene media queries:
 * dentro de una columna de 600 px del panel, un componente se pintaría siempre en su versión
 * de escritorio. En el iframe, 390 px son de verdad 390 px.
 *
 * El logo es la excepción al borrador: se guarda al subirlo, porque es la columna del negocio
 * que también usan su sesión y la agenda.
 */
@Component({
  selector: 'app-carta-diseno-panel',
  imports: [LucideAngularModule, DecimalPipe, ImageCropperComponent],
  templateUrl: './carta-diseno-panel.html',
  styleUrl: './carta-diseno-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CartaDisenoPanelComponent {
  readonly idNegocio = input.required<number>();
  /** Un aviso pide ir a la pestaña General (donde está el WhatsApp). */
  readonly irAGeneral = output<void>();

  private readonly servicio = inject(CartaDisenoService);
  private readonly ui = inject(UiFeedbackService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  readonly plantillas = PLANTILLAS;
  readonly formatos = FORMATOS;
  readonly fuentes = FUENTES;
  readonly bordes = BORDES;

  readonly cargando = signal(true);
  readonly error = signal<string | null>(null);
  readonly publicando = signal(false);
  readonly subiendoLogo = signal(false);
  readonly datos = signal<DisenoAdmin | null>(null);

  private readonly publicado = signal<DisenoCarta>(clonarDiseno(null));
  readonly borrador = signal<DisenoCarta>(clonarDiseno(null));

  readonly vista = signal<Vista>('movil');
  readonly archivoLogo = signal<File | null>(null);
  readonly errorHex = signal<string | null>(null);

  private readonly marco = viewChild<ElementRef<HTMLElement>>('marco');
  private readonly previa = viewChild<ElementRef<HTMLIFrameElement>>('previa');
  private readonly anchoMarco = signal(0);

  // ── Derivados ──

  readonly canEdit = computed(() => this.datos()?.can_edit === true);
  readonly hayCambios = computed(
    () => claveDiseno(this.borrador()) !== claveDiseno(this.publicado()),
  );
  readonly plantillaActual = computed(() => plantillaPorId(this.borrador().plantilla));
  readonly colorNegocio = computed(() => this.datos()?.negocio.color_negocio ?? null);
  readonly logoUrl = computed(() => this.datos()?.negocio.logo_url ?? null);
  readonly iniciales = computed(() => inicialesNegocio(this.datos()?.negocio.nombre));
  readonly colorLibre = computed(() => this.datos()?.caracteristicas.carta_color_libre !== false);

  readonly acento = computed(() =>
    acentoEfectivo(this.plantillaActual(), this.borrador().marca, this.colorNegocio()),
  );
  readonly contrasteAcento = computed(() =>
    contraste(this.acento(), this.plantillaActual().paleta.surface),
  );
  readonly colorSobreAcento = computed(() => textoSobre(this.acento()));
  readonly fuentePlantilla = computed(() => fuentePorId(this.plantillaActual().fuenteTitulos));

  readonly avisos = computed<Aviso[]>(() => {
    const datos = this.datos();
    if (!datos) return [];
    return evaluarAvisos({
      diseno: this.borrador(),
      colorNegocio: this.colorNegocio(),
      estadisticas: datos.estadisticas,
      tieneLogo: Boolean(datos.negocio.logo_url),
      tieneWhatsapp: Boolean(datos.negocio.url_whatsapp),
      planIncluyeWhatsapp: datos.caracteristicas.carta_whatsapp,
    });
  });
  readonly avisosAtencion = computed(() => this.avisos().filter((a) => a.nivel === 'atencion').length);

  readonly estado = computed(() => {
    const datos = this.datos();
    if (this.hayCambios()) return { texto: 'Cambios sin publicar', tono: 'pendiente' };
    if (!datos?.personalizado) return { texto: 'Usando la carta por defecto', tono: 'neutro' };
    const fecha = datos.diseno.publicado_en ? new Date(datos.diseno.publicado_en) : null;
    if (!fecha || Number.isNaN(fecha.getTime())) return { texto: 'Publicada', tono: 'ok' };
    const cuando = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(fecha);
    return { texto: `Publicada el ${cuando}`, tono: 'ok' };
  });

  /** Enlace a la carta que ven los clientes, el mismo que abre «Ver menú digital» en Menú. */
  readonly urlCartaPublicada = computed(() => {
    const base = (environment.menuPublicoUrl || '').replace(/\/$/, '');
    return `${base}/carta/${this.idNegocio()}`;
  });

  /**
   * La vista previa sale de ESTA aplicación y no de `menuPublicoUrl`: tiene que compartir
   * origen con el panel para que el `postMessage` se acepte. En producción son lo mismo;
   * en local no.
   */
  readonly urlPrevia = computed<SafeResourceUrl | null>(() => {
    if (!this.esNavegador) return null;
    const url = new URL(`carta/${this.idNegocio()}?vista=previa`, this.document.baseURI);
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.toString());
  });

  readonly lienzo = computed(() => {
    const { ancho, alto } = LIENZO[this.vista()];
    const disponible = this.anchoMarco() || ancho;
    const escala = Math.min(1, disponible / ancho);
    return { ancho, alto, escala, altoVisible: Math.round(alto * escala) };
  });

  constructor() {
    effect(() => {
      const id = this.idNegocio();
      untracked(() => this.cargar(id));
    });

    // Cada cambio del borrador, del logo o del color base se refleja en la vista previa.
    effect(() => {
      this.borrador();
      this.logoUrl();
      this.colorNegocio();
      untracked(() => this.enviarAPrevia());
    });

    // Mide el ancho disponible para escalar la carta sin que se desborde la columna.
    effect((onCleanup) => {
      const el = this.marco()?.nativeElement;
      if (!el || !this.esNavegador || typeof ResizeObserver === 'undefined') return;
      const observador = new ResizeObserver(([entrada]) => {
        this.anchoMarco.set(Math.floor(entrada.contentRect.width));
      });
      observador.observe(el);
      onCleanup(() => observador.disconnect());
    });

    if (this.esNavegador) {
      this.cargarFuentesMuestra();

      const alMensaje = (evento: MessageEvent) => {
        if (evento.origin !== window.location.origin) return;
        if (evento.source !== this.previa()?.nativeElement.contentWindow) return;
        if (evento.data?.tipo === 'carta-lista') this.enviarAPrevia();
      };
      window.addEventListener('message', alMensaje);

      // Salir de la página con cambios sin publicar los perdería sin avisar.
      const alSalir = (evento: BeforeUnloadEvent) => {
        if (!this.hayCambios()) return;
        evento.preventDefault();
        evento.returnValue = '';
      };
      window.addEventListener('beforeunload', alSalir);

      this.destroyRef.onDestroy(() => {
        window.removeEventListener('message', alMensaje);
        window.removeEventListener('beforeunload', alSalir);
      });
    }
  }

  /** Vuelve a leer del servidor. Configuración lo llama tras guardar la paleta del negocio. */
  recargar(): void {
    this.cargar(this.idNegocio(), { conservarBorrador: true });
  }

  private cargar(idNegocio: number, { conservarBorrador = false } = {}): void {
    if (!idNegocio) return;
    this.cargando.set(!this.datos());
    this.error.set(null);

    this.servicio
      .obtener(idNegocio)
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (datos) => {
          const cambiosPrevios = conservarBorrador && this.hayCambios();
          this.datos.set(datos);
          this.publicado.set(clonarDiseno(datos.diseno));
          if (!cambiosPrevios) this.borrador.set(clonarDiseno(datos.diseno));
        },
        error: (err: HttpErrorResponse) => {
          this.error.set(err?.error?.message || 'No se pudo cargar el diseño de la carta.');
        },
      });
  }

  // ── Plantilla y formato ──

  plantillaPermitida(id: PlantillaId): boolean {
    if (id === 'esencial') return true;
    const permitidas = this.datos()?.caracteristicas.carta_plantillas ?? '*';
    return permitidas === '*' || permitidas.includes(id);
  }

  /** Un tono de muestra para la miniatura: el acento que tendría con la marca actual. */
  muestraAcento(p: PlantillaDef): string {
    return acentoEfectivo(p, this.borrador().marca, this.colorNegocio());
  }

  fuenteStack(id: FuenteId): string {
    return fuentePorId(id).stack;
  }

  /**
   * Cambia de plantilla conservando marca y opciones.
   *
   * El formato solo se cambia si el administrador no lo había tocado (seguía siendo el
   * sugerido por la plantilla anterior): pasar de Esencial a Gaceta lleva a Lista, pero quien
   * eligió Mixto a propósito lo conserva.
   */
  elegirPlantilla(id: PlantillaId): void {
    if (!this.canEdit() || !this.plantillaPermitida(id)) return;
    this.borrador.update((d) => {
      const anterior = plantillaPorId(d.plantilla);
      const nueva = plantillaPorId(id);
      const formato = d.formato === anterior.formatoSugerido ? nueva.formatoSugerido : d.formato;
      return { ...d, plantilla: id, formato };
    });
  }

  elegirFormato(id: FormatoId): void {
    if (!this.canEdit()) return;
    this.borrador.update((d) => ({ ...d, formato: id }));
  }

  // ── Marca ──

  cambiarColor(valor: string): void {
    if (!this.canEdit() || !this.colorLibre()) return;
    const hex = normalizarHex(valor);
    if (!hex) {
      this.errorHex.set('Escribe un color de 6 dígitos, por ejemplo #C2410C.');
      return;
    }
    this.errorHex.set(null);
    this.borrador.update((d) => ({ ...d, marca: { ...d.marca, color: hex } }));
  }

  /** Quita el color propio de la carta: vuelve al del negocio o al de la plantilla. */
  quitarColor(): void {
    this.errorHex.set(null);
    this.borrador.update((d) => {
      const { color: _color, ...resto } = d.marca;
      return { ...d, marca: resto };
    });
  }

  usarColorNegocio(): void {
    const color = this.colorNegocio();
    if (color) this.cambiarColor(color);
  }

  cambiarFuente(valor: string): void {
    if (!this.canEdit()) return;
    this.borrador.update((d) => {
      const { fuente_titulos: _f, ...resto } = d.marca;
      return valor === 'plantilla'
        ? { ...d, marca: resto }
        : { ...d, marca: { ...resto, fuente_titulos: valor as FuenteId } };
    });
  }

  cambiarBorde(valor: BordeId | 'plantilla'): void {
    if (!this.canEdit()) return;
    this.borrador.update((d) => {
      const { borde: _b, ...resto } = d.marca;
      return valor === 'plantilla'
        ? { ...d, marca: resto }
        : { ...d, marca: { ...resto, borde: valor } };
    });
  }

  cambiarAgotados(mostrar: boolean): void {
    if (!this.canEdit()) return;
    this.borrador.update((d) => ({ ...d, opciones: { ...d.opciones, mostrar_agotados: mostrar } }));
  }

  // ── Logo ──

  resolverImagen(url: string | null): string {
    if (!url) return '';
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    const origen = environment.apiUrl.replace(/\/restaurante\/?$/, '');
    return `${origen}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  elegirArchivoLogo(evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const archivo = campo.files?.[0] ?? null;
    // Se limpia el campo para que volver a elegir el mismo archivo dispare otra vez el cambio.
    campo.value = '';
    if (!archivo) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archivo.type)) {
      this.ui.error('Usa una imagen PNG, JPG o WEBP.');
      return;
    }
    this.archivoLogo.set(archivo);
  }

  logoRecortado(imagen: Blob): void {
    this.archivoLogo.set(null);
    this.subiendoLogo.set(true);
    this.servicio
      .subirLogo(this.idNegocio(), imagen)
      .pipe(finalize(() => this.subiendoLogo.set(false)))
      .subscribe({
        next: ({ logo_url }) => {
          this.actualizarLogo(logo_url);
          this.ui.success('El logo quedó guardado y ya se ve en tu carta.', 'Logo actualizado');
        },
        error: (err: HttpErrorResponse) => {
          this.ui.error(err?.error?.message || 'No se pudo subir el logo.');
        },
      });
  }

  async quitarLogo(): Promise<void> {
    const confirmar = await this.ui.confirm({
      title: 'Quitar logo',
      message:
        'Tu carta mostrará las iniciales del negocio en su lugar. El logo también se quita del ' +
        'resto de la plataforma.',
      confirmText: 'Quitar logo',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!confirmar) return;

    this.subiendoLogo.set(true);
    this.servicio
      .eliminarLogo(this.idNegocio())
      .pipe(finalize(() => this.subiendoLogo.set(false)))
      .subscribe({
        next: () => {
          this.actualizarLogo(null);
          this.ui.success('Se quitó el logo.');
        },
        error: (err: HttpErrorResponse) => {
          this.ui.error(err?.error?.message || 'No se pudo quitar el logo.');
        },
      });
  }

  private actualizarLogo(logoUrl: string | null): void {
    this.datos.update((d) => (d ? { ...d, negocio: { ...d.negocio, logo_url: logoUrl } } : d));
  }

  // ── Avisos ──

  ejecutarAccion(aviso: Aviso): void {
    const accion = aviso.accion;
    if (!accion) return;
    if (accion.tipo === 'usar-color' && accion.valor) this.cambiarColor(accion.valor);
    if (accion.tipo === 'ir-general') this.irAGeneral.emit();
    if (accion.tipo === 'ir-menu') void this.router.navigate(['/menu']);
  }

  // ── Publicar ──

  descartar(): void {
    this.errorHex.set(null);
    this.borrador.set(clonarDiseno(this.publicado()));
  }

  publicar(): void {
    if (!this.canEdit() || !this.hayCambios() || this.publicando()) return;
    this.publicando.set(true);
    this.servicio
      .publicar(this.idNegocio(), this.borrador())
      .pipe(finalize(() => this.publicando.set(false)))
      .subscribe({
        next: (datos) => {
          this.datos.set(datos);
          this.publicado.set(clonarDiseno(datos.diseno));
          this.borrador.set(clonarDiseno(datos.diseno));
          this.ui.success('Tus clientes ya ven el nuevo diseño.', 'Carta publicada');
        },
        error: (err: HttpErrorResponse) => {
          this.ui.error(err?.error?.message || 'No se pudo publicar la carta.');
        },
      });
  }

  // ── Vista previa ──

  alCargarPrevia(): void {
    this.enviarAPrevia();
  }

  private enviarAPrevia(): void {
    if (!this.esNavegador) return;
    const ventana = this.previa()?.nativeElement.contentWindow;
    if (!ventana) return;
    ventana.postMessage(
      {
        tipo: 'carta-diseno',
        diseno: this.borrador(),
        logo_url: this.logoUrl(),
        color_negocio: this.colorNegocio(),
      },
      window.location.origin,
    );
  }

  /** Las miniaturas enseñan cada tipografía de verdad, así que se descargan aquí. */
  private cargarFuentesMuestra(): void {
    const url = urlGoogleFonts(FUENTES);
    if (!url || this.document.head.querySelector(`link[data-carta-fuentes="${url}"]`)) return;
    const enlace = this.document.createElement('link');
    enlace.rel = 'stylesheet';
    enlace.href = url;
    enlace.setAttribute('data-carta-fuentes', url);
    this.document.head.appendChild(enlace);
  }
}
