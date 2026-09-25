import { Injectable, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import {
  CLIENTE_VACIO,
  CampoCliente,
  DatosCliente,
  MAXIMOS,
  lineasDelBloque,
  limpiarTelefono,
  sanear,
} from './datos-cliente';

/** Un ingrediente que el cliente quitó de un plato («sin cebolla»). */
export interface IngredienteQuitado {
  id_ingrediente: number;
  nombre: string;
}

/**
 * Una LÍNEA del carrito: un producto y lo que se le quitó. Dos líneas del mismo producto con
 * distintas exclusiones son líneas distintas («una sin cebolla» y «una con todo»); se suman solo
 * las que coinciden en las dos cosas. `claveLinea` es lo que las identifica.
 */
export interface ItemCarrito {
  id_producto: number;
  nombre: string;
  precio: number;
  cantidad: number;
  exclusiones: IngredienteQuitado[];
}

/** Tope de ingredientes quitados por línea: el mismo que lee el bot (`MAX_EXCLUSIONES`). */
export const MAX_EXCLUSIONES = 12;

/** Identidad de una línea: producto + ids quitados, ordenados. `4:12.15`, o `4:` sin exclusiones. */
export function claveLinea(item: Pick<ItemCarrito, 'id_producto' | 'exclusiones'>): string {
  const ids = [...new Set(item.exclusiones.map((e) => e.id_ingrediente))].sort((a, b) => a - b);
  return `${item.id_producto}:${ids.join('.')}`;
}

/** Cuánto se recuerdan nombre, teléfono y dirección de un cliente que repite: 90 días. */
const VIGENCIA_CLIENTE_MS = 90 * 24 * 60 * 60 * 1000;

/** Más largo que esto el texto legible del mensaje se recorta (la línea `#P…` jamás). */
const MAX_TEXTO_HUMANO = 1500;

/** Cómo quiere pedir: en el local (mesa), a domicilio o recoger. Son las letras del código (`~m=`). */
export type Modalidad = 'L' | 'D' | 'R';

/** Barrio elegido para el domicilio. `id_barrio: 0` = «Otro barrio»: el restaurante confirma el valor. */
export interface BarrioElegido {
  id_barrio: number;
  nombre: string;
  /** `null` en «Otro barrio»: no hay valor que sumar. */
  valor: number | null;
}

export interface MesaElegida {
  id_mesa: number;
  nombre: string;
  numero: number;
}

/**
 * El carrito del menú digital.
 *
 * ## Por qué vive entero en el navegador
 *
 * No hay endpoint, ni sesión, ni nada que guardar en el servidor. El carrito se arma aquí, viaja
 * dentro del enlace de WhatsApp y el pedido lo crea el asistente **cuando el cliente escribe**,
 * con su número ya verificado por Meta.
 *
 * Eso no es pereza: es lo que evita construir un chat web autenticado. Un carrito en el servidor
 * necesitaría saber de quién es —y en una página pública eso significa claves por negocio,
 * sesiones emitidas por el servidor y límites por sesión, que es justo el trabajo que este diseño
 * se ahorra—. Además, un pedido anónimo desde la web no trae identidad: cualquiera podría mandar
 * una dirección inventada. Entrando por WhatsApp, el teléfono viene firmado por Meta.
 *
 * ## El código compacto, y por qué no se manda prosa
 *
 * El mensaje que se abre lleva **dos cosas**: el pedido en texto para que lo lea una persona, y
 * una última línea para que la lea el bot:
 *
 *     #P12-39x2,41x1
 *
 * Si solo fuera prosa, el bot tendría que *entenderla*, y eso lo hace bien el modelo pero cuesta
 * dinero y puede equivocarse. Con el código, leer el pedido es determinista y gratis. Van ids y
 * no nombres porque un enlace tiene un largo práctico limitado y los nombres se lo comen.
 *
 * **El precio de aquí no manda.** El asistente relee el catálogo al crear la orden, así que si
 * algo cambió de precio o se agotó entre que el cliente miró y escribió, gana el catálogo. Lo que
 * se muestra aquí es una estimación honesta, no una promesa.
 */
/**
 * Cuánto tiempo sigue valiendo un carrito guardado.
 *
 * Guardarlo sirve para que cerrar la pestaña sin querer no borre veinte minutos de elegir. No
 * sirve para nada más allá de esa visita: un carrito de anteayer no es «lo que iba a pedir», es
 * basura que aparece con la insignia encendida y hace creer que hay un pedido en marcha.
 *
 * Cuatro horas cubren de sobra una visita —incluida la de un sitio que abre de 8 de la tarde a
 * 2 de la madrugada— y no llegan nunca a la cena del día siguiente.
 */
const VIGENCIA_MS = 4 * 60 * 60 * 1000;

/** Forma con la que se guarda. La versión permite tirar formatos viejos sin adivinar su edad. */
interface CarritoGuardado {
  v: 3;
  guardado: number;
  /** Cuándo se abrió WhatsApp con este pedido, o `null` si todavía no. */
  enviadoEn: number | null;
  items: ItemCarrito[];
}

/** Lo que el cliente eligió sobre cómo pedir. Se guarda aparte del carrito: no es un pedido. */
interface EleccionGuardada {
  v: 1;
  guardado: number;
  modalidad: Modalidad | null;
  barrio: BarrioElegido | null;
  mesa: MesaElegida | null;
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _items = signal<ItemCarrito[]>([]);
  private readonly _idNegocio = signal<number | null>(null);
  private readonly _enviadoEn = signal<number | null>(null);

  readonly items = this._items.asReadonly();

  // ── Cómo quiere pedir ─────────────────────────────────────────────────────────────────
  //
  // Valor inicial `null` SIEMPRE, en el servidor y en el cliente: lo guardado se lee en
  // `iniciar` solo en el navegador. Así el primer render coincide con el del servidor.
  private readonly _modalidad = signal<Modalidad | null>(null);
  private readonly _barrio = signal<BarrioElegido | null>(null);
  private readonly _mesa = signal<MesaElegida | null>(null);

  // ── Datos del cliente (nombre, teléfono, dirección, nota) ─────────────────────────────
  //
  // Se piden en el panel antes de abrir WhatsApp. Se recuerdan por negocio en el navegador para
  // quien repite (menos la nota, que es de ESTE pedido). Valor inicial vacío en servidor y cliente.
  private readonly _cliente = signal<DatosCliente>({ ...CLIENTE_VACIO });
  readonly cliente = this._cliente.asReadonly();

  readonly modalidad = this._modalidad.asReadonly();
  readonly barrio = this._barrio.asReadonly();
  readonly mesa = this._mesa.asReadonly();

  /** Lo que cuesta el domicilio a ese barrio; 0 si no es domicilio, no hay barrio o es «otro». */
  readonly domicilio = computed(() =>
    this._modalidad() === 'D' ? (this._barrio()?.valor ?? 0) : 0
  );

  readonly cantidadTotal = computed(() =>
    this._items().reduce((n, i) => n + i.cantidad, 0)
  );

  readonly total = computed(() =>
    this._items().reduce((n, i) => n + i.precio * i.cantidad, 0)
  );

  readonly vacio = computed(() => this._items().length === 0);

  /** El total con el domicilio del barrio elegido. Sigue siendo aproximado. */
  readonly totalConDomicilio = computed(() => this.total() + this.domicilio());

  /**
   * Ata el carrito a un negocio y recupera lo que hubiera guardado.
   *
   * La clave lleva el id del negocio a propósito: quien mire dos cartas distintas no debe
   * encontrarse los platos de una en el carrito de la otra.
   */
  iniciar(idNegocio: number): void {
    this._idNegocio.set(idNegocio);
    this._enviadoEn.set(null);
    this._items.set(this.leerGuardado(idNegocio));
    this.restaurarEleccion(idNegocio);
    this.restaurarCliente(idNegocio);
  }

  /** Cambia uno o varios datos del cliente y los recuerda (sin la nota). */
  guardarCliente(cambios: Partial<DatosCliente>): void {
    this._cliente.update((c) => ({ ...c, ...cambios }));
    this.guardarClienteEnNavegador();
  }

  // ── La elección: cómo lo quiere recibir ───────────────────────────────────────────────

  /** Cambiar la modalidad suelta lo que ya no aplica: un barrio no vale en el local, ni una mesa a domicilio. */
  elegirModalidad(modalidad: Modalidad | null): void {
    this._modalidad.set(modalidad);
    if (modalidad !== 'D') this._barrio.set(null);
    if (modalidad !== 'L') this._mesa.set(null);
    this.guardarEleccion();
  }

  elegirBarrio(barrio: BarrioElegido | null): void {
    this._barrio.set(barrio);
    this.guardarEleccion();
  }

  elegirMesa(mesa: MesaElegida | null): void {
    this._mesa.set(mesa);
    this.guardarEleccion();
  }

  /**
   * Suma una unidad a la línea de ese producto con esas exclusiones (la crea si no existe).
   * Sin exclusiones suma a la línea «con todo», como siempre.
   */
  agregar(
    producto: { id_producto: number; nombre: string; precio: number },
    exclusiones: IngredienteQuitado[] = [],
  ): void {
    const limpias = [...new Map(exclusiones.map((e) => [e.id_ingrediente, e])).values()]
      .sort((a, b) => a.id_ingrediente - b.id_ingrediente)
      .slice(0, MAX_EXCLUSIONES);
    const nueva: ItemCarrito = { ...producto, cantidad: 1, exclusiones: limpias };
    const clave = claveLinea(nueva);
    this._items.update((items) =>
      items.some((i) => claveLinea(i) === clave)
        ? items.map((i) => (claveLinea(i) === clave ? { ...i, cantidad: i.cantidad + 1 } : i))
        : [...items, nueva]
    );
    this.guardar();
  }

  /**
   * Cambia la cantidad de UNA línea (el «− n +» del pre-pedido). Llega a cero → la línea sale.
   */
  sumarALinea(clave: string, delta: number): void {
    this._items.update((items) =>
      items
        .map((i) => (claveLinea(i) === clave ? { ...i, cantidad: i.cantidad + delta } : i))
        .filter((i) => i.cantidad > 0)
    );
    this.guardar();
  }

  /**
   * Baja una unidad del producto: de la línea MÁS RECIENTE de ese producto (la última que se
   * añadió). Es el «−» de la tarjeta, que no sabe de líneas; el pre-pedido ajusta cada una.
   */
  quitar(idProducto: number): void {
    const items = this._items();
    let indice = -1;
    items.forEach((i, k) => {
      if (i.id_producto === idProducto) indice = k;
    });
    if (indice < 0) return;
    this.sumarALinea(claveLinea(items[indice]), -1);
  }

  eliminar(idProducto: number): void {
    this._items.update((items) => items.filter((i) => i.id_producto !== idProducto));
    this.guardar();
  }

  vaciar(): void {
    this._items.set([]);
    this._enviadoEn.set(null);
    this.guardar();
  }

  /**
   * El pedido ya se entregó a WhatsApp.
   *
   * No se vacía aquí: si el cliente vuelve atrás sin darle a enviar en WhatsApp, encontrarse el
   * carrito vacío sería perderle el trabajo. Lo que se hace es marcarlo, y así **la próxima vez
   * que abra la página** empieza limpio en vez de resucitar un pedido que ya salió.
   */
  marcarEnviado(): void {
    this._enviadoEn.set(Date.now());
    this.guardar();
  }

  /** El «n» del stepper: la suma de TODAS las líneas de ese producto, con o sin exclusiones. */
  cantidadDe(idProducto: number): number {
    return this._items()
      .filter((i) => i.id_producto === idProducto)
      .reduce((n, i) => n + i.cantidad, 0);
  }

  /**
   * El mensaje que se abre en WhatsApp: legible arriba, código abajo.
   *
   * El código va en la última línea y solo. Así el bot lo encuentra sin ambigüedad aunque el
   * cliente escriba algo antes de enviar, que es lo que suele pasar.
   */
  mensajeParaWhatsApp(): string {
    const items = this._items();
    const codigo = this.codigoCompacto();

    // Sin modalidad elegida el mensaje es idéntico al de siempre.
    const cuando = this.lineaModalidad();
    const domicilio = this.domicilio();

    // El bloque de datos del cliente va ANTES de la línea `#P`, con etiquetas fijas que el bot lee
    // por etiqueta. Solo las que aplican a la modalidad y tienen valor.
    const bloque = lineasDelBloque(this._modalidad(), this._cliente());

    const cola = [
      '',
      ...(cuando ? [cuando] : []),
      ...(domicilio > 0 ? [`Domicilio: ${this.formatearPrecio(domicilio)}`] : []),
      `Total aproximado: ${this.formatearPrecio(this.totalConDomicilio())}`,
      '',
      ...(bloque.length ? [...bloque, ''] : []),
    ];

    // El texto legible se recorta si se pasa (la URL de wa.me tiene largo práctico); la línea
    // `#P…` NUNCA: es lo que lee el bot y lleva el pedido completo.
    const lineas = items.map((i) => this.lineaLegible(i));
    const largoFijo = ['Hola, quiero pedir:', '', ...cola].join('\n').length + codigo.length + 1;
    let usado = largoFijo;
    const visibles: string[] = [];
    for (const l of lineas) {
      if (usado + l.length + 1 > MAX_TEXTO_HUMANO + codigo.length) break;
      visibles.push(l);
      usado += l.length + 1;
    }
    const resto = lineas.length - visibles.length;
    if (resto > 0) visibles.push(`• … y ${resto} más (van en el código de abajo)`);

    return ['Hola, quiero pedir:', '', ...visibles, ...cola, codigo].join('\n');
  }

  /** `• 1 × Hamburguesa (sin cebolla, sin tomate)`. */
  private lineaLegible(i: ItemCarrito): string {
    const sin = i.exclusiones.length
      ? ` (${i.exclusiones.map((e) => `sin ${e.nombre}`).join(', ')})`
      : '';
    return `• ${i.cantidad} × ${i.nombre}${sin}`;
  }

  /** La línea legible que dice cómo lo quiere recibir, o `null` si no eligió. */
  private lineaModalidad(): string | null {
    switch (this._modalidad()) {
      case 'D': {
        const barrio = this._barrio();
        return barrio ? `A domicilio · ${barrio.id_barrio === 0 ? 'otro barrio' : barrio.nombre}` : 'A domicilio';
      }
      case 'R':
        return 'Para recoger en el local';
      case 'L': {
        const mesa = this._mesa();
        return mesa ? `En el local · ${mesa.nombre}` : 'En el local';
      }
      default:
        return null;
    }
  }

  /**
   * `#P<negocio>-<idProducto>x<cantidad>[-r<ing>.<ing>],...` y, si el cliente ya eligió cómo lo quiere,
   * modificadores `~m=D|R|L`, `~z=<id barrio>` (0 = otro barrio) y `~t=<id mesa>`.
   *
   * ⚠️ Contrato con `admin_ws/intelligence/adapters/restaurante/codigoPedido.js`, que los lee.
   * Sin elección el código es el de siempre. Ver `docs/asistente-restaurante.md`.
   */
  codigoCompacto(): string {
    // `-r12.15`: los ingredientes que se quitan de ESA línea (ids, ordenados). Sin exclusiones la
    // línea es `4x1`, como siempre.
    const partes = this._items().map((i) => {
      const ids = [...new Set(i.exclusiones.map((e) => e.id_ingrediente))].sort((a, b) => a - b);
      return `${i.id_producto}x${i.cantidad}${ids.length ? `-r${ids.join('.')}` : ''}`;
    });
    return `#P${this._idNegocio() ?? 0}-${partes.join(',')}${this.modificadores()}`;
  }

  private modificadores(): string {
    const modalidad = this._modalidad();
    if (!modalidad) return '';
    let sufijo = `~m=${modalidad}`;
    const barrio = this._barrio();
    if (modalidad === 'D' && barrio) sufijo += `~z=${barrio.id_barrio}`;
    const mesa = this._mesa();
    if (modalidad === 'L' && mesa) sufijo += `~t=${mesa.id_mesa}`;
    return sufijo;
  }

  /**
   * El enlace a WhatsApp, o `null` si el negocio no tiene número publicado.
   *
   * Acepta que `url_whatsapp` venga como número suelto («3152812484»), como E.164 o como una URL
   * de `wa.me`/`api.whatsapp.com` ya hecha: los tres formatos aparecen en la práctica según quién
   * haya rellenado el campo, y fallar por eso sería castigar al negocio por un detalle de forma.
   */
  enlaceWhatsApp(urlWhatsapp: string | null | undefined): string | null {
    const numero = this.extraerNumero(urlWhatsapp);
    if (!numero) return null;
    return `https://wa.me/${numero}?text=${encodeURIComponent(this.mensajeParaWhatsApp())}`;
  }

  private extraerNumero(valor: string | null | undefined): string | null {
    if (!valor) return null;
    const digitos = String(valor).replace(/\D/g, '');
    if (!digitos) return null;
    // Móvil colombiano sin indicativo: se le antepone el 57. Con indicativo ya viene bien.
    if (digitos.length === 10 && digitos.startsWith('3')) return `57${digitos}`;
    return digitos;
  }

  private formatearPrecio(valor: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(valor);
  }

  // ── Persistencia de los datos del cliente ────────────────────────────────────────────
  //
  // Para que quien repite no vuelva a escribirlos. Se guarda sin la nota (es de este pedido) y
  // con una vigencia larga: es una comodidad, no un pedido en marcha. Solo en el navegador y
  // dentro de try/catch, como todo lo demás.

  private claveCliente(idNegocio: number): string {
    return `escalapp.cliente.${idNegocio}`;
  }

  private guardarClienteEnNavegador(): void {
    const id = this._idNegocio();
    if (id === null || !isPlatformBrowser(this.platformId)) return;
    const { nombre, telefono, direccion } = this._cliente();
    try {
      localStorage.setItem(
        this.claveCliente(id),
        JSON.stringify({ v: 1, guardado: Date.now(), nombre, telefono, direccion }),
      );
    } catch {
      // Sin almacenamiento los datos duran lo que dure la pestaña.
    }
  }

  private restaurarCliente(idNegocio: number): void {
    this._cliente.set({ ...CLIENTE_VACIO });
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const crudo = localStorage.getItem(this.claveCliente(idNegocio));
      if (!crudo) return;
      const s = JSON.parse(crudo);
      const vale =
        s && s.v === 1 && Number.isFinite(s.guardado) && Date.now() - s.guardado <= VIGENCIA_CLIENTE_MS;
      if (!vale) {
        localStorage.removeItem(this.claveCliente(idNegocio));
        return;
      }
      const texto = (v: unknown, campo: CampoCliente) =>
        typeof v === 'string' ? sanear(v, MAXIMOS[campo]) : '';
      this._cliente.set({
        nombre: texto(s.nombre, 'nombre'),
        telefono: limpiarTelefono(texto(s.telefono, 'telefono')),
        direccion: texto(s.direccion, 'direccion'),
        nota: '',
      });
    } catch {
      // JSON corrupto o sin acceso: se empieza con el formulario vacío.
    }
  }

  // ── Persistencia de la elección ──────────────────────────────────────────────────────

  private claveEleccion(idNegocio: number): string {
    return `escalapp.pedido.${idNegocio}`;
  }

  private guardarEleccion(): void {
    const id = this._idNegocio();
    if (id === null || !isPlatformBrowser(this.platformId)) return;
    const sobre: EleccionGuardada = {
      v: 1,
      guardado: Date.now(),
      modalidad: this._modalidad(),
      barrio: this._barrio(),
      mesa: this._mesa(),
    };
    try {
      localStorage.setItem(this.claveEleccion(id), JSON.stringify(sobre));
    } catch {
      // Sin almacenamiento la elección dura lo que dure la pestaña.
    }
  }

  /** Solo en el navegador y con vigencia, como el carrito. Lo inválido se descarta y se borra. */
  private restaurarEleccion(idNegocio: number): void {
    this._modalidad.set(null);
    this._barrio.set(null);
    this._mesa.set(null);
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const crudo = localStorage.getItem(this.claveEleccion(idNegocio));
      if (!crudo) return;
      const sobre = JSON.parse(crudo);
      const vale =
        sobre &&
        sobre.v === 1 &&
        Number.isFinite(sobre.guardado) &&
        Date.now() - sobre.guardado <= VIGENCIA_MS &&
        (sobre.modalidad === 'L' || sobre.modalidad === 'D' || sobre.modalidad === 'R');
      if (!vale) {
        localStorage.removeItem(this.claveEleccion(idNegocio));
        return;
      }
      this._modalidad.set(sobre.modalidad);
      const b = sobre.barrio;
      if (
        sobre.modalidad === 'D' && b && Number.isInteger(b.id_barrio) && b.id_barrio >= 0 &&
        typeof b.nombre === 'string' && (b.valor === null || Number.isFinite(b.valor))
      ) {
        this._barrio.set({ id_barrio: b.id_barrio, nombre: b.nombre, valor: b.valor });
      }
      const m = sobre.mesa;
      if (
        sobre.modalidad === 'L' && m && Number.isInteger(m.id_mesa) && m.id_mesa > 0 &&
        typeof m.nombre === 'string' && Number.isInteger(m.numero)
      ) {
        this._mesa.set({ id_mesa: m.id_mesa, nombre: m.nombre, numero: m.numero });
      }
    } catch {
      // JSON corrupto o sin acceso: se empieza sin elección.
    }
  }

  // ── Persistencia ──────────────────────────────────────────────────────────────────────
  //
  // Se guarda para que cerrar la pestaña sin querer no borre veinte minutos de elegir. Todo va
  // envuelto en try/catch y detrás de `isPlatformBrowser`: esto se renderiza en el servidor
  // (SSR) donde `localStorage` no existe, y en un navegador en modo privado puede lanzar.

  private clave(idNegocio: number): string {
    return `escalapp.carrito.${idNegocio}`;
  }

  private guardar(): void {
    const id = this._idNegocio();
    if (id === null || !isPlatformBrowser(this.platformId)) return;
    const sobre: CarritoGuardado = {
      v: 3,
      guardado: Date.now(),
      enviadoEn: this._enviadoEn(),
      items: this._items(),
    };
    try {
      localStorage.setItem(this.clave(id), JSON.stringify(sobre));
    } catch {
      // Un carrito que no se puede guardar sigue sirviendo mientras la pestaña esté abierta.
    }
  }

  /**
   * Lo guardado, si todavía vale.
   *
   * Se descarta en tres casos: cuando no trae la forma actual —incluido el formato viejo, que
   * era un array pelado sin fecha y por tanto de edad desconocida—, cuando ha pasado la
   * vigencia, y cuando ese pedido ya se mandó por WhatsApp.
   *
   * Descartar es también BORRAR. Si solo se ignorara, lo viejo se quedaría en el navegador del
   * cliente para siempre, y cualquier cambio futuro de criterio lo haría reaparecer.
   */
  private leerGuardado(idNegocio: number): ItemCarrito[] {
    if (!isPlatformBrowser(this.platformId)) return [];

    const descartar = (): ItemCarrito[] => {
      try {
        localStorage.removeItem(this.clave(idNegocio));
      } catch {
        // Si no se puede borrar, se sigue ignorando igual.
      }
      return [];
    };

    try {
      const crudo = localStorage.getItem(this.clave(idNegocio));
      if (!crudo) return [];
      const sobre = JSON.parse(crudo);

      // La v2 (sin exclusiones) se sigue leyendo: un carrito a medias no se pierde por un cambio de formato.
      if (!sobre || (sobre.v !== 3 && sobre.v !== 2) || !Number.isFinite(sobre.guardado)) {
        return descartar();
      }
      if (Date.now() - sobre.guardado > VIGENCIA_MS) return descartar();
      if (sobre.enviadoEn !== null && sobre.enviadoEn !== undefined) return descartar();

      const datos = sobre.items;
      if (!Array.isArray(datos)) return descartar();
      // Se valida lo que vuelve: es entrada del exterior, aunque la haya escrito esta misma
      // aplicación hace una semana con otra versión del formato.
      return datos
        .filter(
          (i) =>
            i &&
            Number.isInteger(i.id_producto) &&
            typeof i.nombre === 'string' &&
            Number.isFinite(i.precio) &&
            Number.isInteger(i.cantidad) &&
            i.cantidad > 0
        )
        .map((i) => ({
          id_producto: i.id_producto,
          nombre: i.nombre,
          precio: i.precio,
          cantidad: i.cantidad,
          exclusiones: Array.isArray(i.exclusiones)
            ? i.exclusiones
                .filter(
                  (e: { id_ingrediente?: unknown; nombre?: unknown }) =>
                    e && Number.isInteger(e.id_ingrediente) && typeof e.nombre === 'string'
                )
                .slice(0, MAX_EXCLUSIONES)
                .map((e: IngredienteQuitado) => ({
                  id_ingrediente: e.id_ingrediente,
                  nombre: e.nombre,
                }))
            : [],
        }));
    } catch {
      // JSON corrupto: no hay nada que rescatar, y dejarlo repetiría el fallo en cada carga.
      return descartar();
    }
  }
}
