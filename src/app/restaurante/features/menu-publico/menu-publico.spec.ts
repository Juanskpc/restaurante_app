import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Lucide from 'lucide-angular';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';

import { MenuPublicoComponent } from './menu-publico';
import { CarritoService } from './carrito.service';

/**
 * «¿Cómo quieres pedir?» en la carta pública (2026-09-24).
 *
 * Lo que se sostiene:
 *   1. El selector solo aparece cuando se puede pedir Y el negocio atiende ahora.
 *      Cerrado, o sin plan/WhatsApp, no hay nada que elegir.
 *   2. «En el local» solo se ofrece si el negocio tiene mesas activas.
 *   3. El barrio solo se pregunta si el negocio cobra el domicilio por barrio.
 *   4. Lo elegido viaja en el código del pedido (`~m`, `~z`, `~t`).
 *   5. Lo guardado de otra visita que ya no vale (barrio borrado…) se suelta.
 */
describe('MenuPublicoComponent — cómo quieres pedir', () => {
  const ID = 12;
  // Todos los iconos: la plantilla usa muchos y uno que falte rompe el render.
  const iconos = Object.fromEntries(
    Object.entries(Lucide).filter(([k, v]) => /^[A-Z]/.test(k) && v && typeof v === 'object'),
  );

  let http: HttpTestingController;

  function montar(queryMesa: string | null = null) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(iconos as never) },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(queryMesa ? { mesa: queryMesa } : {}) },
            paramMap: of(convertToParamMap({ id: String(ID) })),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MenuPublicoComponent);
    fixture.detectChanges();
    return fixture;
  }

  function responder(opts: {
    estado?: string;
    whatsapp?: string | null;
    barrios?: { habilitado: boolean; barrios: { id_barrio: number; nombre: string; valor: number }[] };
    mesas?: { id_mesa: number; nombre: string; numero: number }[];
    carta?: unknown[];
  } = {}) {
    http.expectOne((r) => r.url.endsWith(`/public/negocios/${ID}`)).flush({
      success: true,
      data: {
        id_negocio: ID,
        nombre: 'Pregonchos',
        direccion: null,
        telefono: null,
        url_whatsapp: opts.whatsapp === undefined ? '3152812484' : opts.whatsapp,
        url_facebook: null,
        url_instagram: null,
        plan_activo: true,
        carta: null,
        atencion: { estado: opts.estado ?? 'abierto' },
      },
    });
    http.match((r) => r.url.includes('/public/carta/completa')).forEach((r) =>
      r.flush({ success: true, data: opts.carta ?? [] }),
    );
    // Solo se piden si se puede pedir.
    for (const r of http.match((x) => x.url.endsWith(`/public/negocios/${ID}/barrios`))) {
      r.flush({ success: true, data: opts.barrios ?? { habilitado: false, barrios: [] } });
    }
    for (const r of http.match((x) => x.url.endsWith(`/public/negocios/${ID}/mesas`))) {
      r.flush({ success: true, data: opts.mesas ?? [] });
    }
  }

  const BARRIOS = {
    habilitado: true,
    barrios: [
      { id_barrio: 7, nombre: 'Centro', valor: 4500 },
      { id_barrio: 8, nombre: 'Norte', valor: 6000 },
    ],
  };
  const MESAS = [
    { id_mesa: 3, nombre: 'Mesa 3', numero: 3 },
    { id_mesa: 4, nombre: 'Mesa 4', numero: 4 },
  ];

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  });

  afterEach(() => http?.verify());

  it('abierto y con WhatsApp: pregunta cómo quiere pedir ANTES de los productos', () => {
    const fixture = montar();
    responder({ mesas: MESAS });
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.mostrarSelector()).toBe(true);
    expect(fixture.nativeElement.querySelector('.eleccion-overlay')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('¿Cómo quieres pedir?');
  });

  it('CERRADO no muestra selector: la carta se ve, pedir queda desactivado', () => {
    for (const estado of ['fuera_de_horario', 'aun_no_abre', 'cerrado_sin_horario']) {
      TestBed.resetTestingModule();
      const fixture = montar();
      responder({ estado, mesas: MESAS });
      fixture.detectChanges();

      const comp = fixture.componentInstance;
      expect(comp.atendiendoAhora(), estado).toBe(false);
      expect(comp.mostrarSelector(), estado).toBe(false);
      expect(fixture.nativeElement.querySelector('.eleccion-overlay'), estado).toBeNull();
      // Y la franja de aviso ya no existe.
      expect(fixture.nativeElement.querySelector('.aviso-atencion'), estado).toBeNull();
      http.verify();
    }
  });

  it('sin WhatsApp publicado la carta es de solo lectura: ni botones ni selector', () => {
    const fixture = montar();
    responder({ whatsapp: null });
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.pedidosHabilitados()).toBe(false);
    expect(comp.mostrarSelector()).toBe(false);
  });

  it('«En el local» solo aparece si el negocio tiene mesas activas', () => {
    const conMesas = montar();
    responder({ mesas: MESAS });
    conMesas.detectChanges();
    expect(conMesas.nativeElement.textContent).toContain('En el local');

    TestBed.resetTestingModule();
    const sinMesas = montar();
    responder({ mesas: [] });
    sinMesas.detectChanges();
    expect(sinMesas.nativeElement.textContent).not.toContain('En el local');
    expect(sinMesas.nativeElement.textContent).toContain('A domicilio');
    expect(sinMesas.nativeElement.textContent).toContain('Recoger en el local');
  });

  it('domicilio con barrios: pregunta el barrio y el código lleva ~m=D~z=', () => {
    const fixture = montar();
    responder({ barrios: BARRIOS });
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);
    carrito.agregar({ id_producto: 4, nombre: 'Bandeja', precio: 20000 });

    comp.elegirModalidad('D');
    expect(comp.pasoEleccion()).toBe('barrio');

    comp.elegirBarrio(BARRIOS.barrios[0]);
    expect(comp.pasoEleccion()).toBeNull();
    expect(carrito.codigoCompacto()).toBe('#P12-4x1~m=D~z=7');
    expect(carrito.domicilio()).toBe(4500);
    expect(carrito.totalConDomicilio()).toBe(24500);
  });

  it('«Otro barrio»: z=0 y sin valor de domicilio', () => {
    const fixture = montar();
    responder({ barrios: BARRIOS });
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);
    carrito.agregar({ id_producto: 4, nombre: 'Bandeja', precio: 20000 });

    comp.elegirModalidad('D');
    comp.elegirBarrio(null);

    expect(carrito.codigoCompacto()).toBe('#P12-4x1~m=D~z=0');
    expect(carrito.domicilio()).toBe(0);
    expect(carrito.totalConDomicilio()).toBe(20000);
  });

  it('domicilio SIN barrios habilitados no pregunta barrio', () => {
    const fixture = montar();
    responder({ barrios: { habilitado: false, barrios: [] } });
    const comp = fixture.componentInstance;

    comp.elegirModalidad('D');
    expect(comp.pasoEleccion()).toBeNull();
    expect(TestBed.inject(CarritoService).codigoCompacto()).toBe('#P12-~m=D');
  });

  it('recoger y en el local: el código lleva ~m=R / ~m=L~t=', () => {
    const fixture = montar();
    responder({ mesas: MESAS });
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);
    carrito.agregar({ id_producto: 4, nombre: 'Bandeja', precio: 20000 });

    comp.elegirModalidad('R');
    expect(carrito.codigoCompacto()).toBe('#P12-4x1~m=R');

    comp.elegirModalidad('L');
    expect(comp.pasoEleccion()).toBe('mesa');
    comp.elegirMesa(MESAS[1]);
    expect(comp.pasoEleccion()).toBeNull();
    expect(carrito.codigoCompacto()).toBe('#P12-4x1~m=L~t=4');
  });

  it('?mesa=<id> (el QR de la mesa) la preselecciona y salta el selector', () => {
    const fixture = montar('3');
    responder({ mesas: MESAS });
    fixture.detectChanges();
    const carrito = TestBed.inject(CarritoService);

    expect(carrito.modalidad()).toBe('L');
    expect(carrito.mesa()?.id_mesa).toBe(3);
    expect(fixture.componentInstance.mostrarSelector()).toBe(false);
  });

  it('?mesa= con una mesa que no existe se ignora y se pregunta', () => {
    const fixture = montar('999');
    responder({ mesas: MESAS });
    expect(TestBed.inject(CarritoService).modalidad()).toBeNull();
    expect(fixture.componentInstance.mostrarSelector()).toBe(true);
  });

  it('un barrio guardado que ya no existe se suelta y se vuelve a preguntar', () => {
    // Otra visita dejó «Norte» guardado; el negocio lo borró desde entonces.
    localStorage.setItem(
      `escalapp.pedido.${ID}`,
      JSON.stringify({
        v: 1,
        guardado: Date.now(),
        modalidad: 'D',
        barrio: { id_barrio: 99, nombre: 'Norte viejo', valor: 1000 },
        mesa: null,
      }),
    );
    const fixture = montar();
    responder({ barrios: BARRIOS });

    expect(TestBed.inject(CarritoService).barrio()).toBeNull();
    expect(fixture.componentInstance.pasoEleccion()).toBe('barrio');
  });

  it('«en el local» guardado en un negocio que ya no tiene mesas se suelta', () => {
    localStorage.setItem(
      `escalapp.pedido.${ID}`,
      JSON.stringify({
        v: 1,
        guardado: Date.now(),
        modalidad: 'L',
        barrio: null,
        mesa: { id_mesa: 3, nombre: 'Mesa 3', numero: 3 },
      }),
    );
    montar();
    responder({ mesas: [] });

    expect(TestBed.inject(CarritoService).modalidad()).toBeNull();
  });

  it('una elección completa de otra visita no vuelve a preguntar, y ofrece cambiarla', () => {
    localStorage.setItem(
      `escalapp.pedido.${ID}`,
      JSON.stringify({ v: 1, guardado: Date.now(), modalidad: 'R', barrio: null, mesa: null }),
    );
    const fixture = montar();
    responder();
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.mostrarSelector()).toBe(false);
    expect(comp.mostrarChip()).toBe(true);
    expect(fixture.nativeElement.querySelector('.eleccion-chip')).not.toBeNull();

    comp.cambiarEleccion();
    expect(comp.mostrarSelector()).toBe(true);
  });
});

