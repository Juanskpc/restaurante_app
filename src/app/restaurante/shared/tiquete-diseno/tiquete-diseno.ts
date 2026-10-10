/**
 * Diseño del tiquete impreso: opciones, valores por defecto y el HTML que sale en papel.
 *
 * Dos tipos de tiquete:
 *
 *  - `comun`: el de siempre. En muchos restaurantes también es la comanda que va a cocina.
 *  - `electronica`: la representación gráfica de una factura electrónica ya validada por la DIAN.
 *
 * ## Una sola función dibuja el tiquete
 *
 * `construirTiqueteHtml` arma el documento entero, con sus estilos. La usa la vista previa de
 * Configuración → Tiquete y la va a usar la impresión, para que lo que el administrador ve sea
 * exactamente lo que sale en la impresora. Hoy Pedidos, Mesas y Despacho tienen cada uno su propia
 * copia del tiquete; reemplazarlas por esta función es el siguiente paso (la decisión de cuándo
 * imprimir cada tiquete sigue abierta).
 *
 * ## Lo que exige la DIAN no es una opción
 *
 * En la factura electrónica, los datos del emisor, el número con prefijo, la resolución, el CUFE,
 * el QR, el comprador, los impuestos y la forma de pago se imprimen siempre.
 *
 * **Nada del proveedor tecnológico sale impreso** (decisión del 2026-10-09): ni su nombre ni su
 * marca. El tiquete dice «Software: EscalApp», que es el programa con el que se elaboró. No están en `CAMPOS`
 * y el servidor rechaza un diseño que intente apagarlos (`CAMPO_DESCONOCIDO`).
 *
 * ## El backend conoce los nombres, no los valores
 *
 * Igual que `carta-diseno.ts`: el servidor valida que cada opción exista; los valores por
 * defecto viven aquí. Un negocio que nunca guardó diseño imprime `DISENO_DEFECTO`.
 */

export type TipoTiquete = 'comun' | 'electronica';
export type PapelId = '58' | '80';
export type LetraId = 'pequena' | 'normal' | 'grande';
export type SeparadorId = 'punteado' | 'continuo';

export type CampoId =
  | 'logo'
  | 'nit'
  | 'direccion'
  | 'telefono'
  | 'fecha'
  | 'numero_pedido'
  | 'atiende'
  | 'cajero'
  | 'tipo_pedido'
  | 'mesa'
  | 'cliente_domicilio'
  | 'notas'
  | 'precio_unitario'
  | 'desglose'
  | 'forma_pago';

export interface DisenoTiquete {
  papel: PapelId;
  letra: LetraId;
  separador: SeparadorId;
  encabezado: string;
  pie: string;
  campos: Record<CampoId, boolean>;
}

/** Lo que se guarda: solo lo que el negocio cambió. */
export type DisenoTiqueteGuardado = Partial<Omit<DisenoTiquete, 'campos'>> & {
  campos?: Partial<Record<CampoId, boolean>>;
};

export interface GrupoCampos {
  titulo: string;
  campos: CampoDef[];
}

export interface CampoDef {
  id: CampoId;
  etiqueta: string;
  ayuda?: string;
  /** En la factura electrónica este dato es obligatorio y sale siempre: no se ofrece. */
  obligatorioEnFe?: boolean;
}

export const GRUPOS_CAMPOS: GrupoCampos[] = [
  {
    titulo: 'Datos del negocio',
    campos: [
      { id: 'logo', etiqueta: 'Logo', ayuda: 'Sale en blanco y negro en la impresora térmica.' },
      { id: 'nit', etiqueta: 'NIT', obligatorioEnFe: true },
      { id: 'direccion', etiqueta: 'Dirección', obligatorioEnFe: true },
      { id: 'telefono', etiqueta: 'Teléfono' },
    ],
  },
  {
    titulo: 'Datos del pedido',
    campos: [
      { id: 'fecha', etiqueta: 'Fecha y hora', obligatorioEnFe: true },
      { id: 'numero_pedido', etiqueta: 'Número de pedido' },
      { id: 'atiende', etiqueta: 'Quién atendió', ayuda: 'El mesero o quien tomó el pedido.' },
      { id: 'cajero', etiqueta: 'Quién cobró' },
      { id: 'tipo_pedido', etiqueta: 'Tipo de pedido', ayuda: 'En mesa, para llevar o domicilio.' },
      { id: 'mesa', etiqueta: 'Mesa' },
      { id: 'cliente_domicilio', etiqueta: 'Cliente del domicilio', ayuda: 'Nombre, teléfono y dirección.' },
      { id: 'notas', etiqueta: 'Notas del pedido', ayuda: 'Incluye «sin cebolla» y notas por producto.' },
    ],
  },
  {
    titulo: 'Valores',
    campos: [
      { id: 'precio_unitario', etiqueta: 'Precio unitario', ayuda: 'Una columna más por producto.' },
      { id: 'desglose', etiqueta: 'Desglose antes del total', ayuda: 'Productos, domicilio y descuento.' },
      { id: 'forma_pago', etiqueta: 'Forma de pago', obligatorioEnFe: true },
    ],
  },
];

