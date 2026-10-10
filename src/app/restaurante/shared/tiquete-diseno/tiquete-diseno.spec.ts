import { describe, expect, it } from 'vitest';

import {
  CUFE_EJEMPLO,
  DISENO_DEFECTO,
  DatosTiquete,
  FuenteEjemplo,
  construirTiqueteHtml,
  datosDeEjemplo,
  diferenciasConDefecto,
  resolverDiseno,
  urlAbsoluta,
} from './tiquete-diseno';

const FUENTE: FuenteEjemplo = {
  negocio: {
    nombre: 'Zona <Burger>',
    nit: '900123456',
    direccion: 'Calle 1 # 2-3',
    telefono: '3001234567',
    logo_url: null,
  },
  fiscal: {
    razon_social: 'ZONA BURGER S.A.S.',
    nombre_comercial: null,
    numero_documento: '900123456',
    dv: '7',
    direccion_fiscal: 'Calle 1 # 2-3',
    responsable_iva: false,
    responsable_inc: true,
  },
  resolucion: {
    prefijo: 'ZB',
    numero_resolucion: '18764000000001',
    rango_desde: 1,
    rango_hasta: 5000,
    vigencia_desde: '2026-01-01',
    vigencia_hasta: '2028-01-01',
  },
};

function datos(): DatosTiquete {
  return datosDeEjemplo(FUENTE, 'data:image/png;base64,QR');
}

describe('resolverDiseno', () => {
  it('sin nada guardado es el diseño por defecto', () => {
    expect(resolverDiseno(null, 'comun')).toEqual(DISENO_DEFECTO.comun);
    expect(resolverDiseno(undefined, 'electronica')).toEqual(DISENO_DEFECTO.electronica);
  });

  it('lo guardado manda y lo desconocido se ignora', () => {
    const d = resolverDiseno(
      { papel: '58', campos: { cajero: true }, letra: 'enorme' as never },
      'comun',
    );
    expect(d.papel).toBe('58');
    expect(d.campos.cajero).toBe(true);
    expect(d.letra).toBe(DISENO_DEFECTO.comun.letra);
  });
});

describe('diferenciasConDefecto', () => {
  it('el diseño por defecto no guarda nada', () => {
    expect(diferenciasConDefecto(DISENO_DEFECTO.comun, 'comun')).toEqual({});
  });

  it('guarda solo lo que cambió, y de ida y vuelta da lo mismo', () => {
    const cambiado = {
      ...DISENO_DEFECTO.comun,
      papel: '58' as const,
      pie: '  Vuelve pronto  ',
      campos: { ...DISENO_DEFECTO.comun.campos, mesa: false },
    };
    const guardado = diferenciasConDefecto(cambiado, 'comun');
    expect(guardado).toEqual({ papel: '58', pie: 'Vuelve pronto', campos: { mesa: false } });
    expect(resolverDiseno(guardado, 'comun')).toEqual({ ...cambiado, pie: 'Vuelve pronto' });
  });
});

describe('construirTiqueteHtml', () => {
  it('escapa lo que escribe el negocio', () => {
    const html = construirTiqueteHtml(DISENO_DEFECTO.comun, datos(), 'comun');
    expect(html).toContain('Zona &lt;Burger&gt;');
    expect(html).not.toContain('Zona <Burger>');
  });

  it('el tiquete común no dice que sea factura ni lleva CUFE', () => {
    const html = construirTiqueteHtml(DISENO_DEFECTO.comun, datos(), 'comun');
    expect(html).not.toContain('FACTURA ELECTRÓNICA');
    expect(html).not.toContain(CUFE_EJEMPLO);
  });

  it('los campos apagados no salen en el común', () => {
    const d = { ...DISENO_DEFECTO.comun, campos: { ...DISENO_DEFECTO.comun.campos, mesa: false, atiende: false } };
    const conMesa = { ...datos(), mesa: 'Mesa 4' };
    const html = construirTiqueteHtml(d, conMesa, 'comun');
    expect(html).not.toContain('Mesa 4');
    expect(html).not.toContain('Laura Gómez');
  });

  it('la factura electrónica lleva todo lo que exige la DIAN', () => {
    const html = construirTiqueteHtml(DISENO_DEFECTO.electronica, datos(), 'electronica');
    expect(html).toContain('FACTURA ELECTRÓNICA DE VENTA');
    expect(html).toContain('ZB155');
    expect(html).toContain('ZONA BURGER S.A.S.');
    expect(html).toContain('NIT 900123456-7');
    expect(html).toContain('Resolución DIAN N.º 18764000000001');
    expect(html).toContain('Autoriza del ZB1 al ZB5000');
    expect(html).toContain('Adquiriente');
    expect(html).toContain('INC 8% (incluido)');
    expect(html).toContain('Base INC 8%');
    expect(html).toContain(CUFE_EJEMPLO);
    expect(html).toContain('data:image/png;base64,QR');
    expect(html).toContain('Software: EscalApp');
    expect(html.toLowerCase()).not.toContain('factus');
  });

  it('en la factura, apagar un campo obligatorio no lo quita', () => {
    const d = {
      ...DISENO_DEFECTO.electronica,
      campos: { ...DISENO_DEFECTO.electronica.campos, nit: false, forma_pago: false, fecha: false },
    };
    const html = construirTiqueteHtml(d, datos(), 'electronica');
    expect(html).toContain('NIT 900123456-7');
    expect(html).toContain('Efectivo');
    expect(html).toContain('Validada');
  });

  it('el ancho del papel cambia el ancho del tiquete', () => {
    const angosto = construirTiqueteHtml({ ...DISENO_DEFECTO.comun, papel: '58' }, datos(), 'comun');
    expect(angosto).toContain('size: 58mm auto');
    expect(angosto).toContain('width: 200px');
  });
});

describe('urlAbsoluta', () => {
  it('pone el servidor delante de una ruta de /uploads', () => {
    expect(urlAbsoluta('/uploads/reserva/logos/17/logo.png?v=1', 'http://localhost:3000')).toBe(
      'http://localhost:3000/uploads/reserva/logos/17/logo.png?v=1',
    );
  });

  it('deja quietas las direcciones completas y la ausencia de logo', () => {
    expect(urlAbsoluta('https://cdn.x/logo.png', 'http://a')).toBe('https://cdn.x/logo.png');
    expect(urlAbsoluta(null, 'http://a')).toBeNull();
  });
});
