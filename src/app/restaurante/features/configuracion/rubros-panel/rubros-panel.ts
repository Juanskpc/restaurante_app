import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../../../core/services/auth.service';
import { CategoriaDeRubro, Rubro, RubroService } from '../../../../core/services/rubro.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';

/**
 * Configuración → Sectores de ingreso.
 *
 * Para el restaurante que maneja varios tipos de comida —parrilla, sushi, pizza— y quiere saber
 * cuánto deja cada uno al final del día y del mes, aunque una misma mesa pida de los tres y
 * pague una sola vez.
 *
 * ## Por qué esto no son las cajas
 *
 * La caja es del PEDIDO: lleva turno, arqueo y cajón, y un pedido cae entero en una. El sector
 * es del PRODUCTO, y por eso un pedido mixto se reparte solo. Quien quiera dos arqueos
 * separados usa las cajas (la pestaña de al lado); quien solo quiera ver sus números partidos
 * usa esto, que no cuesta nada y no añade ningún paso al cobro.
 *
 * ## Todo en una pantalla, a propósito
 *
 * Crear el sector y decirle qué categorías son suyas se hacen aquí mismo. Repartir las
 * categorías desde la pantalla de la carta obligaría a entrar una por una y a recordar el
 * reparto de memoria; aquí se ve el mapa completo y lo que queda sin asignar.
 *
 * Una categoría solo puede estar en un sector: marcarla aquí la saca sola de donde estuviera.
 * Las que no están en ninguno son «General» —las bebidas, el mecato—, y salen agrupadas así
 * en los informes.
 */