/** Lo que la DIAN exige en la representación gráfica. Se muestra en el editor, bloqueado. */
export const OBLIGATORIOS_FE: string[] = [
  'Razón social, NIT y dirección del emisor',
  'Número de factura con su prefijo',
  'Resolución de facturación: número, rango y vigencia',
  'Fecha y hora de generación y de validación',
  'Datos del comprador',
  'Impuestos discriminados (INC o IVA)',
  'Forma de pago',
  'CUFE (código único de la factura)',
  'Código QR para consultarla en la DIAN',
];

export const PAPELES: { id: PapelId; etiqueta: string; ayuda: string; anchoPx: number }[] = [
  { id: '80', etiqueta: '80 mm', ayuda: 'El rollo más común', anchoPx: 280 },
  { id: '58', etiqueta: '58 mm', ayuda: 'Impresoras pequeñas', anchoPx: 200 },
];

export const LETRAS: { id: LetraId; etiqueta: string; px: number }[] = [
  { id: 'pequena', etiqueta: 'Pequeña', px: 11 },
  { id: 'normal', etiqueta: 'Normal', px: 12 },
  { id: 'grande', etiqueta: 'Grande', px: 14 },
];

export const SEPARADORES: { id: SeparadorId; etiqueta: string }[] = [
  { id: 'punteado', etiqueta: 'Punteado' },
  { id: 'continuo', etiqueta: 'Continuo' },
];

export const MAX_TEXTO = 160;

const CAMPOS_TODOS: Record<CampoId, boolean> = {
  logo: true,
  nit: true,
  direccion: true,
  telefono: true,
  fecha: true,
  numero_pedido: true,
  atiende: true,
  cajero: false,
  tipo_pedido: true,
  mesa: true,
  cliente_domicilio: true,
  notas: true,
  precio_unitario: true,
  desglose: true,
  forma_pago: true,
};

/** El tiquete de siempre: lo que imprime un negocio que nunca abrió esta pantalla. */
export const DISENO_DEFECTO: Record<TipoTiquete, DisenoTiquete> = {
  comun: {
    papel: '80',
    letra: 'normal',
    separador: 'punteado',
    encabezado: '',
    pie: '¡Gracias por tu compra!',
    campos: { ...CAMPOS_TODOS, logo: false, nit: false, direccion: false, telefono: false, forma_pago: false },
  },
  electronica: {
    papel: '80',
    letra: 'normal',
    separador: 'punteado',
    encabezado: '',
    pie: '¡Gracias por tu compra!',
    campos: { ...CAMPOS_TODOS, logo: true, notas: false },
  },
};

/** El diseño completo: lo guardado encima del defecto, descartando lo que no se conozca. */
export function resolverDiseno(
  guardado: DisenoTiqueteGuardado | null | undefined,
  tipo: TipoTiquete,
): DisenoTiquete {
  const base = DISENO_DEFECTO[tipo];
  const g = guardado ?? {};
  const campos = { ...base.campos };
  for (const id of Object.keys(campos) as CampoId[]) {
    const valor = g.campos?.[id];
    if (typeof valor === 'boolean') campos[id] = valor;
  }
  return {
    papel: PAPELES.some((p) => p.id === g.papel) ? (g.papel as PapelId) : base.papel,
    letra: LETRAS.some((l) => l.id === g.letra) ? (g.letra as LetraId) : base.letra,
    separador: SEPARADORES.some((s) => s.id === g.separador)
      ? (g.separador as SeparadorId)
      : base.separador,
    encabezado: typeof g.encabezado === 'string' ? g.encabezado : base.encabezado,
    pie: typeof g.pie === 'string' ? g.pie : base.pie,
    campos,
  };
}

