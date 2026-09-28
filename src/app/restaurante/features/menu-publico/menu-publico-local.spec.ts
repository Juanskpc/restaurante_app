import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Lucide from 'lucide-angular';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';

import { MenuPublicoComponent } from './menu-publico';
import { CarritoService } from './carrito.service';

/**
 * «En el local» en la carta pública (2026-09-29).
 *
 * En el local pide un mesero, no el cliente: la carta queda para mirar. Sin botones de agregar, sin
 * «pedir por WhatsApp» y sin preguntar la mesa. Solo «a domicilio» y «para recoger» arman pedido.
 */
describe('MenuPublicoComponent — en el local la carta es solo para mirar', () => {
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
          id_producto: 9, nombre: 'Limonada', descripcion: null, precio: 7000, imagen_url: null,
          icono: '🍋', es_popular: false, disponible: true, ingredientes_removibles: [],
        },
      ],
    },
  ];
  const MESAS = [{ id_mesa: 3, nombre: 'Mesa 3', numero: 3 }];

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
    http.match((x) => x.url.endsWith('/mesas')).forEach((r) => r.flush({ success: true, data: MESAS }));
    fixture.detectChanges();
    return fixture;
  }

  const hayBotonesDePedir = (f: ReturnType<typeof montar>) =>
    f.nativeElement.querySelector('.add-btn, .qty-btn') !== null;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  });
  afterEach(() => http?.verify());

  it('la tarjeta dice «Un mesero tomará tu pedido», no «Estoy sentado en una mesa»', () => {
    const fixture = montar();
    const texto: string = fixture.nativeElement.textContent;
    expect(texto).toContain('Un mesero tomará tu pedido');
    expect(texto).not.toContain('Estoy sentado en una mesa');
  });

  it('en el local NO pregunta la mesa: la elección queda completa', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;

    comp.elegirModalidad('L');
    fixture.detectChanges();

    expect(comp.pasoEleccion()).toBeNull();
    expect(comp.mostrarSelector()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('¿En qué mesa estás?');
  });

  it('en el local no hay botones de agregar ni botón flotante de pedir', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.elegirModalidad('L');
    fixture.detectChanges();

    expect(comp.puedeArmarPedido()).toBe(false);
    expect(hayBotonesDePedir(fixture)).toBe(false);
    expect(fixture.nativeElement.querySelector('.fab-pedido')).toBeNull();
    // Sí se ve la carta, y se explica por qué no hay botones.
    expect(fixture.nativeElement.textContent).toContain('Limonada');
    expect(fixture.nativeElement.querySelector('.eleccion-nota')?.textContent).toContain(
      'Un mesero tomará tu pedido',
    );
  });

  it('tampoco agrega por código en el local (defensa)', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.elegirModalidad('L');
    comp.agregarAlCarrito(CARTA[0].productos[0] as never);

    expect(TestBed.inject(CarritoService).cantidadDe(9)).toBe(0);
  });

  it('a domicilio y para recoger SÍ ofrecen agregar y pedir', () => {
    for (const modalidad of ['D', 'R'] as const) {
      TestBed.resetTestingModule();
      localStorage.clear(); // el carrito se guarda en el equipo: que la vuelta anterior no cuente
      const fixture = montar();
      const comp = fixture.componentInstance;
      comp.elegirModalidad(modalidad);
      fixture.detectChanges();

      expect(comp.puedeArmarPedido(), modalidad).toBe(true);
      expect(hayBotonesDePedir(fixture), modalidad).toBe(true);
      expect(fixture.nativeElement.querySelector('.eleccion-nota'), modalidad).toBeNull();

      comp.agregarAlCarrito(CARTA[0].productos[0] as never);
      fixture.detectChanges();
      expect(TestBed.inject(CarritoService).cantidadDe(9), modalidad).toBe(1);
      expect(fixture.nativeElement.querySelector('.fab-pedido'), modalidad).not.toBeNull();
      http.verify();
    }
  });

  it('cambiar de «en el local» a recoger devuelve los botones', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    comp.elegirModalidad('L');
    fixture.detectChanges();
    expect(hayBotonesDePedir(fixture)).toBe(false);

    comp.cambiarEleccion();
    comp.elegirModalidad('R');
    fixture.detectChanges();
    expect(hayBotonesDePedir(fixture)).toBe(true);
  });

  it('el QR de la mesa (?mesa=) deja la carta en solo mirar', () => {
    const fixture = montar('3');
    const comp = fixture.componentInstance;

    expect(TestBed.inject(CarritoService).modalidad()).toBe('L');
    expect(comp.puedeArmarPedido()).toBe(false);
    expect(hayBotonesDePedir(fixture)).toBe(false);
  });
});
