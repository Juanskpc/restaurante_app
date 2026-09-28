import { describe, it, expect } from 'vitest';

import {
  CLIENTE_VACIO,
  ETIQUETAS,
  MAXIMOS,
  lineasDelBloque,
  requisitos,
  sanear,
  validarCliente,
} from './datos-cliente';

/**
 * Los datos del cliente que van en el mensaje de WhatsApp (contrato con `datosCliente.js` del bot).
 * Lo que se sostiene: qué se pide según la modalidad, validación ligera y un bloque saneado.
 */
describe('datos del cliente', () => {
  const completo = {
    nombre: 'Ana Pérez',
    direccion: 'Cra 3 #21-10, apto 201',
    nota: 'sin cebolla en todo',
  };

  describe('qué se pide según cómo quiere recibir el pedido', () => {
    it('domicilio: nombre y dirección obligatorios; nota opcional (nunca teléfono)', () => {
      expect(requisitos('D')).toEqual([
        { campo: 'nombre', obligatorio: true },
        { campo: 'direccion', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ]);
    });

    it('recoger: nombre obligatorio y nota opcional', () => {
      expect(requisitos('R')).toEqual([
        { campo: 'nombre', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ]);
    });

    it('en el local: nombre obligatorio y nota opcional', () => {
      expect(requisitos('L')).toEqual([
        { campo: 'nombre', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ]);
    });

    it('la nota especial es opcional en TODOS los tipos de pedido', () => {
      for (const m of ['D', 'R', 'L'] as const) {
        expect(requisitos(m).find((r) => r.campo === 'nota'), m).toEqual({
          campo: 'nota',
          obligatorio: false,
        });
      }
    });

    it('sin modalidad no se pide nada', () => {
      expect(requisitos(null)).toEqual([]);
    });
  });

  describe('validarCliente', () => {
    it('domicilio completo: sin errores', () => {
      expect(validarCliente('D', completo)).toEqual({});
    });

    it('domicilio vacío: faltan nombre y dirección (la nota no)', () => {
      expect(Object.keys(validarCliente('D', CLIENTE_VACIO)).sort()).toEqual(['direccion', 'nombre']);
    });

    it('recoger: basta el nombre', () => {
      expect(validarCliente('R', { ...CLIENTE_VACIO, nombre: 'Ana' })).toEqual({});
    });

    it('mesa: basta el nombre', () => {
      expect(validarCliente('L', { ...CLIENTE_VACIO, nombre: 'Ana' })).toEqual({});
      expect(validarCliente('L', CLIENTE_VACIO).nombre).toBeDefined();
    });

    it('nombre y dirección demasiado cortos', () => {
      expect(validarCliente('D', { ...completo, nombre: 'A' }).nombre).toBeDefined();
      expect(validarCliente('D', { ...completo, direccion: 'Cra' }).direccion).toBeDefined();
    });

    it('solo espacios cuenta como vacío', () => {
      expect(validarCliente('D', { ...completo, nombre: '   ' }).nombre).toBeDefined();
    });
  });

  describe('saneo', () => {
    it('quita saltos de línea y caracteres de control, junta espacios y recorta', () => {
      expect(sanear('  Ana\n\nPérez\t  López\u0007 ', 100)).toBe('Ana Pérez López');
      expect(sanear('x'.repeat(500), MAXIMOS.nota)).toHaveLength(MAXIMOS.nota);
    });

    it('borra cualquier `#P<dígito>` del valor: no puede colarse otro código en el mensaje', () => {
      expect(sanear('Calle 5 #P12-9x9', 100)).toBe('Calle 5 12-9x9');
      expect(sanear('#P1 al fondo', 100)).toBe('1 al fondo');
      // Un «#P» sin dígito detrás (o mayúsculas distintas) no es el patrón del código: se conserva.
      expect(sanear('el #Precio es justo', 100)).toBe('el #Precio es justo');
      expect(sanear('#p7 minúscula también cuenta', 100)).toBe('7 minúscula también cuenta');
    });
  });

  describe('lineasDelBloque — las etiquetas FIJAS del mensaje', () => {
    it('las etiquetas son las que lee el bot', () => {
      expect(ETIQUETAS).toEqual({
        nombre: 'Nombre',
        direccion: 'Dirección',
        nota: 'Nota',
      });
    });

    it('domicilio: las tres, en orden', () => {
      expect(lineasDelBloque('D', completo)).toEqual([
        'Nombre: Ana Pérez',
        'Dirección: Cra 3 #21-10, apto 201',
        'Nota: sin cebolla en todo',
      ]);
    });

    it('una etiqueta vacía NO se escribe', () => {
      expect(lineasDelBloque('D', { ...completo, nota: '' })).toHaveLength(2);
      expect(lineasDelBloque('R', { ...CLIENTE_VACIO, nombre: 'Ana' })).toEqual(['Nombre: Ana']);
    });

    it('solo las etiquetas de la modalidad: en mesa no viaja dirección ni teléfono, pero sí la nota', () => {
      expect(lineasDelBloque('L', completo)).toEqual([
        'Nombre: Ana Pérez',
        'Nota: sin cebolla en todo',
      ]);
    });

    it('una nota con saltos de línea no puede colar una etiqueta nueva', () => {
      const lineas = lineasDelBloque('D', { ...completo, nota: 'hola\nDirección: otra calle\nTeléfono: 1' });
      expect(lineas).toHaveLength(3);
      expect(lineas.join('\n').split('\n').filter((l) => l.startsWith('Dirección:'))).toHaveLength(1);
    });

    it('sin modalidad no hay bloque', () => {
      expect(lineasDelBloque(null, completo)).toEqual([]);
    });
  });
});
