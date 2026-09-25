import type { Modalidad } from './carrito.service';

/**
 * Los datos que la carta le pide al cliente ANTES de abrir WhatsApp, para que el bot no tenga que
 * preguntarlos uno a uno (cada pregunta es un mensaje de WhatsApp y, a veces, un turno de IA).
 *
 * Viajan en el mensaje como un bloque legible con etiquetas FIJAS, antes de la línea `#P…`:
 *
 *     Nombre: Ana Pérez
 *     Teléfono: 3001234567
 *     Dirección: Cra 3 #21-10, apto 201
 *     Nota: sin cebolla en todo
 *
 * ⚠️ Contrato con `admin_ws/intelligence/adapters/restaurante/datosCliente.js`, que lo lee con un
 * parser estricto por etiqueta. Las etiquetas (`ETIQUETAS`) son las mismas en los dos lados. Todo
 * lo de aquí es una SUGERENCIA editable: la confirmación del bot lo vuelve a enseñar antes del «sí».
 * Nada de esto viaja dentro de la línea `#P`.
 */
export interface DatosCliente {
  nombre: string;
  telefono: string;
  direccion: string;
  nota: string;
}

export type CampoCliente = keyof DatosCliente;

export const CLIENTE_VACIO: DatosCliente = { nombre: '', telefono: '', direccion: '', nota: '' };

/** Las etiquetas del mensaje. Si cambian aquí, cambian en `datosCliente.js` (y al revés). */
export const ETIQUETAS: Record<CampoCliente, string> = {
  nombre: 'Nombre',
  telefono: 'Teléfono',
  direccion: 'Dirección',
  nota: 'Nota',
};

/** Largos máximos: los mismos que aplica el bot al leerlos. */
export const MAXIMOS: Record<CampoCliente, number> = {
  nombre: 100,
  telefono: 20,
  direccion: 300,
  nota: 300,
};

export interface Requisito {
  campo: CampoCliente;
  obligatorio: boolean;
}

/**
 * Qué se pide según cómo quiere recibir el pedido:
 *  - domicilio: nombre, teléfono y dirección obligatorios; nota opcional.
 *  - recoger: nombre obligatorio; teléfono opcional (WhatsApp ya lo trae, pero puede ser otro).
 *  - en el local (mesa): solo el nombre.
 * La nota es solo del domicilio.
 */
export function requisitos(modalidad: Modalidad | null): Requisito[] {
  switch (modalidad) {
    case 'D':
      return [
        { campo: 'nombre', obligatorio: true },
        { campo: 'telefono', obligatorio: true },
        { campo: 'direccion', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ];
    case 'R':
      return [
        { campo: 'nombre', obligatorio: true },
        { campo: 'telefono', obligatorio: false },
      ];
    case 'L':
      return [{ campo: 'nombre', obligatorio: true }];
    default:
      return [];
  }
}

/**
 * Quita saltos de línea y caracteres de control, junta espacios, recorta al máximo — y borra
 * cualquier `#P<dígito>` que el valor traiga.
 *
 * El bloque de datos va ANTES de la línea `#P…` en el mensaje. Sin esto, una dirección o una nota
 * que contuviera algo con esa forma («Calle 5 #P12-9x9») podría leerse como el código del pedido
 * en vez del real: el lector (`codigoPedido.js`) ya se queda con la ÚLTIMA coincidencia, pero
 * quitarlo aquí además evita que aparezca dos veces y confunda a quien lea el mensaje.
 */
export function sanear(valor: string, max: number): string {
  return String(valor ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/#P(?=\d)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Solo dígitos, con un `+` inicial si lo trae. */
export function limpiarTelefono(valor: string): string {
  const crudo = String(valor ?? '').trim();
  const digitos = crudo.replace(/\D/g, '');
  return (crudo.startsWith('+') ? '+' : '') + digitos.slice(0, 15);
}

const DIGITOS_TELEFONO = { min: 7, max: 15 };

export type ErroresCliente = Partial<Record<CampoCliente, string>>;

/** Validación ligera: obligatorios, largos y teléfono con dígitos. Vacío = sin errores. */
export function validarCliente(modalidad: Modalidad | null, datos: DatosCliente): ErroresCliente {
  const errores: ErroresCliente = {};
  for (const { campo, obligatorio } of requisitos(modalidad)) {
    const valor = sanear(datos[campo], MAXIMOS[campo]);
    if (!valor) {
      if (obligatorio) errores[campo] = `Escribe ${articulo(campo)}.`;
      continue;
    }
    if (campo === 'nombre' && valor.length < 2) errores.nombre = 'El nombre es muy corto.';
    if (campo === 'direccion' && valor.length < 5) errores.direccion = 'La dirección es muy corta.';
    if (campo === 'telefono') {
      const n = valor.replace(/\D/g, '').length;
      if (n < DIGITOS_TELEFONO.min || n > DIGITOS_TELEFONO.max) {
        errores.telefono = 'Escribe un teléfono con solo números (mínimo 7 dígitos).';
      }
    }
  }
  return errores;
}

function articulo(campo: CampoCliente): string {
  return {
    nombre: 'tu nombre',
    telefono: 'un teléfono de contacto',
    direccion: 'la dirección',
    nota: 'la nota',
  }[campo];
}

/**
 * Las líneas del bloque del mensaje, ya saneadas. Solo las etiquetas que aplican a la modalidad y
 * que tienen valor: una etiqueta vacía no se escribe (el bot pregunta solo lo que falta).
 */
export function lineasDelBloque(modalidad: Modalidad | null, datos: DatosCliente): string[] {
  const lineas: string[] = [];
  for (const { campo } of requisitos(modalidad)) {
    const valor =
      campo === 'telefono'
        ? limpiarTelefono(sanear(datos.telefono, MAXIMOS.telefono))
        : sanear(datos[campo], MAXIMOS[campo]);
    if (valor) lineas.push(`${ETIQUETAS[campo]}: ${valor}`);
  }
  return lineas;
}
