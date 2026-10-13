import type { Modalidad } from './carrito.service';

/**
 * Los datos que la carta le pide al cliente ANTES de abrir WhatsApp, para que el bot no tenga que
 * preguntarlos uno a uno (cada pregunta es un mensaje de WhatsApp y, a veces, un turno de IA).
 *
 * Viajan en el mensaje como un bloque legible con etiquetas FIJAS, antes de la línea `#P…`:
 *
 *     Nombre: Ana Pérez
 *     Dirección: Cra 3 #21-10, apto 201
 *     Nota: sin cebolla en todo
 *
 * ⚠️ Contrato con `admin_ws/intelligence/adapters/restaurante/datosCliente.js`, que lo lee con un
 * parser estricto por etiqueta. Las etiquetas (`ETIQUETAS`) son las mismas en los dos lados. Todo
 * lo de aquí es una SUGERENCIA editable: la confirmación del bot lo vuelve a enseñar antes del «sí».
 * Nada de esto viaja dentro de la línea `#P`.
 *
 * ## El teléfono vuelve al formulario (2026-10-12), y esta vez como CONTACTO
 *
 * Se quitó el 2026-09-27 con un argumento correcto: el cliente llega por su WhatsApp, el canal
 * prueba su número, y uno escrito a mano solo podía contradecirlo. Lo que no se vio es que desde
 * el cambio de identidad de WhatsApp (BSUID) **hay clientes que llegan sin número**: ni `from`
 * ni `wa_id`. Para ellos el canal no prueba nada y el bot tiene que preguntarlo por chat — un
 * mensaje suyo, uno del cliente y a veces un turno de IA, que es justo lo que este bloque
 * existe para ahorrar. Y cuando el modelo se lo salta, el pedido sale sin nadie a quien llamar.
 *
 * La carta **no puede saber** si ese cliente enseña su número: es una página pública, aquí no hay
 * identidad de WhatsApp. Así que se pregunta siempre, que cuesta un campo y cero mensajes.
 *
 * Lo que NO cambia es la jerarquía: esto es un dato de **contacto**, nunca una identidad. Si el
 * canal probó un número, gana el probado y el escrito aquí se ignora (`sembrarDatosCliente`).
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

/** Cuántos dígitos tiene que tener un número para que valga como contacto. */
const DIGITOS_TELEFONO = { min: 7, max: 15 };

/** Los dígitos de lo escrito, sin espacios, guiones ni paréntesis. */
export function digitosDe(valor: string): string {
  return String(valor ?? '').replace(/\D/g, '');
}

export interface Requisito {
  campo: CampoCliente;
  obligatorio: boolean;
}

/**
 * Qué se pide según cómo quiere recibir el pedido:
 *  - domicilio: nombre, teléfono y dirección obligatorios.
 *  - recoger: nombre y teléfono.
 *  - en el local (mesa): solo el nombre.
 * La nota especial es OPCIONAL en las tres (desde 2026-09-25: antes era solo del domicilio, y quien
 * pedía en mesa o para recoger no tenía dónde decir «sin cebolla en todo»). El bot ya la lee y la
 * guarda sea cual sea el tipo de pedido.
 *
 * El teléfono se pide en los dos tipos que salen del local, y **no por lo mismo**: en un domicilio
 * es para que el domiciliario llame desde la puerta; para recoger, para avisar cuando esté listo.
 * En mesa no se pide: quien está sentado no necesita que lo llamen (y ahí la carta ni arma pedido).
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
        { campo: 'telefono', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ];
    case 'L':
      return [
        { campo: 'nombre', obligatorio: true },
        { campo: 'nota', obligatorio: false },
      ];
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

export type ErroresCliente = Partial<Record<CampoCliente, string>>;

/** Validación ligera: obligatorios y largos. Vacío = sin errores. */
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
    // Se cuentan los dígitos y no los caracteres: «300 123 4567» es un número válido escrito como
    // lo escribe la gente. Lo único que se rechaza es lo que no puede ser un teléfono.
    if (campo === 'telefono') {
      const digitos = digitosDe(valor).length;
      if (digitos < DIGITOS_TELEFONO.min || digitos > DIGITOS_TELEFONO.max) {
        errores.telefono = 'Escribe un número de contacto válido.';
      }
    }
  }
  return errores;
}

function articulo(campo: CampoCliente): string {
  return {
    nombre: 'tu nombre',
    telefono: 'tu número de contacto',
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
    const valor = sanear(datos[campo], MAXIMOS[campo]);
    if (valor) lineas.push(`${ETIQUETAS[campo]}: ${valor}`);
  }
  return lineas;
}
