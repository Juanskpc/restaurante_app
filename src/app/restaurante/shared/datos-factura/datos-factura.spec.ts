import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { DatosFacturaCambio, DatosFacturaComponent } from './datos-factura';

/**
 * El formulario con los datos del cliente para una factura a su nombre.
 *
 * Lo que se sostiene:
 *   1. Con NIT pide razón social y manda persona jurídica; con cédula, nombre y persona natural.
 *   2. A medias no vale: sin número, sin nombre o con el correo mal escrito.
 *   3. Abre con los datos que ya se habían puesto, para corregirlos sin volver a escribirlos.
 */
describe('DatosFacturaComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<DatosFacturaComponent>>;
  let comp: DatosFacturaComponent;
  let ultimo: DatosFacturaCambio | null;

  const interno = () => comp as unknown as {
    setTipo: (v: string) => void;
    numero: { set: (v: string) => void };
    nombre: { set: (v: string) => void };
    correo: { set: (v: string) => void };
  };
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [DatosFacturaComponent] });
    fixture = TestBed.createComponent(DatosFacturaComponent);
    comp = fixture.componentInstance;
    ultimo = null;
    comp.cambio.subscribe((s) => (ultimo = s));
    fixture.detectChanges();
  });

  it('vacío no vale', () => {
    expect(comp.valido()).toBe(false);
    expect(ultimo?.valido).toBe(false);
  });

  it('con cédula pide el nombre y manda persona natural', () => {
    interno().numero.set('1.000.000.009');
    interno().nombre.set(' Ana Pérez ');
    fixture.detectChanges();
    expect(el().textContent).toContain('Nombre completo');
    expect(comp.valido()).toBe(true);
    expect(comp.datos()).toEqual({
      tipo_persona: '2',
      tipo_documento: '13',
      numero_documento: '1.000.000.009',
      nombres: 'Ana Pérez',
      correo: null,
      telefono: null,
    });
  });

  it('con NIT pide la razón social y manda persona jurídica', () => {
    interno().setTipo('31');
    interno().numero.set('900123456');
    interno().nombre.set('Empresa Prueba SAS');
    fixture.detectChanges();
    expect(el().textContent).toContain('Razón social');
    expect(comp.datos()).toMatchObject({ tipo_persona: '1', tipo_documento: '31', razon_social: 'Empresa Prueba SAS' });
    expect(comp.datos()).not.toHaveProperty('nombres');
  });

  it('a medias no vale: número corto, sin nombre o con el correo mal escrito', () => {
    interno().numero.set('12');
    interno().nombre.set('Ana');
    expect(comp.valido()).toBe(false);
    interno().numero.set('1000000009');
    expect(comp.valido()).toBe(true);
    interno().correo.set('ana@');
    expect(comp.valido()).toBe(false);
    interno().correo.set('ana@correo.co');
    expect(comp.valido()).toBe(true);
  });

  it('abre con los datos que ya se habían puesto', () => {
    fixture.componentRef.setInput('inicial', {
      tipo_persona: '1',
      tipo_documento: '31',
      numero_documento: '900123456',
      razon_social: 'Empresa Prueba SAS',
      correo: 'compras@empresa.co',
      telefono: null,
    });
    fixture.detectChanges();
    expect(comp.valido()).toBe(true);
    expect(comp.datos()).toMatchObject({ numero_documento: '900123456', razon_social: 'Empresa Prueba SAS', correo: 'compras@empresa.co' });
    const campos = Array.from(el().querySelectorAll<HTMLInputElement>('input')).map((i) => i.value);
    expect(campos).toContain('Empresa Prueba SAS');
  });
});
