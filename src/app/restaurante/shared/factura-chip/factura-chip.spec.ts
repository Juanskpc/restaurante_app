import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LUCIDE_ICONS, LucideIconProvider, X } from 'lucide-angular';
import { describe, it, expect, beforeEach } from 'vitest';

import { FacturacionService } from '../../../core/services/facturacion.service';
import { MultipagoSelectorComponent } from '../multipago-selector/multipago-selector';
import { FacturaChipComponent, SeleccionFactura, SIN_FACTURA } from './factura-chip';

const activa = signal(true);
const facturarTodo = signal(false);
const FACTURACION = {
  provide: FacturacionService,
  useValue: { activa, facturarTodo, estado: signal({ modo: 'POS' }), tope: signal(261870) },
};
const ICONOS = { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider({ X }) };

/** Quien lo contiene guarda lo elegido: el interruptor es controlado. */
@Component({
  standalone: true,
  imports: [FacturaChipComponent],
  // Dentro de un «.modal», como en Mesas y Despacho.
  template: `<div class="modal"><app-factura-chip [valor]="valor()" [total]="total()" (cambio)="valor.set($event)" /></div>`,
})
class Anfitrion {
  readonly valor = signal<SeleccionFactura>(SIN_FACTURA);
  readonly total = signal(50000);
}

/**
 * «Factura electrónica» — el interruptor con el que el cajero decide si un cobro se factura.
 *
 * Lo que se sostiene:
 *   1. Apagado, el cobro NO se factura: un negocio con pocos documentos no los gasta sin querer.
 *   2. Marcarlo no factura todavía: abre la ventana, y solo «Facturar este pedido» lo deja puesto.
 *   3. La ventana abre en «Con datos del cliente»; «Anónima» es la otra pestaña.
 *   4. Una anónima no vale por encima del tope.
 */
describe('FacturaChipComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<Anfitrion>>;
  const el = () => fixture.nativeElement as HTMLElement;
  const check = () => el().querySelector<HTMLInputElement>('.fch__check')!;
  const boton = (texto: string) =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === texto)!;
  const escribir = (indice: number, valor: string) => {
    const campo = el().querySelectorAll<HTMLInputElement>('app-datos-factura input')[indice];
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  beforeEach(() => {
    activa.set(true);
    facturarTodo.set(false);
    TestBed.configureTestingModule({ imports: [Anfitrion], providers: [FACTURACION, ICONOS] });
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
  });

  it('nace apagado: este cobro no se factura', () => {
    expect(check().checked).toBe(false);
    expect(fixture.componentInstance.valor()).toEqual(SIN_FACTURA);
    expect(el().querySelector('[role="dialog"]')).toBeNull();
  });

  it('marcarlo abre la ventana en «Con datos del cliente», y cancelar lo deja apagado', () => {
    check().click();
    fixture.detectChanges();
    expect(el().querySelector('[role="dialog"]')).not.toBeNull();
    expect(el().querySelector('.fch-tab.is-on')?.textContent?.trim()).toBe('Con datos del cliente');
    expect(fixture.componentInstance.valor().datos).toBeNull();

    boton('Cancelar').click();
    fixture.detectChanges();
    expect(el().querySelector('[role="dialog"]')).toBeNull();
    expect(check().checked).toBe(false);
  });

  it('mientras la ventana está abierta, el modal de atrás se esconde, y vuelve al cerrarla', () => {
    const modal = el().querySelector<HTMLElement>('.modal')!;
    check().click();
    fixture.detectChanges();
    expect(modal.style.visibility).toBe('hidden');
    boton('Cancelar').click();
    fixture.detectChanges();
    expect(modal.style.visibility).toBe('');
  });

  it('no deja facturar a nombre de alguien sin sus datos', () => {
    check().click();
    fixture.detectChanges();
    expect(boton('Facturar este pedido').disabled).toBe(true);
    escribir(0, '1000000009');
    escribir(1, 'Ana Pérez');
    expect(boton('Facturar este pedido').disabled).toBe(false);
  });

  it('con los datos del cliente queda marcado y dice a nombre de quién', () => {
    check().click();
    fixture.detectChanges();
    escribir(0, '1000000009');
    escribir(1, 'Ana Pérez');
    boton('Facturar este pedido').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.valor()).toMatchObject({
      valido: true,
      datos: { tipo_documento: '13', numero_documento: '1000000009', nombres: 'Ana Pérez' },
    });
    expect(check().checked).toBe(true);
    expect(el().querySelector('.fch__resumen')?.textContent).toContain('Ana Pérez');
  });

  it('la pestaña «Anónima» factura a consumidor final, sin pedir nada', () => {
    check().click();
    fixture.detectChanges();
    boton('Anónima').click();
    fixture.detectChanges();
    boton('Facturar este pedido').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.valor()).toEqual({ datos: { consumidor_final: true }, valido: true });
    expect(el().querySelector('.fch__resumen')?.textContent).toContain('Anónima');
  });

  it('por encima del tope no se puede facturar anónima', () => {
    fixture.componentInstance.total.set(300000);
    fixture.detectChanges();
    check().click();
    fixture.detectChanges();
    boton('Anónima').click();
    fixture.detectChanges();
    expect(el().textContent).toContain('debe llevar los datos del cliente');
    expect(boton('Facturar este pedido').disabled).toBe(true);
  });

  it('desmarcarlo quita la factura', () => {
    fixture.componentInstance.valor.set({ datos: { consumidor_final: true }, valido: true });
    fixture.detectChanges();
    check().click();
    fixture.detectChanges();
    expect(fixture.componentInstance.valor()).toEqual(SIN_FACTURA);
  });

  it('volver a abrirlo trae los datos que ya estaban', () => {
    fixture.componentInstance.valor.set({
      valido: true,
      datos: { tipo_persona: '2', tipo_documento: '13', numero_documento: '1000000009', nombres: 'Ana Pérez' },
    });
    fixture.detectChanges();
    el().querySelector<HTMLButtonElement>('.fch__texto')!.click();
    fixture.detectChanges();
    const campos = Array.from(el().querySelectorAll<HTMLInputElement>('app-datos-factura input')).map((i) => i.value);
    expect(campos).toEqual(expect.arrayContaining(['1000000009', 'Ana Pérez']));
  });

  it('en un negocio que factura todo nace marcado como anónima y no se puede quitar', () => {
    facturarTodo.set(true);
    fixture = TestBed.createComponent(Anfitrion);
    fixture.detectChanges();
    expect(fixture.componentInstance.valor()).toEqual({ datos: { consumidor_final: true }, valido: true });
    expect(check().checked).toBe(true);
    expect(check().disabled).toBe(true);
  });
});

