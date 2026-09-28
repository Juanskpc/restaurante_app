import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Lucide from 'lucide-angular';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';

import { MenuPublicoComponent, horaLegible, mensajeFueraDeHorario } from './menu-publico';
import { CarritoService } from './carrito.service';

/**
 * Carta pública fuera de horario (2026-09-28).
 *
 * Antes los botones de pedir se veían apagados pero no decían por qué: en el móvil un `title` no se
 * lee y un `disabled` ni siquiera recibe el toque, así que el cliente tocaba y no pasaba nada. Ahora
 * el toque llega y sale un aviso que —cuando el cierre es por horario— dice a qué hora se puede pedir.
 */
describe('mensajeFueraDeHorario', () => {
  it('«5:00 PM», no «17:00»', () => {
    expect(horaLegible('17:00')).toBe('5:00 PM');
    expect(horaLegible('09:30')).toBe('9:30 AM');
    expect(horaLegible('12:00')).toBe('12:00 PM');
    expect(horaLegible('00:15')).toBe('12:15 AM');
  });

  it('si abre hoy más tarde, dice la hora de hoy', () => {
    expect(
      mensajeFueraDeHorario('fuera_de_horario', { dias_adelante: 0, dia_semana: 3, hora: '17:00' }),
    ).toBe(
      'Ahora mismo estamos fuera de nuestro horario de atención. Puedes realizar tu pedido a partir de las 5:00 PM.',
    );
  });

  it('si hoy ya no abre, dice cuándo: mañana o el día que sea', () => {
    expect(
      mensajeFueraDeHorario('fuera_de_horario', { dias_adelante: 1, dia_semana: 4, hora: '11:30' }),
    ).toContain('mañana a partir de las 11:30 AM');
    expect(
      mensajeFueraDeHorario('fuera_de_horario', { dias_adelante: 3, dia_semana: 0, hora: '11:30' }),
    ).toContain('el domingo a partir de las 11:30 AM');
    expect(
      mensajeFueraDeHorario('fuera_de_horario', { dias_adelante: 7, dia_semana: 3, hora: '17:00' }),
    ).toContain('el próximo miércoles');
  });

  it('sin hora que prometer no inventa una', () => {
    const texto = mensajeFueraDeHorario('fuera_de_horario', null);
    expect(texto).toContain('fuera de nuestro horario');
    expect(texto).not.toMatch(/\d:\d\d/);
  });

  it('cada estado dice lo suyo', () => {
    expect(mensajeFueraDeHorario('aun_no_abre')).toContain('a punto de abrir');
    expect(mensajeFueraDeHorario('cerrado_sin_horario')).toContain('no estamos recibiendo pedidos');
  });
});

describe('MenuPublicoComponent — aviso al tocar «agregar» con el negocio cerrado', () => {
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

  function montar(atencion: unknown) {
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
        carta: null, atencion,
      },
    });
    http.match((r) => r.url.includes('/public/carta/completa')).forEach((r) =>
      r.flush({ success: true, data: CARTA }),
    );
    http.match((x) => x.url.endsWith('/barrios')).forEach((r) =>
      r.flush({ success: true, data: { habilitado: false, barrios: [] } }),
    );
    http.match((x) => x.url.endsWith('/mesas')).forEach((r) => r.flush({ success: true, data: [] }));
    fixture.detectChanges();
    return fixture;
  }

  const limonada = () => CARTA[0].productos[0];

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  });
  afterEach(() => http?.verify());

  it('el botón «+» NO está desactivado: recibe el toque para poder explicar', () => {
    const fixture = montar({ estado: 'fuera_de_horario' });
    const boton: HTMLButtonElement = fixture.nativeElement.querySelector('.add-btn');
    expect(boton).not.toBeNull();
    expect(boton.disabled).toBe(false);
    expect(boton.getAttribute('aria-disabled')).toBe('true');
    expect(boton.classList.contains('pedir-cerrado')).toBe(true);
  });

  it('al tocar «agregar» sale el aviso con la hora de apertura y NO se agrega nada', () => {
    const fixture = montar({
      estado: 'fuera_de_horario',
      abre: { dias_adelante: 0, dia_semana: 3, hora: '17:00' },
    });
    expect(fixture.nativeElement.querySelector('.aviso-cerrado')).toBeNull();

    fixture.nativeElement.querySelector('.add-btn').click();
    fixture.detectChanges();

    const aviso: HTMLElement = fixture.nativeElement.querySelector('.aviso-cerrado');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('fuera de nuestro horario de atención');
    expect(aviso.textContent).toContain('a partir de las 5:00 PM');
    expect(TestBed.inject(CarritoService).cantidadDe(9)).toBe(0);
  });

  it('se puede cerrar el aviso', () => {
    const fixture = montar({ estado: 'cerrado_sin_horario' });
    fixture.componentInstance.agregarAlCarrito(limonada() as never);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.aviso-cerrado')).not.toBeNull();

    fixture.nativeElement.querySelector('.aviso-cerrado__cerrar').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.aviso-cerrado')).toBeNull();
  });

  it('abierto, agrega normal y no hay aviso', () => {
    const fixture = montar({ estado: 'abierto' });
    TestBed.inject(CarritoService).elegirModalidad('R');
    fixture.componentInstance.agregarAlCarrito(limonada() as never);
    fixture.detectChanges();

    expect(TestBed.inject(CarritoService).cantidadDe(9)).toBe(1);
    expect(fixture.nativeElement.querySelector('.aviso-cerrado')).toBeNull();
  });
});