/**
 * Lo que se guarda: solo las diferencias con el defecto. Así, si mañana cambia un valor por
 * defecto, lo reciben todos los negocios que no lo tocaron.
 */
export function diferenciasConDefecto(
  diseno: DisenoTiquete,
  tipo: TipoTiquete,
): DisenoTiqueteGuardado {
  const base = DISENO_DEFECTO[tipo];
  const salida: DisenoTiqueteGuardado = {};
  if (diseno.papel !== base.papel) salida.papel = diseno.papel;
  if (diseno.letra !== base.letra) salida.letra = diseno.letra;
  if (diseno.separador !== base.separador) salida.separador = diseno.separador;
  if (diseno.encabezado.trim() !== base.encabezado) salida.encabezado = diseno.encabezado.trim();
  if (diseno.pie.trim() !== base.pie) salida.pie = diseno.pie.trim();
  const campos: Partial<Record<CampoId, boolean>> = {};
  for (const id of Object.keys(base.campos) as CampoId[]) {
    if (diseno.campos[id] !== base.campos[id]) campos[id] = diseno.campos[id];
  }
  if (Object.keys(campos).length) salida.campos = campos;
  return salida;
}

/** Comparación estable para saber si hay cambios sin guardar. */
export function claveDiseno(d: DisenoTiquete): string {
  return JSON.stringify(d, Object.keys(d).sort());
}

// ── Los datos que se imprimen ──

export interface LineaTiquete {
  cantidad: number;
  nombre: string;
  precio_unitario: number;
  total: number;
  /** «Sin: cebolla», «Nota: bien asada». Salen solo con el campo `notas`. */
  detalles?: string[];
}

export interface ImpuestoTiquete {
  nombre: string;
  tarifa: number;
  base: number;
  valor: number;
}

export interface DatosFacturaElectronica {
  emisor: {
    razon_social: string;
    nit: string;
    direccion: string | null;
    responsabilidad: string | null;
  };
  /** Prefijo y número, p. ej. `SETP990024154`. */
  numero: string;
  resolucion: {
    numero: string | null;
    prefijo: string | null;
    desde: number | null;
    hasta: number | null;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
  } | null;
  fecha_validacion: Date;
  comprador: { nombre: string; documento: string | null; correo?: string | null };
  impuestos: ImpuestoTiquete[];
  cufe: string;
  /** La imagen del QR ya generada (data URL). Sin ella se imprime solo el CUFE. */
  qr_data_url: string | null;
}

export interface DatosTiquete {
  negocio: {
    nombre: string;
    nit: string | null;
    direccion: string | null;
    telefono: string | null;
    logo_url: string | null;
  };
  fecha: Date;
  numero_pedido: string | null;
  atiende: string | null;
  cajero: string | null;
  tipo_pedido: string | null;
  mesa: string | null;
  domicilio: { contacto: string | null; telefono: string | null; direccion: string | null } | null;
  notas: string[];
  lineas: LineaTiquete[];
  subtotal: number;
  valor_domicilio: number;
  descuento: number;
  total: number;
  pagos: { metodo: string; valor: number }[];
  electronica: DatosFacturaElectronica | null;
}

// ── Formato ──

const moneda = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

export function formatoMoneda(valor: number): string {
  return moneda.format(Number(valor) || 0);
}

export function formatoFechaHora(fecha: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(fecha);
}

export function escaparHtml(texto: string | null | undefined): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Los archivos subidos (el logo) se guardan como `/uploads/...` y los sirve la API. Para pintarlos
 * en un iframe o en la ventana de impresión hace falta la dirección completa.
 */
