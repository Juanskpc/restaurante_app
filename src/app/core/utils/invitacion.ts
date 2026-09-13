/**
 * El mensaje de bienvenida que se le manda a un usuario recién creado.
 *
 * Se arma y se envía **desde el navegador**, no desde el servidor, por dos razones:
 * la contraseña ya está aquí —es la que el administrador acaba de escribir en el
 * formulario— y así no hay que devolverla nunca en una respuesta del backend; y el
 * administrador elige por dónde la manda, que en la práctica es WhatsApp y no el
 * correo, porque es donde el empleado la va a leer.
 *
 * El texto va en claro a propósito: es lo que hace que el empleado pueda entrar sin
 * una segunda vuelta. Por eso el mensaje cierra pidiendo que la cambie al entrar.
 */

export interface DatosInvitacion {
  /** Nombre de pila, para saludar. */
  nombre: string;
  /** Nombre del negocio al que se le da la bienvenida. */
  negocio: string;
  /** Con qué entra. */
  usuario: string;
  /**
   * Cómo se llama ese dato en la pantalla de acceso. Cambia entre verticales —el
   * restaurante entra con el correo y la agenda con el documento— y si el mensaje
   * dice solo «Usuario» la persona prueba con el que no es y cree que está bloqueada.
   */
  etiquetaUsuario?: string;
  /** La que escribió el administrador en el formulario. */
  password: string;
  /** Dónde entra. */
  url: string;
}

/** Resultado de intentar enviar la invitación, para decidir qué avisar al usuario. */
export type ResultadoEnvio = 'compartido' | 'copiado' | 'cancelado' | 'fallo';

/**
 * La dirección donde el invitado inicia sesión.
 *
 * NO es la de esta app. Ni el restaurante ni la agenda tienen pantalla de acceso
 * propia: las dos mandan a la consola del admin, que es la que autentica y devuelve
 * a la vertical. Enviar el enlace de la app dejaría al invitado rebotando hacia una
 * pantalla que no esperaba.
 *
 * Se le pasa el `adminUrl` del entorno para que salga bien en local y en el VPS sin
 * una dirección escrita a mano en el mensaje.
 */
export function urlDeAcceso(adminUrl?: string): string {
  const base = (adminUrl || '').trim().replace(/\/+$/, '');
  if (base) return `${base}/auth/login`;
  // Sin entorno configurado se cae a donde está servida la app: peor enlace que el
  // del admin, pero mejor que un mensaje sin ninguno.
  return typeof document === 'undefined' ? '' : document.baseURI;
}

/** Compone el mensaje. Se deja como texto plano: tiene que leerse bien en WhatsApp. */
export function componerInvitacion(datos: DatosInvitacion): string {
  const saludo = datos.nombre.trim()
    ? `¡Hola ${datos.nombre.trim()}!`
    : '¡Hola!';

  return [
    `${saludo} Te damos la bienvenida a ${datos.negocio}.`,
    '',
    'Ya puedes entrar con estos datos:',
    `${datos.etiquetaUsuario?.trim() || 'Usuario'}: ${datos.usuario}`,
    `Contraseña: ${datos.password}`,
    '',
    `Entra aquí: ${datos.url}`,
    '',
    'Por seguridad, cambia tu contraseña la primera vez que entres.',
  ].join('\n');
}

/**
 * Abre el menú de compartir del dispositivo y, si no existe, copia al portapapeles.
 *
 * En el móvil `navigator.share` es lo que pone WhatsApp, Telegram y los SMS a un
 * toque. En el escritorio casi ningún navegador lo trae, y ahí copiar es la salida
 * razonable. Se distingue «cancelado» de «fallo» porque cerrar el menú de compartir
 * a propósito no es un error y no debe avisar de nada.
 */
export async function enviarInvitacion(texto: string, titulo: string): Promise<ResultadoEnvio> {
  if (typeof navigator === 'undefined') return 'fallo';

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: titulo, text: texto });
      return 'compartido';
    } catch (err) {
      // `AbortError` es el usuario cerrando la hoja de compartir. Cualquier otra cosa
      // (un permiso denegado, por ejemplo) se cae al portapapeles en vez de rendirse.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelado';
    }
  }

  return (await copiarAlPortapapeles(texto)) ? 'copiado' : 'fallo';
}

/**
 * Copia texto, con el camino viejo de reserva.
 *
 * `navigator.clipboard` necesita contexto seguro (HTTPS o localhost); en una IP de
 * la red local por HTTP no existe, y ahí es donde el inquilino prueba la app desde
 * el teléfono antes de tener dominio.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Sigue al camino de abajo.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
