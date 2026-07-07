import {
  Component, ChangeDetectionStrategy, ElementRef, PLATFORM_ID,
  afterNextRender, computed, inject, input, output, signal, viewChild, OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Cropper ligero (sin dependencias) para encuadrar imágenes antes de subirlas.
 *
 * El usuario arrastra para reposicionar y usa el zoom para acercar. La región
 * visible del viewport (con la relación de aspecto exacta de la tarjeta) se
 * exporta a un canvas y se codifica en WebP — lo que recorta y comprime en un
 * solo paso, minimizando el peso del archivo guardado.
 */
@Component({
  selector: 'app-image-cropper',
  imports: [LucideAngularModule],
  templateUrl: './image-cropper.html',
  styleUrl: './image-cropper.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageCropperComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // ── Inputs ────────────────────────────────────────────────
  readonly file        = input.required<File>();
  /** Relación de aspecto ancho/alto del recorte (p.ej. 4/3 productos, 1 categorías). */
  readonly aspect      = input(1);
  /** Ancho de salida en píxeles; el alto se deriva del aspecto. */
  readonly outputWidth = input(512);
  readonly titulo      = input('Ajustar imagen');

  // ── Outputs ───────────────────────────────────────────────
  readonly recortada = output<Blob>();
  readonly cancelada = output<void>();

  // ── Refs ──────────────────────────────────────────────────
  readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  // ── Estado ────────────────────────────────────────────────
  readonly objectUrl = signal('');
  readonly cargando  = signal(true);
  readonly procesando = signal(false);

  private readonly natW = signal(0);   // dimensiones naturales de la imagen
  private readonly natH = signal(0);
  private readonly viewW = signal(0);  // dimensiones medidas del viewport
  private readonly viewH = signal(0);
  readonly zoom = signal(1);
  private readonly offX = signal(0);   // posición del borde superior-izq de la imagen
  private readonly offY = signal(0);

  private imgSource: HTMLImageElement | null = null;

  // Escala mínima para que la imagen SIEMPRE cubra el viewport (tipo object-fit: cover)
  private readonly baseScale = computed(() => {
    const nw = this.natW(), nh = this.natH(), vw = this.viewW(), vh = this.viewH();
    if (!nw || !nh || !vw || !vh) return 1;
    return Math.max(vw / nw, vh / nh);
  });
  readonly scale = computed(() => this.baseScale() * this.zoom());
  readonly dispW = computed(() => this.natW() * this.scale());
  readonly dispH = computed(() => this.natH() * this.scale());

  readonly imgLeft = computed(() => this.offX());
  readonly imgTop  = computed(() => this.offY());

  constructor() {
    afterNextRender(() => this.cargarImagen());
    if (this.isBrowser) {
      window.addEventListener('resize', this.onResize);
    }
  }

  ngOnDestroy(): void {
    if (this.isBrowser) window.removeEventListener('resize', this.onResize);
    const url = this.objectUrl();
    if (url) URL.revokeObjectURL(url);
  }

  private onResize = (): void => this.medir();

  private cargarImagen(): void {
    if (!this.isBrowser) return;
    const url = URL.createObjectURL(this.file());
    this.objectUrl.set(url);

    const img = new Image();
    img.onload = () => {
      this.imgSource = img;
      this.natW.set(img.naturalWidth);
      this.natH.set(img.naturalHeight);
      this.medir(true);
      this.cargando.set(false);
    };
    img.onerror = () => this.cargando.set(false);
    img.src = url;
  }

  /** Mide el viewport y (opcionalmente) centra la imagen. */
  private medir(centrar = false): void {
    const el = this.viewport()?.nativeElement;
    if (!el) return;
    this.viewW.set(el.clientWidth);
    this.viewH.set(el.clientHeight);
    if (centrar) this.centrar();
    else this.clamp();
  }

  private centrar(): void {
    this.offX.set((this.viewW() - this.dispW()) / 2);
    this.offY.set((this.viewH() - this.dispH()) / 2);
  }

  /** Restringe el desplazamiento para que la imagen no deje huecos. */
  private clamp(): void {
    const minX = this.viewW() - this.dispW();
    const minY = this.viewH() - this.dispH();
    this.offX.set(Math.min(0, Math.max(minX, this.offX())));
    this.offY.set(Math.min(0, Math.max(minY, this.offY())));
  }

  // ── Zoom ──────────────────────────────────────────────────
  setZoom(valor: number): void {
    const z0 = this.zoom();
    const z1 = Math.min(5, Math.max(1, valor));
    const scaleOld = this.baseScale() * z0;
    const scaleNew = this.baseScale() * z1;
    const r = scaleOld ? scaleNew / scaleOld : 1;
    // Mantener fijo el punto bajo el centro del viewport al hacer zoom.
    const cx = this.viewW() / 2, cy = this.viewH() / 2;
    this.offX.set(cx - (cx - this.offX()) * r);
    this.offY.set(cy - (cy - this.offY()) * r);
    this.zoom.set(z1);
    this.clamp();
  }

  onZoomInput(event: Event): void {
    this.setZoom(Number((event.target as HTMLInputElement).value));
  }

  // ── Arrastre (pan) ────────────────────────────────────────
  onPointerDown(event: PointerEvent): void {
    if (this.cargando()) return;
    event.preventDefault();
    const startX = event.clientX, startY = event.clientY;
    const baseX = this.offX(), baseY = this.offY();

    const move = (e: PointerEvent) => {
      this.offX.set(baseX + (e.clientX - startX));
      this.offY.set(baseY + (e.clientY - startY));
      this.clamp();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // ── Acciones ──────────────────────────────────────────────
  cancelar(): void { this.cancelada.emit(); }

  confirmar(): void {
    if (!this.imgSource || this.procesando()) return;
    this.procesando.set(true);

    const outW = Math.round(this.outputWidth());
    const outH = Math.round(outW / this.aspect());
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) { this.procesando.set(false); return; }

    const s = this.scale();
    const sx = -this.offX() / s;
    const sy = -this.offY() / s;
    const sW = this.viewW() / s;
    const sH = this.viewH() / s;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.imgSource, sx, sy, sW, sH, 0, 0, outW, outH);

    const emitir = (blob: Blob | null) => {
      this.procesando.set(false);
      if (blob) this.recortada.emit(blob);
    };
    // WebP primero (más liviano); si el navegador no lo soporta, cae a JPEG.
    canvas.toBlob(
      (webp) => (webp ? emitir(webp) : canvas.toBlob(emitir, 'image/jpeg', 0.85)),
      'image/webp',
      0.82,
    );
  }
}
