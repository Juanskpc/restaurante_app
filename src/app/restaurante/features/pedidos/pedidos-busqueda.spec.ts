import { describe, expect, it } from 'vitest';
import { textoBuscable } from './pedidos';

/**
 * El buscador de productos del POS. Lo que se vigila aquí es por qué el mismo término
 * encontraba en el PC y no en la tablet: lo que escribe un teclado de móvil no es solo letras.
 */
describe('textoBuscable', () => {
  it('ignora las tildes en los dos sentidos', () => {
    expect(textoBuscable('Café')).toBe(textoBuscable('cafe'));
    expect(textoBuscable('LIMONADA DE COCÓ')).toBe('limonada de coco');
  });

  it('la eñe se compara como una ene', () => {
    expect(textoBuscable('Piña')).toBe('pina');
  });

  it('el espacio duro del teclado predictivo cuenta como un espacio normal', () => {
    expect(textoBuscable('pollo asado')).toBe('pollo asado');
  });

  it('los caracteres invisibles no estorban', () => {
    expect(textoBuscable('ham​burguesa')).toBe('hamburguesa');
    expect(textoBuscable('per­ro')).toBe('perro');
  });

  it('varios espacios seguidos valen por uno, y los de las puntas se van', () => {
    expect(textoBuscable('  arroz   chino  ')).toBe('arroz chino');
  });

  it('vacío, nulo e indefinido dan lo mismo: nada', () => {
    expect(textoBuscable('')).toBe('');
    expect(textoBuscable(null)).toBe('');
    expect(textoBuscable(undefined)).toBe('');
  });

  it('una búsqueda por palabras sueltas encuentra el producto en cualquier orden', () => {
    const heno = textoBuscable('Papa asada con queso');
    const palabras = textoBuscable('ASADA  papá').split(' ');
    expect(palabras.every((p) => heno.includes(p))).toBe(true);
  });
});
