import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { FacturacionService } from '../../../core/services/facturacion.service';
import { MultipagoSelectorComponent } from '../multipago-selector/multipago-selector';
import { DatosFacturaComponent, SeleccionFactura } from './datos-factura';

/**
 * «Factura a nombre de» — los datos del comprador en un cobro.
 *
 * Lo que se sostiene:
 *   1. Apagado no pide nada y la factura sale a consumidor final (`datos: null`).
 *   2. Por encima del tope se enciende solo y **no se puede apagar**.
 *   3. Con NIT pide razón social y manda persona jurídica; con cédula, nombre y persona natural.
 *   4. Dentro del selector de pago: un negocio que no factura no la ve, y uno que factura no
 *      puede cobrar con los datos a medias.
 */
describe('DatosFacturaComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<DatosFacturaComponent>>;
  let comp: DatosFacturaComponent;
  let ultimo: SeleccionFactura | null;

  const interno = () => comp as unknown as {
    alternar: (v: boolean) => void;
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
    fixture.componentRef.setInput('total', 50000);
    fixture.componentRef.setInput('tope', 261870);
    fixture.detectChanges();
  });

  it('nace apagado: no pide nada y vale', () => {
    expect(comp.encendido()).toBe(false);
    expect(el().querySelector('.df__campos')).toBeNull();
    expect(ultimo).toEqual({ datos: null, valido: true });
  });

  it('en modo COMPLETO nace encendido, y se puede apagar', () => {
    fixture.componentRef.setInput('modo', 'COMPLETO');
    fixture.detectChanges();
    expect(comp.encendido()).toBe(true);
    expect(comp.valido()).toBe(false);
    interno().alternar(false);
    fixture.detectChanges();
    expect(comp.datos()).toBeNull();
  });

  it('por encima del tope se enciende solo y no se puede apagar', () => {
    fixture.componentRef.setInput('total', 300000);
    fixture.detectChanges();
    expect(comp.encendido()).toBe(true);
    expect(el().querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(el().textContent).toContain('debe');
    interno().alternar(false);
    fixture.detectChanges();
    expect(comp.encendido()).toBe(true);
  });

  it('con cédula pide el nombre y manda persona natural', () => {
    interno().alternar(true);
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
    interno().alternar(true);
    interno().setTipo('31');
    interno().numero.set('900123456');
    interno().nombre.set('Empresa Prueba SAS');
    fixture.detectChanges();
    expect(el().textContent).toContain('Razón social');
    expect(comp.datos()).toMatchObject({ tipo_persona: '1', tipo_documento: '31', razon_social: 'Empresa Prueba SAS' });
    expect(comp.datos()).not.toHaveProperty('nombres');
  });

  it('a medias no vale: sin número, sin nombre o con el correo mal escrito', () => {
    interno().alternar(true);
    expect(comp.valido()).toBe(false);
    interno().numero.set('12');
    interno().nombre.set('Ana');
    expect(comp.valido()).toBe(false); // el número es demasiado corto
    interno().numero.set('1000000009');
    expect(comp.valido()).toBe(true);
    interno().correo.set('ana@');
    expect(comp.valido()).toBe(false);
    interno().correo.set('ana@correo.co');
    expect(comp.valido()).toBe(true);
  });

  it('con «siempre» no hay interruptor: los datos se piden y punto', () => {
    fixture.componentRef.setInput('siempre', true);
    fixture.detectChanges();
    expect(el().querySelector('input[type="checkbox"]')).toBeNull();
    expect(el().querySelector('.df__campos')).not.toBeNull();
  });
});

describe('MultipagoSelectorComponent — con facturación electrónica', () => {
  const EFECTIVO = { id_metodo_pago: 1, nombre: 'Efectivo' };
  const activa = signal(false);
  const estado = signal<{ modo: string } | null>({ modo: 'POS' });

  let fixture: ReturnType<typeof TestBed.createComponent<MultipagoSelectorComponent>>;
  let comp: MultipagoSelectorComponent;
  const el = () => fixture.nativeElement as HTMLElement;

  function montar(total: number) {
    TestBed.configureTestingModule({
      imports: [MultipagoSelectorComponent],
      providers: [{ provide: FacturacionService, useValue: { activa, estado, tope: signal(261870) } }],
    });
    fixture = TestBed.createComponent(MultipagoSelectorComponent);
    comp = fixture.componentInstance;
    fixture.componentRef.setInput('metodos', [EFECTIVO]);
    fixture.componentRef.setInput('total', total);
    fixture.componentRef.setInput('idMetodoPagoInicial', 1);
    fixture.detectChanges();
  }

  it('un negocio que no factura no ve nada nuevo, y cobra como siempre', () => {
    activa.set(false);
    montar(300000);
    expect(el().querySelector('app-datos-factura')).toBeNull();
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: null, facturaValida: true });
  });

  it('un negocio que factura cobra a consumidor final sin llenar nada', () => {
    activa.set(true);
    montar(50000);
    expect(el().querySelector('app-datos-factura')).not.toBeNull();
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: null });
  });

  it('por encima del tope no deja cobrar hasta tener los datos del comprador', () => {
    activa.set(true);
    montar(300000);
    expect(comp.seleccion()).toMatchObject({ valido: false, facturaValida: false });

    const datos = fixture.debugElement.children.find((d) => d.name === 'app-datos-factura')
      ?? fixture.debugElement.query((d) => d.name === 'app-datos-factura');
    const interno = datos.componentInstance as unknown as {
      numero: { set: (v: string) => void };
      nombre: { set: (v: string) => void };
    };
    interno.numero.set('1000000009');
    interno.nombre.set('Ana Pérez');
    fixture.detectChanges();
    expect(comp.seleccion()).toMatchObject({
      valido: true,
      facturaValida: true,
      factura: { tipo_documento: '13', numero_documento: '1000000009', nombres: 'Ana Pérez' },
    });
  });
});
