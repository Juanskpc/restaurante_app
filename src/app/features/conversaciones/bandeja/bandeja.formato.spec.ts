import { describe, expect, it } from 'vitest';

import { BandejaComponent } from './bandeja';

/**
 * Cómo pinta la Bandeja lo que dicen el asistente y el cliente (2026-10-16). Las tres funciones
 * no usan nada del componente, así que se prueban sin montarlo.
 */
const formato = (t: string) => BandejaComponent.prototype.formatoWhatsapp.call({}, t);
const sinMarcas = (t: string) => BandejaComponent.prototype.sinMarcas.call({}, t);
const campos = (f: Record<string, string>) => BandejaComponent.prototype.camposFormulario.call({}, f);

describe('formatoWhatsapp', () => {
  it('pinta *negrita*, _cursiva_ y ~tachado~ como los ve el cliente', () => {
    expect(formato('*Total: $48.000*')).toBe('<strong>Total: $48.000</strong>');
    expect(formato('📝 _Nota: Pago: Efectivo_')).toBe('📝 <em>Nota: Pago: Efectivo</em>');
    expect(formato('Antes ~$20.000~ ahora')).toBe('Antes <s>$20.000</s> ahora');
    expect(formato('Te saluda *ZONA BURGER*.')).toBe('Te saluda <strong>ZONA BURGER</strong>.');
  });

  it('no confunde un guion bajo de una dirección con una cursiva', () => {
    expect(formato('Calle 16A n 43_61. La colina')).toBe('Calle 16A n 43_61. La colina');
    expect(formato('3 * 2 = 6')).toBe('3 * 2 = 6');
  });

  it('EL CASO: el texto del cliente nunca entra como HTML', () => {
    const r = formato('<img src=x onerror=alert(1)> *hola*');
    expect(r).not.toContain('<img');
    expect(r).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(r).toContain('<strong>hola</strong>');
    expect(formato('*<b>x</b>*')).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('conserva los saltos de línea (los pinta el CSS con pre-wrap)', () => {
    expect(formato('uno\n*dos*')).toBe('uno\n<strong>dos</strong>');
  });
});

describe('sinMarcas (la vista previa de la lista)', () => {
  it('quita los asteriscos y renombra el formulario', () => {
    expect(sinMarcas('El Nequi es *3236388196*. Te aparece')).toBe('El Nequi es 3236388196. Te aparece');
    expect(sinMarcas('📋 Formulario enviado\nEntrega: recoger')).toBe('📋 Llenó el formulario\nEntrega: recoger');
  });
});

describe('camposFormulario', () => {
  it('en orden, con nombres de persona y la entrega en palabras', () => {
    expect(
      campos({ pago: 'Nequi', entrega: 'domicilio', direccion: 'Mz 4 casa 12', barrio: 'Betania', otro_campo: 'x' })
    ).toEqual([
      { clave: 'entrega', etiqueta: 'Cómo lo recibe', valor: 'A domicilio' },
      { clave: 'barrio', etiqueta: 'Barrio', valor: 'Betania' },
      { clave: 'direccion', etiqueta: 'Dirección', valor: 'Mz 4 casa 12' },
      { clave: 'pago', etiqueta: 'Pago', valor: 'Nequi' },
      { clave: 'otro_campo', etiqueta: 'otro campo', valor: 'x' },
    ]);
    expect(campos({ entrega: 'recoger', pago: 'Efectivo' })[0].valor).toBe('Pasa a recoger');
  });
});