export function urlAbsoluta(ruta: string | null | undefined, origen: string): string | null {
  if (!ruta) return null;
  if (/^(https?:|data:|blob:)/i.test(ruta)) return ruta;
  return `${origen.replace(/\/+$/, '')}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
}

/** La dirección de consulta de la DIAN que va dentro del QR. */
export function urlConsultaDian(cufe: string): string {
  return `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(cufe)}`;
}

// ── El HTML ──

/**
 * El tiquete completo, listo para un iframe o para imprimir.
 *
 * Todo texto que venga del negocio o del pedido pasa por `escaparHtml`: el nombre de un producto
 * lo escribe una persona y no puede inyectar marcado en la impresión.
 */
export function construirTiqueteHtml(
  diseno: DisenoTiquete,
  datos: DatosTiquete,
  tipo: TipoTiquete,
): string {
  const e = escaparHtml;
  const fe = tipo === 'electronica' ? datos.electronica : null;
  const c = diseno.campos;
  /** En la factura electrónica, lo obligatorio sale aunque el campo diga que no. */
  const ver = (id: CampoId) => {
    if (fe && GRUPOS_CAMPOS.some((g) => g.campos.some((x) => x.id === id && x.obligatorioEnFe))) {
      return true;
    }
    return c[id];
  };
  const papel = PAPELES.find((p) => p.id === diseno.papel) ?? PAPELES[0];
  const letra = LETRAS.find((l) => l.id === diseno.letra) ?? LETRAS[1];
  const borde = diseno.separador === 'continuo' ? 'solid' : 'dashed';
  const fila = (izq: string, der: string, clase = '') =>
    `<div class="fila ${clase}"><span>${izq}</span><span>${der}</span></div>`;

  // ── Cabecera: el negocio ──
  const cabecera: string[] = [];
  if (ver('logo') && datos.negocio.logo_url) {
    cabecera.push(
      `<img class="logo" src="${e(datos.negocio.logo_url)}" alt="" onerror="this.remove()" />`,
    );
  }
  if (fe) {
    cabecera.push(`<h1 class="titulo">${e(datos.negocio.nombre)}</h1>`);
    if (fe.emisor.razon_social && fe.emisor.razon_social !== datos.negocio.nombre) {
      cabecera.push(`<div class="meta">${e(fe.emisor.razon_social)}</div>`);
    }
    cabecera.push(`<div class="meta">NIT ${e(fe.emisor.nit)}</div>`);
    if (fe.emisor.responsabilidad) cabecera.push(`<div class="meta">${e(fe.emisor.responsabilidad)}</div>`);
    if (fe.emisor.direccion) cabecera.push(`<div class="meta">${e(fe.emisor.direccion)}</div>`);
  } else {
    cabecera.push(`<h1 class="titulo">${e(datos.negocio.nombre)}</h1>`);
    if (ver('nit') && datos.negocio.nit) cabecera.push(`<div class="meta">NIT ${e(datos.negocio.nit)}</div>`);
    if (ver('direccion') && datos.negocio.direccion) {
      cabecera.push(`<div class="meta">${e(datos.negocio.direccion)}</div>`);
    }
  }
  if (ver('telefono') && datos.negocio.telefono) {
    cabecera.push(`<div class="meta">Tel. ${e(datos.negocio.telefono)}</div>`);
  }
  if (diseno.encabezado.trim()) {
    cabecera.push(`<div class="texto-libre">${e(diseno.encabezado.trim())}</div>`);
  }

  // ── Documento (solo factura electrónica) ──
  const documento: string[] = [];
  if (fe) {
    documento.push(`<div class="doc-titulo">FACTURA ELECTRÓNICA DE VENTA</div>`);
    documento.push(`<div class="doc-numero">N.º ${e(fe.numero)}</div>`);
    if (fe.resolucion) {
      const r = fe.resolucion;
      const partes = [
        r.numero ? `Resolución DIAN N.º ${e(r.numero)}` : 'Resolución DIAN',
        r.vigencia_desde ? `del ${e(r.vigencia_desde)}` : '',
      ].filter(Boolean);
      documento.push(`<div class="meta">${partes.join(' ')}</div>`);
      if (r.desde != null && r.hasta != null) {
        documento.push(
          `<div class="meta">Autoriza del ${e(r.prefijo ?? '')}${r.desde} al ${e(r.prefijo ?? '')}${r.hasta}</div>`,
        );
      }
      if (r.vigencia_hasta) documento.push(`<div class="meta">Vigente hasta ${e(r.vigencia_hasta)}</div>`);
    }
  }

  // ── Pedido ──
  const pedido: string[] = [];
  if (fe) {
    pedido.push(fila('Generada', e(formatoFechaHora(datos.fecha))));
    pedido.push(fila('Validada', e(formatoFechaHora(fe.fecha_validacion))));
  } else if (ver('fecha')) {
    pedido.push(`<div class="meta">${e(formatoFechaHora(datos.fecha))}</div>`);
  }
  if (ver('numero_pedido') && datos.numero_pedido) pedido.push(fila('Pedido', e(datos.numero_pedido)));
  if (ver('tipo_pedido') && datos.tipo_pedido) pedido.push(fila('Tipo', e(datos.tipo_pedido)));
  if (ver('mesa') && datos.mesa) pedido.push(fila('Mesa', e(datos.mesa)));
  if (ver('atiende') && datos.atiende) pedido.push(fila('Atiende', e(datos.atiende)));
  if (ver('cajero') && datos.cajero) pedido.push(fila('Cobró', e(datos.cajero)));
  if (ver('cliente_domicilio') && datos.domicilio) {
    const d = datos.domicilio;
    if (d.contacto) pedido.push(fila('Cliente', e(d.contacto)));
    if (d.telefono) pedido.push(fila('Tel.', e(d.telefono)));
    if (d.direccion) pedido.push(`<div class="meta izq">Dir.: ${e(d.direccion)}</div>`);
  }

  // ── Comprador (solo factura electrónica) ──
  const comprador: string[] = [];
  if (fe) {
    comprador.push(`<div class="subtitulo">Adquiriente</div>`);
    comprador.push(`<div class="izq">${e(fe.comprador.nombre)}</div>`);
    if (fe.comprador.documento) comprador.push(`<div class="izq meta">${e(fe.comprador.documento)}</div>`);
    if (fe.comprador.correo) comprador.push(`<div class="izq meta">${e(fe.comprador.correo)}</div>`);
  }

  // ── Productos ──
  const conUnitario = ver('precio_unitario');
  const filas = datos.lineas
    .map((l) => {
      const detalles = ver('notas') && l.detalles?.length
        ? l.detalles
            .map((d) => `<tr><td></td><td colspan="${conUnitario ? 3 : 2}" class="detalle">${e(d)}</td></tr>`)
            .join('')
        : '';
      return `<tr>
          <td class="cant">${l.cantidad}</td>
          <td>${e(l.nombre)}</td>
          ${conUnitario ? `<td class="der">${formatoMoneda(l.precio_unitario)}</td>` : ''}
          <td class="der">${formatoMoneda(l.total)}</td>
        </tr>${detalles}`;
    })
    .join('');
  const tabla = `<table>
      <thead><tr>
        <th class="cant">Cant</th><th class="izq">Producto</th>
        ${conUnitario ? '<th class="der">V/u</th>' : ''}
        <th class="der">Total</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>`;

  const notas = ver('notas') && datos.notas.length
    ? datos.notas.map((n) => `<div class="nota">${e(n)}</div>`).join('')
    : '';

  // ── Totales ──
  const totales: string[] = [];
  const hayDesglose = datos.valor_domicilio > 0 || datos.descuento > 0;
  // En la factura el desglose siempre sale: los valores tienen que cuadrar a la vista.
  if ((fe || ver('desglose')) && hayDesglose) {
    totales.push(fila('Productos', formatoMoneda(datos.subtotal)));
    if (datos.valor_domicilio > 0) totales.push(fila('Domicilio', formatoMoneda(datos.valor_domicilio)));
    if (datos.descuento > 0) totales.push(fila('Descuento', `-${formatoMoneda(datos.descuento)}`));
  }
  totales.push(fila('TOTAL', formatoMoneda(datos.total), 'total'));
  // En un restaurante el impuesto va incluido en el precio: se discrimina debajo del total, como
  // parte de él, y no sumado encima (que haría que las cuentas no cuadren a la vista).
  if (fe) {
    for (const imp of fe.impuestos) {
      totales.push(fila(`Base ${e(imp.nombre)} ${imp.tarifa}%`, formatoMoneda(imp.base), 'impuesto'));
      totales.push(fila(`${e(imp.nombre)} ${imp.tarifa}% (incluido)`, formatoMoneda(imp.valor), 'impuesto'));
    }
  }

  const pagos = ver('forma_pago') && datos.pagos.length
    ? `<div class="bloque">${datos.pagos.map((p) => fila(e(p.metodo), formatoMoneda(p.valor))).join('')}</div>`
    : '';

  // ── Validación DIAN (solo factura electrónica) ──
  const dian = fe
    ? `<hr />
      <div class="centro">
        ${fe.qr_data_url ? `<img class="qr" src="${fe.qr_data_url}" alt="Código QR de la factura" />` : ''}
        <div class="subtitulo">CUFE</div>
        <div class="cufe">${e(fe.cufe)}</div>
        <div class="meta">Representación gráfica de la factura electrónica.</div>
        <div class="meta">Software: EscalApp</div>
      </div>`
    : '';

  const pie = diseno.pie.trim() ? `<div class="pie">${e(diseno.pie.trim())}</div>` : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${fe ? 'Factura electrónica' : 'Tiquete'}</title>
<style>
  @page { size: ${papel.id}mm auto; margin: 4mm; }
  * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, sans-serif; }
  html, body { margin: 0; background: #fff; color: #111; }
  .tiquete { width: ${papel.anchoPx}px; margin: 0 auto; padding: 10px 0; font-size: ${letra.px}px; line-height: 1.35; }
  .centro { text-align: center; }
  .izq { text-align: left; }
  .der { text-align: right; white-space: nowrap; }
  .logo { display: block; max-width: 60%; max-height: 70px; margin: 0 auto 6px; filter: grayscale(1); }
  .titulo { margin: 0; font-size: 1.35em; font-weight: 700; }
  .meta { color: #444; font-size: 0.92em; margin-top: 1px; }
  .texto-libre { margin-top: 6px; font-style: italic; }
  .doc-titulo { font-weight: 700; letter-spacing: 0.02em; }
  .doc-numero { font-size: 1.15em; font-weight: 700; margin: 2px 0; }
  .subtitulo { font-weight: 700; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
  hr { border: 0; border-top: 1px ${borde} #888; margin: 8px 0; }
  .fila { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; }
  .fila span:last-child { text-align: right; }
  .fila.impuesto { font-size: 0.9em; color: #444; }
  .fila.total { margin-top: 6px; padding-top: 5px; border-top: 1px ${borde} #888; font-weight: 700; font-size: 1.2em; }
  .fila.total + .fila.impuesto { margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 0.78em; text-transform: uppercase; color: #555; letter-spacing: 0.04em; padding: 2px 0; }
  td { padding: 3px 0; vertical-align: top; }
  td + td, th + th { padding-left: 4px; }
  .cant { width: 2.2em; text-align: left; }
  .detalle { font-size: 0.85em; color: #555; padding-top: 0; }
  .nota { margin-top: 4px; font-size: 0.92em; }
  .bloque { margin-top: 6px; }
  .qr { width: 120px; height: 120px; margin: 4px auto; display: block; image-rendering: pixelated; }
  .cufe { font-family: Consolas, monospace; font-size: 0.72em; word-break: break-all; margin: 2px 0 6px; }
  .pie { margin-top: 10px; text-align: center; font-size: 0.95em; }
  @media print {
    * { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tiquete { font-weight: 600; }
    hr, .fila.total { border-top-color: #000 !important; }
  }
</style>
</head>
<body>
<div class="tiquete">
  <div class="centro">${cabecera.join('')}</div>
  ${documento.length ? `<hr /><div class="centro">${documento.join('')}</div>` : ''}
  ${pedido.length ? `<hr /><div class="bloque">${pedido.join('')}</div>` : ''}
  ${comprador.length ? `<hr /><div>${comprador.join('')}</div>` : ''}
  <hr />
  ${tabla}
  ${notas}
  <div class="bloque">${totales.join('')}</div>
  ${pagos}
  ${dian}
  ${pie}
</div>
</body>
</html>`;
}

