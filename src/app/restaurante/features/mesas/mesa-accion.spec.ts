import { describe, expect, it } from 'vitest';

import { accionPrincipalDe } from './mesa-accion';

describe('accionPrincipalDe', () => {
  it('mesa libre con permiso: «Tomar pedido»', () => {
    expect(accionPrincipalDe('available', true)).toMatchObject({
      tipo: 'tomar',
      largo: 'Tomar pedido',
      corto: 'Pedido',
    });
  });

  it('mesa libre sin permiso: nada que ofrecer', () => {
    expect(accionPrincipalDe('available', false)).toBeNull();
  });

  it('mesa ocupada o por cobrar con permiso: «Editar pedido»', () => {
    for (const estado of ['occupied', 'payment'] as const) {
      expect(accionPrincipalDe(estado, true)).toMatchObject({
        tipo: 'editar',
        largo: 'Editar pedido',
        corto: 'Editar',
      });
    }
  });

  it('mesa con cuenta pero sin permiso de edición: solo «Ver pedido»', () => {
    for (const estado of ['occupied', 'payment'] as const) {
      expect(accionPrincipalDe(estado, false)).toMatchObject({ tipo: 'ver', largo: 'Ver pedido' });
    }
  });

  it('mesa deshabilitada: sin acción, tenga o no permiso', () => {
    expect(accionPrincipalDe('disabled', true)).toBeNull();
    expect(accionPrincipalDe('disabled', false)).toBeNull();
  });

  it('todas traen ícono y un texto corto distinto del largo', () => {
    for (const estado of ['available', 'occupied', 'payment'] as const) {
      const a = accionPrincipalDe(estado, true)!;
      expect(a.icono).toBeTruthy();
      expect(a.corto.length).toBeLessThan(a.largo.length);
    }
  });
});