@Component({
  selector: 'app-rubros-panel',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './rubros-panel.html',
  styleUrl: './rubros-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RubrosPanelComponent implements OnInit {
  private readonly rubroSvc = inject(RubroService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  private readonly idNegocio = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly guardando = signal(false);

  readonly rubros = signal<Rubro[]>([]);
  readonly categorias = signal<CategoriaDeRubro[]>([]);

  /** Las categorías que no están en ningún sector: la fila «General» de los informes. */
  readonly sinSector = computed(() => this.categorias().filter((c) => c.id_rubro === null));

  readonly nuevoNombre = signal('');
  readonly nuevaDescripcion = signal('');

  readonly editandoId = signal<number | null>(null);
  readonly editandoNombre = signal('');
  readonly editandoDescripcion = signal('');

  /** Qué sector tiene abierto el reparto de categorías, y qué lleva marcado sin guardar. */
  readonly repartiendoId = signal<number | null>(null);
  readonly marcadas = signal<Set<number>>(new Set());

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.cargando.set(true);
    this.rubroSvc.listar(id).subscribe({
      next: (data) => {
        this.rubros.set(data.rows ?? []);
        this.categorias.set(data.categorias ?? []);
        this.error.set('');
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudieron cargar los sectores.');
        this.cargando.set(false);
      },
    });
  }

  categoriasDe(idRubro: number): CategoriaDeRubro[] {
    return this.categorias().filter((c) => c.id_rubro === idRubro);
  }

  crear(): void {
    const id = this.idNegocio();
    const nombre = this.nuevoNombre().trim();
    if (!id || nombre.length < 2 || this.guardando()) return;

    this.guardando.set(true);
    this.rubroSvc.crear({
      id_negocio: id,
      nombre,
      descripcion: this.nuevaDescripcion().trim() || null,
    }).subscribe({
      next: (res) => {
        this.guardando.set(false);
        this.nuevoNombre.set('');
        this.nuevaDescripcion.set('');
        this.ui.success(
          `«${nombre}» quedó creado. Ahora marca qué categorías de la carta son suyas: sin eso no separa nada.`,
          'Sector creado',
        );
        this.cargar();
        // Se abre el reparto del sector nuevo: es el paso que de verdad falta.
        const creado = res?.data?.id_rubro;
        if (creado) setTimeout(() => this.abrirReparto(creado), 0);
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo crear el sector.');
      },
    });
  }

  iniciarEdicion(r: Rubro): void {
    this.repartiendoId.set(null);
    this.editandoId.set(r.id_rubro);
    this.editandoNombre.set(r.nombre);
    this.editandoDescripcion.set(r.descripcion ?? '');
  }

  cancelarEdicion(): void {
    this.editandoId.set(null);
  }

  guardarEdicion(): void {
    const id = this.idNegocio();
    const idRubro = this.editandoId();
    const nombre = this.editandoNombre().trim();
    if (!id || !idRubro || nombre.length < 2 || this.guardando()) return;

    this.guardando.set(true);
    this.rubroSvc.actualizar(idRubro, {
      id_negocio: id,
      nombre,
      descripcion: this.editandoDescripcion().trim() || null,
    }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.editandoId.set(null);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo guardar el sector.');
      },
    });
  }

  // ── Reparto de categorías ───────────────────────────────────────────────

  abrirReparto(idRubro: number): void {
    this.editandoId.set(null);
    this.repartiendoId.set(idRubro);
    this.marcadas.set(new Set(this.categoriasDe(idRubro).map((c) => c.id_categoria)));
  }

  cerrarReparto(): void {
    this.repartiendoId.set(null);
    this.marcadas.set(new Set());
  }

  estaMarcada(idCategoria: number): boolean {
    return this.marcadas().has(idCategoria);
  }

  /** De qué otro sector es una categoría, para avisar de que marcarla la va a mover. */
  sectorDe(c: CategoriaDeRubro): string | null {
    if (c.id_rubro === null || c.id_rubro === this.repartiendoId()) return null;
    return this.rubros().find((r) => r.id_rubro === c.id_rubro)?.nombre ?? null;
  }

  alternar(idCategoria: number): void {
    const copia = new Set(this.marcadas());
    if (copia.has(idCategoria)) copia.delete(idCategoria);
    else copia.add(idCategoria);
    this.marcadas.set(copia);
  }

  guardarReparto(): void {
    const id = this.idNegocio();
    const idRubro = this.repartiendoId();
    if (!id || !idRubro || this.guardando()) return;

    this.guardando.set(true);
    this.rubroSvc.fijarCategorias(idRubro, id, [...this.marcadas()]).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cerrarReparto();
        this.ui.success('Listo. Los informes por sector ya cuentan con este reparto, también los de meses anteriores.');
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudieron guardar las categorias.');
      },
    });
  }

  // ── Estado y borrado ────────────────────────────────────────────────────

  async cambiarEstado(r: Rubro): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;
    const desactivar = r.estado === 'A';

    if (desactivar) {
      const ok = await this.ui.confirm({
        title: 'Desactivar sector',
        message: `«${r.nombre}» deja de ofrecerse para repartir categorías nuevas, pero sus categorías siguen siendo suyas y los informes de los meses pasados no cambian.`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        tone: 'warning',
      });
      if (!ok) return;
    }

    this.guardando.set(true);
    this.rubroSvc.actualizar(r.id_rubro, { id_negocio: id, estado: desactivar ? 'I' : 'A' }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo cambiar el estado del sector.');
      },
    });
  }

  async eliminar(r: Rubro): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;

    const ok = await this.ui.confirm({
      title: 'Eliminar sector',
      message: r.categorias > 0
        ? `«${r.nombre}» desaparece y sus ${r.categorias} categoría(s) vuelven a «General». Los informes dejan de separar esa venta, también los de los meses pasados. Si solo quieres dejar de usarlo, desactívalo.`
        : `«${r.nombre}» desaparece. Si solo quieres dejar de usarlo, desactívalo.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'error',
    });
    if (!ok) return;

    this.guardando.set(true);
    this.rubroSvc.eliminar(r.id_rubro, id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo eliminar el sector.');
      },
    });
  }
}