// ── Ejemplo para la vista previa ──

export interface FuenteEjemplo {
  negocio: DatosTiquete['negocio'];
  fiscal: {
    razon_social: string | null;
    nombre_comercial: string | null;
    numero_documento: string | null;
    dv: string | number | null;
    direccion_fiscal: string | null;
    responsable_iva: boolean | null;
    responsable_inc: boolean | null;
  } | null;
  resolucion: {
    prefijo: string | null;
    numero_resolucion: string | null;
    rango_desde: number | null;
    rango_hasta: number | null;
    vigencia_desde: string | null;
    vigencia_hasta: string | null;
  } | null;
}

/** Un CUFE de mentira con la forma de uno real (96 caracteres hexadecimales). */
export const CUFE_EJEMPLO =
  'a3f1c9e27b4d5f6081a2b3c4d5e6f708192a3b4c5d6e7f80a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071';

/**
 * Un pedido inventado con los datos reales del negocio, para que la vista previa se parezca a
 * su tiquete. Donde falta un dato fiscal se dice que falta, en vez de inventarlo: el
 * administrador tiene que ver qué le saldrá vacío.
 */
export function datosDeEjemplo(fuente: FuenteEjemplo, qrDataUrl: string | null): DatosTiquete {
  const lineas: LineaTiquete[] = [
    { cantidad: 2, nombre: 'Hamburguesa clásica', precio_unitario: 18000, total: 36000, detalles: ['Sin: cebolla'] },
    { cantidad: 1, nombre: 'Papas a la francesa', precio_unitario: 7000, total: 7000 },
    { cantidad: 2, nombre: 'Gaseosa 400 ml', precio_unitario: 4500, total: 9000, detalles: ['Nota: bien fría'] },
  ];
  const subtotal = lineas.reduce((s, l) => s + l.total, 0);
  const valorDomicilio = 4000;
  const descuento = 2000;
  const total = subtotal + valorDomicilio - descuento;

  const f = fuente.fiscal;
  const r = fuente.resolucion;
  const nitFiscal = f?.numero_documento
    ? `${f.numero_documento}${f.dv != null && f.dv !== '' ? `-${f.dv}` : ''}`
    : fuente.negocio.nit ?? '(falta el NIT)';
  // INC 8 % incluido en el precio: base = total / 1,08. Es el caso típico de un restaurante.
  const tarifa = 8;
  const base = Math.round(total / (1 + tarifa / 100));
  const prefijo = r?.prefijo ?? 'SETP';
  const numero = `${prefijo}${(r?.rango_desde ?? 990000000) + 154}`;
  const ahora = new Date();

  return {
    negocio: fuente.negocio,
    fecha: ahora,
    numero_pedido: 'ORD-0154',
    atiende: 'Laura Gómez',
    cajero: 'Andrés Pérez',
    tipo_pedido: 'Domicilio',
    mesa: null,
    domicilio: { contacto: 'Carlos Ruiz', telefono: '300 123 4567', direccion: 'Calle 18 # 25-40, Centro' },
    notas: ['Nota: tocar el timbre dos veces'],
    lineas,
    subtotal,
    valor_domicilio: valorDomicilio,
    descuento,
    total,
    pagos: [
      { metodo: 'Efectivo', valor: 30000 },
      { metodo: 'Nequi', valor: total - 30000 },
    ],
    electronica: {
      emisor: {
        razon_social: f?.razon_social ?? f?.nombre_comercial ?? fuente.negocio.nombre,
        nit: nitFiscal,
        direccion: f?.direccion_fiscal ?? fuente.negocio.direccion ?? '(falta la dirección fiscal)',
        responsabilidad: f?.responsable_iva ? 'Responsable de IVA' : 'No responsable de IVA',
      },
      numero,
      resolucion: {
        numero: r?.numero_resolucion ?? '18760000001',
        prefijo,
        desde: r?.rango_desde ?? 990000000,
        hasta: r?.rango_hasta ?? 995000000,
        vigencia_desde: r?.vigencia_desde ?? null,
        vigencia_hasta: r?.vigencia_hasta ?? null,
      },
      fecha_validacion: new Date(ahora.getTime() + 4000),
      comprador: { nombre: 'Carlos Ruiz', documento: 'C.C. 1.085.123.456', correo: 'carlos@correo.com' },
      impuestos: [{ nombre: 'INC', tarifa, base, valor: total - base }],
      cufe: CUFE_EJEMPLO,
      qr_data_url: qrDataUrl,
    },
  };
}
