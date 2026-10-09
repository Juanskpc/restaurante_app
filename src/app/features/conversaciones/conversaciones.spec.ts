import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { icons } from '../../app.config';
import { AuthService } from '../../core/services/auth.service';
import { ConversacionesComponent } from './conversaciones';

/**
 * Conversaciones — qué se enseña y a quién.
 *
 * Esta pantalla tiene cuatro estados excluyentes y **ninguno falla en voz alta** cuando se
 * elige mal: enseñar «conecta tu número» a quien no tiene el plan parece razonable, y enseñar
 * la bandeja vacía a quien nunca conectó también. Por eso se fijan aquí.
 *
 * Montar de verdad, además, es lo que caza un icono sin registrar: `lucide-angular` lanza
 * cuando le piden uno que nadie proveyó, y eso no se ve en el build. Con esta prueba se vio —
 * `sparkles` no estaba en `app.config.ts` al traer la vista del panel.
 */

/** Una sesión mínima con el negocio activo que haga falta. */
function authFalso(opciones: {
  features?: string[];
  subniveles?: string[];
  nombre?: string;
} = {}) {
  const negocio = signal({
    id_negocio: 6,
    nombre: opciones.nombre ?? 'Zona Burger',
    tipo_negocio: 'RESTAURANTE',
    paleta: null,
    features: opciones.features ?? [],
    roles: [],
    permisos_vista: [],
    permisos_subnivel: [],
  });

  return {
    negocio,
    tieneFeature: (codigo: string) => (opciones.features ?? []).includes(codigo),
    canAccessSubnivel: (codigo: string) => (opciones.subniveles ?? []).includes(codigo),
  };
}

function montar(auth: ReturnType<typeof authFalso>) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(icons) },
      { provide: AuthService, useValue: auth },
    ],
  });
  const fixture = TestBed.createComponent(ConversacionesComponent);
  fixture.detectChanges();
  return fixture;
}

const textoDe = (fixture: { nativeElement: unknown }) =>
  ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');

describe('ConversacionesComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('sin la feature en el plan: ofrece mejorarlo y NO monta nada del asistente', () => {
    const fixture = montar(authFalso({ features: [], subniveles: ['whatsapp_numero'] }));

    expect(fixture.componentInstance.habilitado()).toBe(false);
    const texto = textoDe(fixture);
    expect(texto).toContain('Tu plan todavía no incluye el asistente');
    expect(texto).toContain('Zona Burger');
    // Ni la bandeja ni la pantalla de conexión: con el plan sin asistente no hay nada que
    // conectar, y montar la conexión invitaría a un flujo de Meta que acabaría rechazado.
    expect(fixture.nativeElement.querySelector('app-canal-whatsapp')).toBeNull();
    expect(fixture.nativeElement.querySelector('app-bandeja')).toBeNull();
  });

  it('con la feature y permiso del número: monta la pantalla de conexión', () => {
    const fixture = montar(authFalso({
      features: ['asistente_ia'],
      subniveles: ['whatsapp_numero'],
    }));

    expect(fixture.componentInstance.habilitado()).toBe(true);
    expect(fixture.componentInstance.administra()).toBe(true);
    expect(fixture.componentInstance.vista()).toBe('numero');
    expect(fixture.nativeElement.querySelector('app-canal-whatsapp')).not.toBeNull();
  });

  it('con la feature pero SIN permiso del número (cajero): dice a quién pedírselo', () => {
    const fixture = montar(authFalso({ features: ['asistente_ia'], subniveles: [] }));

    expect(fixture.componentInstance.administra()).toBe(false);
    const texto = textoDe(fixture);
    expect(texto).toContain('Aún no hay WhatsApp conectado');
    expect(texto).toContain('Pídeselo al administrador');
    // Lo importante: NO se le ofrece el flujo de Meta, que su rol no puede terminar.
    expect(fixture.nativeElement.querySelector('app-canal-whatsapp')).toBeNull();
  });

  it('cuando el canal se reporta conectado, pasa a las conversaciones', () => {
    const fixture = montar(authFalso({
      features: ['asistente_ia'],
      subniveles: ['whatsapp_numero'],
    }));
    const comp = fixture.componentInstance;

    comp.alCambiarEstadoDelCanal({ idNegocio: 6, conectado: true });
    fixture.detectChanges();

    expect(comp.vista()).toBe('conversaciones');
    expect(fixture.nativeElement.querySelector('app-bandeja')).not.toBeNull();
  });

  it('«Gestionar número» vuelve a la conexión sin perder que está conectado', () => {
    const fixture = montar(authFalso({
      features: ['asistente_ia'],
      subniveles: ['whatsapp_numero'],
    }));
    const comp = fixture.componentInstance;

    comp.alCambiarEstadoDelCanal({ idNegocio: 6, conectado: true });
    comp.irA('numero');
    fixture.detectChanges();

    expect(comp.vista()).toBe('numero');
    // `conectado` sigue siendo true: es el estado del canal, no el de la navegación. Si se
    // perdiera, el botón de volver a las conversaciones desaparecería de la cabecera.
    expect(comp.conectado()).toBe(true);
    expect(textoDe(fixture)).toContain('Ver conversaciones');
  });

  it('desconectar devuelve a la pantalla de conexión aunque se estuviera en la bandeja', () => {
    const fixture = montar(authFalso({
      features: ['asistente_ia'],
      subniveles: ['whatsapp_numero'],
    }));
    const comp = fixture.componentInstance;

    comp.alCambiarEstadoDelCanal({ idNegocio: 6, conectado: true });
    expect(comp.vista()).toBe('conversaciones');

    comp.alCambiarEstadoDelCanal({ idNegocio: 6, conectado: false });
    fixture.detectChanges();

    expect(comp.vista()).toBe('numero');
    expect(fixture.nativeElement.querySelector('app-bandeja')).toBeNull();
  });

  it('el negocio activo es el que se le pasa a la bandeja: nunca se pide otro', () => {
    const auth = authFalso({ features: ['asistente_ia'], subniveles: ['whatsapp_numero'] });
    const fixture = montar(auth);
    const comp = fixture.componentInstance;

    comp.alCambiarEstadoDelCanal({ idNegocio: 6, conectado: true });
    fixture.detectChanges();

    expect(comp.idNegocio()).toBe(6);
  });
});

describe('ConversacionesComponent — sin negocio activo', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('no revienta', () => {
    const auth = {
      negocio: signal(null),
      tieneFeature: vi.fn(() => false),
      canAccessSubnivel: vi.fn(() => false),
    };
    const fixture = montar(auth as unknown as ReturnType<typeof authFalso>);

    expect(fixture.componentInstance.idNegocio()).toBeNull();
    expect(textoDe(fixture)).toContain('Tu plan todavía no incluye el asistente');
  });
});