describe('MultipagoSelectorComponent — con facturación electrónica', () => {
  const EFECTIVO = { id_metodo_pago: 1, nombre: 'Efectivo' };
  let fixture: ReturnType<typeof TestBed.createComponent<MultipagoSelectorComponent>>;
  let comp: MultipagoSelectorComponent;
  const el = () => fixture.nativeElement as HTMLElement;

  function montar(total: number, entradas: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [MultipagoSelectorComponent], providers: [FACTURACION, ICONOS] });
    fixture = TestBed.createComponent(MultipagoSelectorComponent);
    comp = fixture.componentInstance;
    fixture.componentRef.setInput('metodos', [EFECTIVO]);
    fixture.componentRef.setInput('total', total);
    fixture.componentRef.setInput('idMetodoPagoInicial', 1);
    for (const [k, v] of Object.entries(entradas)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
  }

  beforeEach(() => {
    activa.set(true);
    facturarTodo.set(false);
  });

  it('un negocio que no factura no ve nada nuevo, y cobra como siempre', () => {
    activa.set(false);
    montar(300000);
    expect(el().querySelector('app-factura-chip')).toBeNull();
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: null, facturaValida: true });
  });

  it('un negocio que factura cobra SIN factura mientras nadie la pida', () => {
    montar(300000);
    expect(el().querySelector('app-factura-chip')).not.toBeNull();
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: null, facturaValida: true });
  });

  it('si la pantalla pinta el interruptor aparte, el selector no pinta otro y usa lo que le pasan', () => {
    const factura = { datos: { consumidor_final: true }, valido: true };
    montar(50000, { facturaAparte: true, factura });
    expect(el().querySelector('app-factura-chip')).toBeNull();
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: { consumidor_final: true } });
  });

  it('abre con la factura que se pidió al tomar el pedido', () => {
    montar(50000, { facturaInicial: { consumidor_final: true } });
    expect(comp.seleccion()).toMatchObject({ valido: true, factura: { consumidor_final: true } });
    expect(el().querySelector<HTMLInputElement>('.fch__check')?.checked).toBe(true);
  });

  it('una anónima deja de valer si el pedido crece por encima del tope', () => {
    const factura = { datos: { consumidor_final: true }, valido: true };
    montar(50000, { facturaAparte: true, factura });
    expect(comp.seleccion().valido).toBe(true);
    fixture.componentRef.setInput('total', 300000);
    fixture.detectChanges();
    expect(comp.seleccion()).toMatchObject({ valido: false, facturaValida: false });
  });
});