describe('MenuPublicoComponent — quitar ingredientes al agregar', () => {
  const ID = 12;
  const iconos = Object.fromEntries(
    Object.entries(Lucide).filter(([k, v]) => /^[A-Z]/.test(k) && v && typeof v === 'object'),
  );
  let http: HttpTestingController;

  const CARTA = [
    {
      id_categoria: 1, nombre: 'Platos', descripcion: null, icono: '🍔', imagen_url: null, orden: 1,
      productos: [
        {
          id_producto: 4, nombre: 'Hamburguesa', descripcion: null, precio: 20000, imagen_url: null,
          icono: '🍔', es_popular: false, disponible: true,
          ingredientes_removibles: [
            { id_ingrediente: 12, nombre: 'Cebolla' },
            { id_ingrediente: 15, nombre: 'Tomate' },
          ],
        },
        {
          id_producto: 9, nombre: 'Limonada', descripcion: null, precio: 7000, imagen_url: null,
          icono: '🍋', es_popular: false, disponible: true, ingredientes_removibles: [],
        },
        {
          id_producto: 10, nombre: 'Agua', descripcion: null, precio: 3000, imagen_url: null,
          icono: '💧', es_popular: false, disponible: true, // backend anterior: sin el campo
        },
      ],
    },
  ];

  function montar() {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(iconos as never) },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
            paramMap: of(convertToParamMap({ id: String(ID) })),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MenuPublicoComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith(`/public/negocios/${ID}`)).flush({
      success: true,
      data: {
        id_negocio: ID, nombre: 'Pregonchos', direccion: null, telefono: null,
        url_whatsapp: '3152812484', url_facebook: null, url_instagram: null, plan_activo: true,
        carta: null, atencion: { estado: 'abierto' },
      },
    });
    http.match((r) => r.url.includes('/public/carta/completa')).forEach((r) =>
      r.flush({ success: true, data: CARTA }),
    );
    http.match((x) => x.url.endsWith('/barrios')).forEach((r) =>
      r.flush({ success: true, data: { habilitado: false, barrios: [] } }),
    );
    http.match((x) => x.url.endsWith('/mesas')).forEach((r) => r.flush({ success: true, data: [] }));
    // Elección hecha: el selector de modalidad no estorba.
    TestBed.inject(CarritoService).elegirModalidad('R');
    fixture.detectChanges();
    return fixture;
  }

  const producto = (id: number) => CARTA[0].productos.find((p) => p.id_producto === id)!;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  });
  afterEach(() => http?.verify());

  it('sin ingredientes removibles el «+» agrega DIRECTO, sin modal', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);

    comp.agregarAlCarrito(producto(9) as never);
    comp.agregarAlCarrito(producto(10) as never); // sin el campo: backend anterior

    expect(comp.modalProducto()).toBeNull();
    expect(carrito.cantidadDe(9)).toBe(1);
    expect(carrito.cantidadDe(10)).toBe(1);
  });

  it('con removibles el «+» abre el modal y NO agrega todavía', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.agregarAlCarrito(producto(4) as never);
    fixture.detectChanges();

    expect(comp.modalProducto()?.id_producto).toBe(4);
    expect(TestBed.inject(CarritoService).cantidadDe(4)).toBe(0);
    const dialogo = fixture.nativeElement.querySelector('.ingredientes');
    expect(dialogo.getAttribute('role')).toBe('dialog');
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('.ingrediente input[type=checkbox]')).toHaveLength(2);
  });

  it('todos vienen incluidos: «Agregar» a un toque crea la línea «con todo»', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.agregarAlCarrito(producto(4) as never);
    comp.confirmarModalIngredientes();

    const carrito = TestBed.inject(CarritoService);
    expect(carrito.items()).toHaveLength(1);
    expect(carrito.items()[0].exclusiones).toEqual([]);
    expect(comp.modalProducto()).toBeNull();
  });

  it('marcar «quitar» crea una línea distinta con esos ingredientes', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);

    comp.agregarAlCarrito(producto(4) as never);
    comp.confirmarModalIngredientes(); // con todo
    comp.agregarAlCarrito(producto(4) as never); // el «+» abre SIEMPRE el modal
    comp.alternarQuitar(12);
    comp.confirmarModalIngredientes();

    expect(carrito.items()).toHaveLength(2);
    expect(carrito.cantidadDe(4)).toBe(2); // el «n» suma las dos líneas
    expect(carrito.codigoCompacto()).toBe('#P12-4x1,4x1-r12~m=R');
  });

  it('Esc y Cancelar cierran sin agregar nada', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.agregarAlCarrito(producto(4) as never);
    comp.onTeclaModal(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(comp.modalProducto()).toBeNull();

    comp.agregarAlCarrito(producto(4) as never);
    comp.cerrarModalIngredientes();
    expect(TestBed.inject(CarritoService).cantidadDe(4)).toBe(0);
  });

  it('desmarcar un ingrediente lo vuelve a incluir', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.agregarAlCarrito(producto(4) as never);
    comp.alternarQuitar(12);
    comp.alternarQuitar(12);
    comp.confirmarModalIngredientes();

    expect(TestBed.inject(CarritoService).items()[0].exclusiones).toEqual([]);
  });

  it('el pre-pedido muestra cada línea con su «sin X» y las ajusta por separado', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);
    comp.agregarAlCarrito(producto(4) as never);
    comp.alternarQuitar(12);
    comp.alternarQuitar(15);
    comp.confirmarModalIngredientes();
    comp.agregarAlCarrito(producto(4) as never);
    comp.confirmarModalIngredientes();

    comp.abrirPrePedido();
    fixture.detectChanges();

    const filas = fixture.nativeElement.querySelectorAll('.pre-pedido-item');
    expect(filas).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('sin Cebolla, sin Tomate');

    comp.ajustarLinea('4:12.15', 1);
    expect(carrito.items().find((i) => i.exclusiones.length)!.cantidad).toBe(2);
    expect(carrito.items().find((i) => !i.exclusiones.length)!.cantidad).toBe(1);
  });

  it('el «−» de la tarjeta resta de la línea más reciente', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    const carrito = TestBed.inject(CarritoService);
    comp.agregarAlCarrito(producto(4) as never);
    comp.alternarQuitar(12);
    comp.confirmarModalIngredientes(); // línea 1 (sin cebolla)
    comp.agregarAlCarrito(producto(4) as never);
    comp.confirmarModalIngredientes(); // línea 2 (con todo), la más reciente

    comp.quitarDelCarrito(4);

    expect(carrito.items()).toHaveLength(1);
    expect(carrito.items()[0].exclusiones.map((e) => e.id_ingrediente)).toEqual([12]);
  });

  describe('modal de ingredientes: marcado = incluido', () => {
    it('todos los checkboxes vienen MARCADOS y dicen «Incluido»', () => {
      const fixture = montar();
      fixture.componentInstance.agregarAlCarrito(producto(4) as never);
      fixture.detectChanges();

      const cajas = fixture.nativeElement.querySelectorAll('.ingrediente input[type=checkbox]');
      expect(cajas).toHaveLength(2);
      for (const c of cajas) expect((c as HTMLInputElement).checked).toBe(true);
      expect(fixture.nativeElement.querySelector('.ingredientes').textContent).toContain('Incluido');
    });

    it('DESMARCAR quita: «Sin cebolla», y el código lleva -r', () => {
      const fixture = montar();
      const comp = fixture.componentInstance;
      comp.agregarAlCarrito(producto(4) as never);
      fixture.detectChanges();

      const caja = fixture.nativeElement.querySelector('.ingrediente input') as HTMLInputElement;
      caja.click(); // desmarca la primera (Cebolla)
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.ingrediente').textContent).toContain('Sin cebolla');

      comp.confirmarModalIngredientes();
      expect(TestBed.inject(CarritoService).codigoCompacto()).toBe('#P12-4x1-r12~m=R');
    });

    it('volver a marcarlo lo incluye otra vez', () => {
      const fixture = montar();
      const comp = fixture.componentInstance;
      comp.agregarAlCarrito(producto(4) as never);
      fixture.detectChanges();
      const caja = fixture.nativeElement.querySelector('.ingrediente input') as HTMLInputElement;
      caja.click();
      caja.click();
      comp.confirmarModalIngredientes();

      expect(TestBed.inject(CarritoService).items()[0].exclusiones).toEqual([]);
    });
  });

  describe('panel «Tu pedido»', () => {
    function abrirPanel(modalidad: 'D' | 'R' | 'L' | null) {
      const fixture = montar();
      const carrito = TestBed.inject(CarritoService);
      carrito.elegirModalidad(modalidad);
      carrito.agregar({ id_producto: 9, nombre: 'Limonada', precio: 7000 });
      fixture.componentInstance.abrirPrePedido();
      fixture.detectChanges();
      return fixture;
    }

    it.each([
      ['D', 'Tu pedido a domicilio', 'bike'],
      ['L', 'Tu pedido en mesa', 'armchair'],
      ['R', 'Tu pedido para llevar', 'shopping-bag'],
    ] as const)('modalidad %s → «%s» con su icono', (m, titulo, icono) => {
      const fixture = abrirPanel(m);
      expect(fixture.nativeElement.querySelector('#pre-pedido-titulo').textContent.trim()).toBe(titulo);
      expect(fixture.componentInstance.iconoPedido()).toBe(icono);
    });

    it('sin modalidad el título es «Tu pedido»', () => {
      expect(abrirPanel(null).nativeElement.querySelector('#pre-pedido-titulo').textContent.trim()).toBe('Tu pedido');
    });

    it('el título en mesa NO lleva el nombre de la mesa', () => {
      const fixture = montar();
      const carrito = TestBed.inject(CarritoService);
      carrito.elegirModalidad('L');
      carrito.elegirMesa({ id_mesa: 3, nombre: 'Mesa 3', numero: 3 });
      carrito.agregar({ id_producto: 9, nombre: 'Limonada', precio: 7000 });
      fixture.componentInstance.abrirPrePedido();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#pre-pedido-titulo').textContent).not.toContain('Mesa 3');
    });

    it('ya no repite el tipo de pedido casi al final', () => {
      const fixture = abrirPanel('D');
      expect(fixture.nativeElement.querySelector('.pre-pedido-eleccion')).toBeNull();
    });

    it('el total y el botón viven en el PIE fijo; la lista que hace scroll no los contiene', () => {
      const fixture = abrirPanel('D');
      const el = fixture.nativeElement as HTMLElement;
      const pie = el.querySelector('.pre-pedido-pie')!;
      const lista = el.querySelector('.pre-pedido-items')!;

      expect(pie.querySelector('.pre-pedido-total')).not.toBeNull();
      expect(pie.querySelector('.pre-pedido-enviar')).not.toBeNull();
      expect(lista.querySelector('.pre-pedido-total')).toBeNull();
      expect(lista.querySelector('.pre-pedido-enviar')).toBeNull();
    });

    it('«+ Otra con cambios» solo en productos con removibles, y abre el modal', () => {
      const fixture = montar();
      const carrito = TestBed.inject(CarritoService);
      carrito.agregar({ id_producto: 4, nombre: 'Hamburguesa', precio: 20000 });
      carrito.agregar({ id_producto: 9, nombre: 'Limonada', precio: 7000 });
      fixture.componentInstance.abrirPrePedido();
      fixture.detectChanges();

      const botones = fixture.nativeElement.querySelectorAll('.pp-otra');
      expect(botones).toHaveLength(1); // solo la hamburguesa
      (botones[0] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(fixture.componentInstance.modalProducto()?.id_producto).toBe(4);
    });

    it('el «+» de una LÍNEA existente suma a esa línea con las mismas exclusiones, SIN modal', () => {
      const fixture = montar();
      const carrito = TestBed.inject(CarritoService);
      carrito.agregar({ id_producto: 4, nombre: 'Hamburguesa', precio: 20000 }, [
        { id_ingrediente: 12, nombre: 'Cebolla' },
      ]);
      fixture.componentInstance.abrirPrePedido();
      fixture.detectChanges();

      const mas = fixture.nativeElement.querySelectorAll('.pp-qty .qty-btn')[1] as HTMLButtonElement;
      mas.click();
      expect(fixture.componentInstance.modalProducto()).toBeNull();
      expect(carrito.items()).toHaveLength(1);
      expect(carrito.items()[0].cantidad).toBe(2);
    });
  });

  describe('paso de datos del cliente antes de WhatsApp', () => {
    let abrir: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    });
    afterEach(() => abrir.mockRestore());

    function panel(modalidad: 'D' | 'R' | 'L') {
      const fixture = montar();
      const carrito = TestBed.inject(CarritoService);
      carrito.elegirModalidad(modalidad);
      carrito.agregar({ id_producto: 9, nombre: 'Limonada', precio: 7000 });
      const comp = fixture.componentInstance;
      comp.abrirPrePedido();
      comp.continuarDelPedido();
      fixture.detectChanges();
      return { fixture, comp, carrito };
    }

    const etiquetas = (f: { nativeElement: HTMLElement }) =>
      Array.from(f.nativeElement.querySelectorAll('.campo__etiqueta')).map((e) =>
        (e.textContent ?? '').replace(/\s+/g, ' ').trim(),
      );

    it('domicilio: pide nombre, teléfono, dirección y nota (opcional)', () => {
      const { fixture } = panel('D');
      expect(etiquetas(fixture)).toEqual(['Nombre', 'Teléfono', 'Dirección', 'Nota (opcional)']);
    });

    it('recoger: nombre y teléfono (opcional)', () => {
      expect(etiquetas(panel('R').fixture)).toEqual(['Nombre', 'Teléfono (opcional)']);
    });

    it('en mesa: solo el nombre', () => {
      expect(etiquetas(panel('L').fixture)).toEqual(['Nombre']);
    });

    it('con datos incompletos NO abre WhatsApp, enseña los errores y lleva el foco al primero', () => {
      const { fixture, comp } = panel('D');
      comp.enviarPorWhatsApp();
      fixture.detectChanges();

      expect(abrir).not.toHaveBeenCalled();
      const errores = fixture.nativeElement.querySelectorAll('.campo__error');
      expect(errores).toHaveLength(3);
      expect((fixture.nativeElement.querySelector('#cli-nombre') as HTMLInputElement).getAttribute('aria-invalid')).toBe('true');
    });

    it('con los datos completos abre WhatsApp con el bloque ANTES de la línea #P', () => {
      const { fixture, comp, carrito } = panel('D');
      carrito.guardarCliente({
        nombre: 'Ana Pérez', telefono: '3001234567', direccion: 'Cra 3 #21-10', nota: 'sin cebolla',
      });
      comp.enviarPorWhatsApp();
      fixture.detectChanges();

      expect(abrir).toHaveBeenCalledOnce();
      const texto = decodeURIComponent(String(abrir.mock.calls[0][0]).split('text=')[1]);
      const lineas = texto.split('\n');
      expect(lineas).toContain('Nombre: Ana Pérez');
      expect(lineas).toContain('Nota: sin cebolla');
      expect(lineas[lineas.length - 1]).toBe('#P12-9x1~m=D');
    });

    it('«Volver» regresa a la lista sin perder lo escrito', () => {
      const { fixture, comp, carrito } = panel('D');
      carrito.guardarCliente({ nombre: 'Ana' });
      comp.volverAlPedido();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.pre-pedido-items')).not.toBeNull();
      expect(carrito.cliente().nombre).toBe('Ana');
    });

    it('el teléfono se limpia al escribir: solo dígitos', () => {
      const { fixture } = panel('D');
      const tel = fixture.nativeElement.querySelector('#cli-telefono') as HTMLInputElement;
      tel.value = '(300) 123-4567 abc';
      tel.dispatchEvent(new Event('input'));

      expect(TestBed.inject(CarritoService).cliente().telefono).toBe('3001234567');
    });
  });
});
