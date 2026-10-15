import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Lucide from 'lucide-angular';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';

import { MenuPublicoComponent } from './menu-publico';

/**
 * «¿Dónde deseas pedir?» en la carta pública.
 *
 * Un negocio con sedes sirve una carta por sede. El cliente abre la de cualquiera —el QR de la
 * puerta, el enlace de la bio— y antes de nada se le pregunta en cuál pide; al elegir otra se
 * navega a SU carta, porque cada una tiene sus precios y su WhatsApp.
 *
 * Ojo con el vocabulario: aquí «sede» es el establecimiento. «El local» es otra cosa en esta carta
 * —comer ahí sentado, la modalidad `L`— y tiene su propio spec (`menu-publico-local.spec.ts`).
 */
describe('MenuPublicoComponent — elegir sede antes de pedir', () => {
  const ID = 12;
  const OTRA = 768;
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

  const DOS_SEDES = [
    { id_negocio: ID, nombre: 'Pregonchos Centro', direccion: 'Calle 1 #2-3' },
    { id_negocio: OTRA, nombre: 'Pregonchos Norte', direccion: 'Calle 10 #20-30' },
  ];

  function montar({ sedes = [] as unknown[], atencion = { estado: 'abierto' } as unknown } = {}) {
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
        id_negocio: ID, nombre: 'Pregonchos Centro', direccion: null, telefono: null,
        url_whatsapp: '3152812484', url_facebook: null, url_instagram: null, plan_activo: true,
        carta: null, atencion, sedes,
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

  const titulo = (f: { nativeElement: HTMLElement }) =>
    f.nativeElement.querySelector('.eleccion__titulo')?.textContent?.trim() ?? null;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* sin almacenamiento */
    }
  });
  afterEach(() => http?.verify());

  it('un negocio que va solo no pregunta por la sede: pregunta cómo pedir, como siempre', () => {
    const fixture = montar({ sedes: [] });
    expect(titulo(fixture)).toBe('¿Cómo quieres pedir?');
    expect(fixture.nativeElement.querySelector('.eleccion-chip--sede')).toBeNull();
  });

  it('con dos sedes pregunta DÓNDE antes de cómo, y las lista con su dirección', () => {
    const fixture = montar({ sedes: DOS_SEDES });
    expect(titulo(fixture)).toBe('¿Dónde deseas pedir?');

    const opciones: HTMLElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.eleccion-opcion'),
    );
    expect(opciones.map((o) => o.querySelector('span')?.textContent?.trim())).toEqual([
      'Pregonchos Centro',
      'Pregonchos Norte',
    ]);
    expect(opciones[1].querySelector('small')?.textContent?.trim()).toBe('Calle 10 #20-30');
  });

  it('elegir la sede en la que ya se está sigue al paso de la modalidad, sin navegar', () => {
    const fixture = montar({ sedes: DOS_SEDES });
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.nativeElement.querySelectorAll('.eleccion-opcion')[0].click();
    fixture.detectChanges();

    expect(navegar).not.toHaveBeenCalled();
    expect(titulo(fixture)).toBe('¿Cómo quieres pedir?');
    navegar.mockRestore();
  });

  it('elegir otra sede navega a SU carta', () => {
    const fixture = montar({ sedes: DOS_SEDES });
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.nativeElement.querySelectorAll('.eleccion-opcion')[1].click();
    fixture.detectChanges();

    expect(navegar).toHaveBeenCalledWith(['/carta', OTRA]);
    navegar.mockRestore();
  });

  it('con la sede cerrada el selector SÍ sale: es la forma de irse a la que atienda', () => {
    // El chip de la modalidad no sale con el negocio cerrado, pero el de la sede tiene que salir.
    const fixture = montar({ sedes: DOS_SEDES, atencion: { estado: 'fuera_de_horario' } });
    expect(titulo(fixture)).toBe('¿Dónde deseas pedir?');
  });

  it('ya elegida, el chip de la sede deja volver a cambiarla', () => {
    const fixture = montar({ sedes: DOS_SEDES });
    fixture.nativeElement.querySelectorAll('.eleccion-opcion')[0].click();
    fixture.detectChanges();

    const chip: HTMLButtonElement = fixture.nativeElement.querySelector('.eleccion-chip--sede');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('Pregonchos Centro');

    chip.click();
    fixture.detectChanges();
    expect(titulo(fixture)).toBe('¿Dónde deseas pedir?');
  });
});
