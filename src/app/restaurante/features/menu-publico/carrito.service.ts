import { Injectable, computed, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface ItemCarrito {
  id_producto: number;
  nombre: string;
  precio: number;
  cantidad: number;
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
  v: 2;
  guardado: number;
  /** Cuándo se abrió WhatsApp con este pedido, o `null` si todavía no. */
  enviadoEn: number | null;
  items: ItemCarrito[];
}

@Injectable({ providedIn: 'root' })
export class CarritoService {
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _items = signal<ItemCarrito[]>([]);
  private readonly _idNegocio = signal<number | null>(null);
  private readonly _enviadoEn = signal<number | null>(null);

  readonly items = this._items.asReadonly();

  readonly cantidadTotal = computed(() =>
    this._items().reduce((n, i) => n + i.cantidad, 0)
  );

  readonly total = computed(() =>
    this._items().reduce((n, i) => n + i.precio * i.cantidad, 0)
  );

  readonly vacio = computed(() => this._items().length === 0);

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
  }

  agregar(producto: { id_producto: number; nombre: string; precio: number }): void {
    this._items.update((items) => {
      const existente = items.find((i) => i.id_producto === producto.id_producto);
      if (existente) {
        return items.map((i) =>
          i.id_producto === producto.id_producto ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      }
      return [...items, { ...producto, cantidad: 1 }];
    });
    this.guardar();
  }

  /** Baja una unidad, y quita el item si llega a cero. */
  quitar(idProducto: number): void {
    this._items.update((items) =>
      items
        .map((i) => (i.id_producto === idProducto ? { ...i, cantidad: i.cantidad - 1 } : i))
        .filter((i) => i.cantidad > 0)
    );
    this.guardar();
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

  cantidadDe(idProducto: number): number {
    return this._items().find((i) => i.id_producto === idProducto)?.cantidad ?? 0;
  }

  /**
   * El mensaje que se abre en WhatsApp: legible arriba, código abajo.
   *
   * El código va en la última línea y solo. Así el bot lo encuentra sin ambigüedad aunque el
   * cliente escriba algo antes de enviar, que es lo que suele pasar.
   */
  mensajeParaWhatsApp(): string {
    const items = this._items();
    const lineas = items.map((i) => `• ${i.cantidad} × ${i.nombre}`);
    const codigo = this.codigoCompacto();

    return [
      'Hola, quiero pedir:',
      '',
      ...lineas,
      '',
      `Total aproximado: ${this.formatearPrecio(this.total())}`,
      '',
      codigo,
    ].join('\n');
  }

  /** `#P<negocio>-<idProducto>x<cantidad>,...` */
  codigoCompacto(): string {
    const partes = this._items().map((i) => `${i.id_producto}x${i.cantidad}`);
    return `#P${this._idNegocio() ?? 0}-${partes.join(',')}`;
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
      v: 2,
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

      if (!sobre || sobre.v !== 2 || !Number.isFinite(sobre.guardado)) return descartar();
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
        }));
    } catch {
      // JSON corrupto: no hay nada que rescatar, y dejarlo repetiría el fallo en cada carga.
      return descartar();
    }
  }
}
