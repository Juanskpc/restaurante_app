import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { forkJoin } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import {
  BarrioDomicilio,
  ConfiguracionService,
  ZonaDomicilio,
  ZonasDomicilio,
} from '../configuracion.service';

/** Sin tildes ni mayúsculas, para buscar como escribe una persona. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Configuración → Cobros → Barrios y veredas.
 *
 * El precio del domicilio por comuna/corregimiento y, si hace falta, por barrio: el barrio usa el
 * suyo y, si no tiene, el de su zona. Un barrio sin ninguno no se le ofrece al cliente. Es la
 * lista que ve la carta virtual y la que usa el asistente de WhatsApp; el servidor relee el valor
 * por id al crear la orden, así que lo que se escribe aquí es lo único que se cobra.
 *
 * Para llenarla de una vez: «Cargar listado de Pasto» (sin precios), o la plantilla de Excel.
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
  private readonly document = inject(DOCUMENT);
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));

  /** Solo el administrador escribe; los demás ven la lista. */
  readonly canEdit = input(false);
  /** Con el cobro de domicilio apagado, ni la carta ni el asistente preguntan el barrio. */
  readonly pagoDomicilioActivo = input(true);

  private readonly idNegocio = computed(() => this.auth.negocio()?.id_negocio ?? null);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly barrios = signal<BarrioDomicilio[]>([]);
  readonly zonas = signal<ZonaDomicilio[]>([]);
  readonly catalogos = signal<ZonasDomicilio['catalogos']>([]);
  readonly guardando = signal(false);

  readonly busqueda = signal('');
  readonly abiertas = signal<ReadonlySet<number>>(new Set());

  // Alta de un barrio a mano.
  readonly nuevoNombre = signal('');
  readonly nuevoValor = signal('');
  readonly nuevaZona = signal<number | null>(null);

  // Subir o bajar todos los domicilios a la vez.
  readonly ajusteMonto = signal('');

  private readonly formato = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  });

  /** La ciudad cuyo listado se ofrece (hoy solo Pasto). */
  readonly ciudad = computed(() => this.catalogos()[0]?.ciudad ?? null);

  /** Zona por zona con sus barrios; con búsqueda, solo lo que coincide (y la zona se abre sola). */
  readonly grupos = computed(() => {
    const q = normalizar(this.busqueda());
    const porZona = new Map<number, BarrioDomicilio[]>();
    for (const b of this.barrios()) {
      if (!b.id_zona_domicilio) continue;
      const lista = porZona.get(b.id_zona_domicilio) ?? [];
      lista.push(b);
      porZona.set(b.id_zona_domicilio, lista);
    }
    return this.zonas()
      .map((zona) => {
        const todos = porZona.get(zona.id_zona_domicilio) ?? [];
        const coincideZona = !q || normalizar(zona.nombre).includes(q);
        const barrios = coincideZona ? todos : todos.filter((b) => normalizar(b.nombre).includes(q));
        return { zona, barrios, abierta: !!q && !coincideZona ? true : this.abiertas().has(zona.id_zona_domicilio) };
      })
      .filter((g) => !q || g.barrios.length > 0 || normalizar(g.zona.nombre).includes(q));
  });

  /** Los barrios que no cuelgan de ninguna zona (los de antes, o escritos a mano). */
  readonly sueltos = computed(() => {
    const q = normalizar(this.busqueda());
    return this.barrios().filter((b) => !b.id_zona_domicilio && (!q || normalizar(b.nombre).includes(q)));
  });

  readonly conPrecio = computed(() => this.barrios().filter((b) => b.valor_efectivo != null).length);

  readonly puedeCrear = computed(() => {
    if (this.nuevoNombre().trim().length < 2) return false;
    // Con zona el precio es opcional (usa el de la zona); suelto, obligatorio.
    return this.nuevaZona() !== null || this.aNumero(this.nuevoValor()) !== null;
  });

  ngOnInit(): void {
    this.cargar();
  }

  dinero(valor: number | null | undefined): string {
    return valor == null ? '' : this.formato.format(valor);
  }

  /** «4500», «4.500» o «$ 4,500» → 4500. `null` si está vacío o no es válido. */
  aNumero(texto: string): number | null {
    const limpio = String(texto ?? '').replace(/[^\d]/g, '');
    if (!limpio) return null;
    const n = Number(limpio);
    return Number.isFinite(n) && n <= 1_000_000 ? n : null;
  }

  cargar(): void {
    const id = this.idNegocio();
    if (!id) return;
    this.cargando.set(true);
    forkJoin({ barrios: this.api.listarBarrios(id), zonas: this.api.listarZonas(id) }).subscribe({
      next: ({ barrios, zonas }) => {
        this.barrios.set(barrios);
        this.zonas.set(zonas.zonas);
        this.catalogos.set(zonas.catalogos);
        this.error.set('');
        this.cargando.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message || 'No se pudieron cargar los barrios.');
        this.cargando.set(false);
      },
    });
  }

  alternarZona(idZona: number): void {
    const s = new Set(this.abiertas());
    if (s.has(idZona)) s.delete(idZona);
    else s.add(idZona);
    this.abiertas.set(s);
  }

  // ── Listado de la ciudad ──

  async cargarCatalogo(): Promise<void> {
    const id = this.idNegocio();
    const ciudad = this.ciudad();
    if (!id || !ciudad || this.guardando()) return;
    if (this.zonas().length > 0) {
      const ok = await this.ui.confirm({
        title: `Completar con el listado de ${ciudad}`,
        message: 'Se agregan las comunas, corregimientos, barrios y veredas que te falten, sin precio. Lo que ya tienes no cambia.',
        confirmText: 'Completar',
        cancelText: 'Cancelar',
        tone: 'info',
      });
      if (!ok) return;
    }
    this.guardando.set(true);
    this.api.importarCatalogoBarrios(id, ciudad).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.ui.success(
          r.barrios_nuevos > 0
            ? `Se cargaron ${r.zonas_nuevas} zonas y ${r.barrios_nuevos} barrios y veredas. Ahora ponle precio a cada zona.`
            : 'Ya tenías todo el listado.',
          'Barrios y veredas',
        );
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo cargar el listado.');
      },
    });
  }

  // ── Zonas ──

  /** Guarda el precio de la zona al salir del campo o con Enter (vacío = sin precio). */
  guardarPrecioZona(zona: ZonaDomicilio, texto: string): void {
    const id = this.idNegocio();
    const valor = this.aNumero(texto);
    if (!id || valor === zona.valor || this.guardando()) return;
    this.guardando.set(true);
    this.api.actualizarZona(zona.id_zona_domicilio, id, valor).subscribe({
      next: () => {
        this.guardando.set(false);
        this.zonas.update((lista) =>
          lista.map((z) => (z.id_zona_domicilio === zona.id_zona_domicilio ? { ...z, valor } : z)),
        );
        this.barrios.update((lista) =>
          lista.map((b) =>
            b.id_zona_domicilio === zona.id_zona_domicilio && b.valor === null ? { ...b, valor_efectivo: valor } : b,
          ),
        );
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo guardar el precio de la zona.');
      },
    });
  }

  /** Toda la zona a su precio: les quita el precio propio a sus barrios. */
  async igualarZona(zona: ZonaDomicilio): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;
    const ok = await this.ui.confirm({
      title: `Todo ${zona.nombre} al mismo precio`,
      message: `Los ${zona.con_precio_propio} barrios con precio propio pasarán a costar ${this.dinero(zona.valor) || 'lo de la zona'}.`,
      confirmText: 'Igualar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;
    this.guardando.set(true);
    this.api.actualizarZona(zona.id_zona_domicilio, id, zona.valor, true).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo igualar la zona.');
      },
    });
  }

  async quitarZona(zona: ZonaDomicilio): Promise<void> {
    const id = this.idNegocio();
    if (!id || this.guardando()) return;
    const ok = await this.ui.confirm({
      title: `Quitar ${zona.nombre}`,
      message: `Se quitan la zona y sus ${zona.barrios} barrios. Si solo no llevas ahí, basta con dejarla sin precio.`,
      confirmText: 'Quitar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;
    this.guardando.set(true);
    this.api.eliminarZona(zona.id_zona_domicilio, id).subscribe({
      next: () => {
        this.guardando.set(false);
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo quitar la zona.');
      },
    });
  }

  // ── Barrios ──

  /** Precio propio de un barrio (vacío = el de su zona). Se guarda al salir del campo o con Enter. */
  guardarPrecioBarrio(b: BarrioDomicilio, texto: string): void {
    const id = this.idNegocio();
    const valor = this.aNumero(texto);
    if (!id || valor === b.valor || this.guardando()) return;
    if (valor === null && !b.id_zona_domicilio) {
      this.ui.error('Un barrio sin comuna necesita su propio precio.');
      return;
    }
    this.guardando.set(true);
    this.api.actualizarBarrio(b.id_barrio, id, b.nombre, valor).subscribe({
      next: (actualizado) => {
        this.guardando.set(false);
        this.barrios.update((lista) => lista.map((x) => (x.id_barrio === b.id_barrio ? { ...x, ...actualizado } : x)));
        const delta = (valor === null ? -1 : 0) + (b.valor === null ? 1 : 0);
        if (delta !== 0 && b.id_zona_domicilio) {
          this.zonas.update((lista) =>
            lista.map((z) =>
              z.id_zona_domicilio === b.id_zona_domicilio ? { ...z, con_precio_propio: z.con_precio_propio + delta } : z,
            ),
          );
        }
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo guardar el precio del barrio.');
      },
    });
  }

  crear(): void {
    const id = this.idNegocio();
    if (!id || !this.puedeCrear() || this.guardando()) return;
    this.guardando.set(true);
    this.api
      .crearBarrio(id, this.nuevoNombre().trim(), this.aNumero(this.nuevoValor()), this.nuevaZona())
      .subscribe({
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

  // ── Todos a la vez ──

  /** «+1000» o «-500»: suma (o resta) a cada precio de zona y a cada precio propio. */
  async ajustarTodos(signo: 1 | -1): Promise<void> {
    const id = this.idNegocio();
    const monto = this.aNumero(this.ajusteMonto());
    if (!id || !monto || this.guardando()) return;
    const ok = await this.ui.confirm({
      title: signo > 0 ? 'Subir todos los domicilios' : 'Bajar todos los domicilios',
      message: `Cada comuna, corregimiento y barrio con precio pasa a costar ${this.dinero(monto)} ${
        signo > 0 ? 'más' : 'menos'
      }. Lo que no tiene precio sigue igual.`,
      confirmText: signo > 0 ? 'Subir' : 'Bajar',
      cancelText: 'Cancelar',
      tone: 'warning',
    });
    if (!ok) return;
    this.guardando.set(true);
    this.api.ajustarPreciosBarrios(id, signo * monto).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.ajusteMonto.set('');
        this.ui.success(
          `Listo: ${r.zonas} zonas y ${r.barrios} barrios con precio propio quedaron ${signo > 0 ? '+' : '-'}${this.dinero(monto)}.`,
          'Barrios y veredas',
        );
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudieron ajustar los precios.');
      },
    });
  }

  // ── Excel ──

  descargarPlantilla(): void {
    const id = this.idNegocio();
    if (!id || !this.esNavegador) return;
    this.api.descargarPlantillaBarrios(id, this.ciudad()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = this.document.createElement('a');
        a.href = url;
        a.download = 'barrios-domicilio.xlsx';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => this.ui.error('No se pudo descargar la plantilla.'),
    });
  }

  subirPlantilla(evento: Event): void {
    const campo = evento.target as HTMLInputElement;
    const archivo = campo.files?.[0];
    campo.value = '';
    const id = this.idNegocio();
    if (!id || !archivo || this.guardando()) return;
    this.guardando.set(true);
    this.api.subirPlantillaBarrios(id, archivo).subscribe({
      next: (r) => {
        this.guardando.set(false);
        this.ui.success(
          `Precios cargados: ${r.zonas_creadas + r.zonas_actualizadas} zonas y ` +
            `${r.barrios_creados + r.barrios_actualizados} barrios.`,
          'Barrios y veredas',
        );
        this.cargar();
      },
      error: (err) => {
        this.guardando.set(false);
        this.ui.error(err?.error?.message || 'No se pudo leer el archivo.');
      },
    });
  }
}
