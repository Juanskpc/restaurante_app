import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { LUCIDE_ICONS, LucideIconProvider } from 'lucide-angular';
import { describe, it, expect, beforeEach } from 'vitest';

import { icons } from '../../../app.config';

import { ComparadorComponent } from './comparador/comparador';
import { ComprasComponent } from './compras/compras';
import { ProveedorFormComponent } from './proveedor-form/proveedor-form';
import { ProveedoresComponent } from './proveedores';
import type { PermisosProveedores } from './proveedor-detalle/proveedor-detalle';
import type { GrupoComparado, Proveedor } from '../../../core/services/proveedores.service';

/**
 * Proveedores — las piezas del frontend que pueden romperse en silencio.
 *
 * Montar los componentes no es ceremonia: el módulo usa `input.required()`, y leer uno antes
 * de que Angular lo ate lanza NG0950 **en tiempo de ejecución**, con el build en verde. Pasó
 * con `ComprasComponent`, que llamaba a `cargar()` —y por tanto a `permisos()`— desde el
 * constructor. Estas pruebas montan de verdad para que no vuelva a colarse.
 *
 * Lo demás es la aritmética del comparador y el armado del formulario, que es donde un fallo
 * no se ve: una comparación equivocada sigue pareciendo una comparación.
 */

const PERMISOS_TODO: PermisosProveedores = {
  crear: true, editar: true, archivar: true, compras: true, precios: true, publicar: true,
};

const PERMISOS_NADA: PermisosProveedores = {
  crear: false, editar: false, archivar: false, compras: false, precios: false, publicar: false,
};

/**
 * Los iconos se registran igual que en la app real (`app.config.ts`) en vez de con un doble.
 *
 * No es comodidad: `lucide-angular` lanza si le piden un icono que nadie proveyó, así que
 * montar con el mapa de verdad convierte estas pruebas en la red que caza un `name="…"` mal
 * escrito o un icono nuevo que se olvidó registrar — que no se ve en el build y sí revienta
 * la pantalla.
 */
function configurar() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider(icons) },
    ],
  });
}

describe('ProveedoresComponent — la vista se monta', () => {
  beforeEach(configurar);

  it('arranca en la pestaña de proveedores y sin romperse', () => {
    const fixture = TestBed.createComponent(ProveedoresComponent);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.seccion()).toBe('lista');
    // Sin sesión no hay negocio: la vista tiene que aguantarlo sin pedir nada.
    expect(comp.negocioId()).toBeNull();
    expect(comp.proveedores()).toEqual([]);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Proveedores');
    expect(texto).toContain('Comparador');
    expect(texto).toContain('Compras');
  });

  it('cambia de sección sin tocar la red', () => {
    const fixture = TestBed.createComponent(ProveedoresComponent);
    fixture.detectChanges();

    fixture.componentInstance.seccion.set('comparador');
    fixture.detectChanges();
    expect(fixture.componentInstance.seccion()).toBe('comparador');

    fixture.componentInstance.seccion.set('compras');
    fixture.detectChanges();
    expect(fixture.componentInstance.seccion()).toBe('compras');
  });

  it('«mis proveedores» excluye los archivados y los que no están en la lista', () => {
    const fixture = TestBed.createComponent(ProveedoresComponent);
    const comp = fixture.componentInstance;

    comp.proveedores.set([
      { id_proveedor: 1, nombre_comercial: 'Mío activo', es_propio: true } as Proveedor,
      { id_proveedor: 2, nombre_comercial: 'Mío archivado', es_propio: true,
        estado_interno: 'ARCHIVADO' } as Proveedor,
      { id_proveedor: 3, nombre_comercial: 'Del directorio', es_propio: false } as Proveedor,
    ]);

    // Es la lista que alimenta el desplegable de «registrar compra»: meter ahí uno archivado
    // o uno ajeno lleva derecho al 409 SIN_VINCULO del servidor.
    expect(comp.misProveedores().map((p) => p.id_proveedor)).toEqual([1]);
  });
});

describe('ComprasComponent — se monta con sus inputs obligatorios', () => {
  beforeEach(configurar);

  it('no lee `permisos` antes de tiempo (el fallo NG0950 que ya ocurrió)', () => {
    const fixture = TestBed.createComponent(ComprasComponent);
    fixture.componentRef.setInput('permisos', PERMISOS_TODO);
    fixture.componentRef.setInput('proveedores', []);
    fixture.componentRef.setInput('ingredientes', []);

    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('sin permiso de precios enseña el aviso en vez de la tabla', () => {
    const fixture = TestBed.createComponent(ComprasComponent);
    fixture.componentRef.setInput('permisos', PERMISOS_NADA);
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Necesitas permiso para ver las compras');
    expect(fixture.componentInstance.puedeVer()).toBe(false);
  });

  it('el total del renglón descuenta, y nunca baja de cero', () => {
    const fixture = TestBed.createComponent(ComprasComponent);
    fixture.componentRef.setInput('permisos', PERMISOS_TODO);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const renglon = {
      clave: 1, idInsumo: null, idIngrediente: null, descripcion: 'Arroz',
      cantidad: 3, unidad: 'KG', precioUnitario: 1000, descuento: 500,
    };
    expect(comp.totalRenglon(renglon)).toBe(2500);

    // Un descuento mayor que la línea no genera un total negativo: genera cero.
    expect(comp.totalRenglon({ ...renglon, descuento: 99999 })).toBe(0);
  });

  it('el total general suma renglones, resta descuento y suma impuesto', () => {
    const fixture = TestBed.createComponent(ComprasComponent);
    fixture.componentRef.setInput('permisos', PERMISOS_TODO);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.renglones.set([
      { clave: 1, idInsumo: null, idIngrediente: null, descripcion: 'A',
        cantidad: 2, unidad: 'KG', precioUnitario: 10000, descuento: null },
      { clave: 2, idInsumo: null, idIngrediente: null, descripcion: 'B',
        cantidad: 1, unidad: 'UN', precioUnitario: 5000, descuento: 1000 },
    ]);
    expect(comp.subtotal()).toBe(24000);

    comp.fDescuento.set(4000);
    comp.fImpuesto.set(1000);
    expect(comp.totalForm()).toBe(21000);
  });

  it('no deja guardar sin proveedor ni sin cantidad', () => {
    const fixture = TestBed.createComponent(ComprasComponent);
    fixture.componentRef.setInput('permisos', PERMISOS_TODO);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.renglones.set([
      { clave: 1, idInsumo: null, idIngrediente: null, descripcion: 'Arroz',
        cantidad: 1, unidad: 'KG', precioUnitario: 1000, descuento: null },
    ]);

    comp.fProveedor.set(null);
    expect(comp.puedeGuardar()).toBe(false);

    comp.fProveedor.set(5);
    expect(comp.puedeGuardar()).toBe(true);

    comp.renglones.update((l) => l.map((r) => ({ ...r, cantidad: 0 })));
    expect(comp.puedeGuardar()).toBe(false);
  });
});

describe('ComparadorComponent', () => {
  beforeEach(configurar);

  it('sin permiso de precios no ofrece siquiera el buscador', () => {
    const fixture = TestBed.createComponent(ComparadorComponent);
    fixture.componentRef.setInput('puedeVerPrecios', false);
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Necesitas permiso para comparar precios');
  });

  it('calcula el sobrecosto respecto al más barato', () => {
    const fixture = TestBed.createComponent(ComparadorComponent);
    fixture.componentRef.setInput('puedeVerPrecios', true);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    const grupo = {
      clave: 'nom:arroz',
      insumo: 'Arroz',
      id_mas_barato: 10,
      unidades_mixtas: false,
      presentaciones_distintas: true,
      fechas_dispares: false,
      precio_mas_viejo_dias: 3,
      ofertas: [
        { id_proveedor_insumo: 10, precio_base: 2000 },
        { id_proveedor_insumo: 11, precio_base: 2200 },
      ],
    } as unknown as GrupoComparado;

    expect(comp.sobrecosto(grupo, 11)).toBeCloseTo(10, 5);
    // El más barato no se compara consigo mismo: no hay sobrecosto que enseñar.
    expect(comp.sobrecosto(grupo, 10)).toBeNull();
  });

  it('sin ganador señalado no inventa un sobrecosto', () => {
    const fixture = TestBed.createComponent(ComparadorComponent);
    fixture.componentRef.setInput('puedeVerPrecios', true);
    fixture.detectChanges();

    // `id_mas_barato: null` es lo que manda el backend cuando mezcla kilos con cajas.
    const grupo = {
      id_mas_barato: null,
      ofertas: [{ id_proveedor_insumo: 10, precio_base: 2000 }],
    } as unknown as GrupoComparado;

    expect(fixture.componentInstance.sobrecosto(grupo, 10)).toBeNull();
  });

  it('abrevia la unidad base para que se lea «$/kg»', () => {
    const fixture = TestBed.createComponent(ComparadorComponent);
    fixture.componentRef.setInput('puedeVerPrecios', true);
    const comp = fixture.componentInstance;

    expect(comp.unidadCorta('KG')).toBe('/kg');
    expect(comp.unidadCorta('L')).toBe('/L');
    expect(comp.unidadCorta(null)).toBe('');
  });
});

describe('ProveedorFormComponent', () => {
  beforeEach(configurar);

  const CATEGORIAS = [
    { id_categoria_prov: 1, codigo: 'carnes', nombre: 'Carnes y proteínas', icono: null },
    { id_categoria_prov: 2, codigo: 'bebidas', nombre: 'Bebidas', icono: null },
    { id_categoria_prov: 3, codigo: 'abarrotes', nombre: 'Abarrotes', icono: null },
  ];

  function montar(proveedor: unknown = null, puedePublicar = true) {
    const fixture = TestBed.createComponent(ProveedorFormComponent);
    fixture.componentRef.setInput('categorias', CATEGORIAS);
    fixture.componentRef.setInput('puedePublicar', puedePublicar);
    fixture.componentRef.setInput(
      'proveedor',
      proveedor as Parameters<typeof fixture.componentRef.setInput>[1],
    );
    fixture.detectChanges();
    return fixture;
  }

  it('nace vacío, privado y sin poder guardarse', () => {
    const comp = montar().componentInstance;
    expect(comp.esEdicion()).toBe(false);
    expect(comp.visibilidad()).toBe('PRIVADO');
    expect(comp.puedeGuardar()).toBe(false);
  });

  it('pide solo lo imprescindible: el nombre basta para guardar', () => {
    const comp = montar().componentInstance;
    comp.nombre.set('Carnes del Valle');
    expect(comp.puedeGuardar()).toBe(true);
  });

  it('sin permiso de publicar, elegir una visibilidad compartida no hace nada', () => {
    const fixture = montar(null, false);
    const comp = fixture.componentInstance;
    comp.elegirVisibilidad('DIRECTORIO');
    expect(comp.visibilidad()).toBe('PRIVADO');

    // Con el permiso sí cambia: el bloqueo es del permiso, no del componente.
    fixture.componentRef.setInput('puedePublicar', true);
    fixture.detectChanges();
    comp.elegirVisibilidad('DIRECTORIO');
    expect(comp.visibilidad()).toBe('DIRECTORIO');
  });

  it('la categoría se busca y se elige una sola', () => {
    const comp = montar().componentInstance;

    comp.alEscribirCategoria('beb');
    expect(comp.categoriasFiltradas().map((c) => c.codigo)).toEqual(['bebidas']);

    comp.elegirCategoria(CATEGORIAS[1]);
    expect(comp.categoria()).toBe('bebidas');
    expect(comp.buscaCategoria()).toBe('Bebidas');
    expect(comp.listaAbierta()).toBe(false);

    // Con una elegida, la lista vuelve a enseñarlas todas: si filtrara por el nombre puesto,
    // habría que borrarlo a mano para poder cambiar de categoría.
    expect(comp.categoriasFiltradas()).toHaveLength(3);

    comp.limpiarCategoria();
    expect(comp.categoria()).toBeNull();
  });

  it('borrar el texto suelta la categoría elegida', () => {
    const comp = montar().componentInstance;
    comp.elegirCategoria(CATEGORIAS[0]);
    expect(comp.categoria()).toBe('carnes');

    comp.alEscribirCategoria('');
    expect(comp.categoria()).toBeNull();
  });

  it('el contacto se guarda como teléfono Y como WhatsApp', () => {
    const fixture = montar();
    const comp = fixture.componentInstance;
    let emitido: Record<string, unknown> | null = null;
    comp.guardar.subscribe((p) => { emitido = p as Record<string, unknown>; });

    comp.nombre.set('  Carnes del Valle  ');
    comp.contacto.set('+573001112233');
    comp.elegirCategoria(CATEGORIAS[0]);
    comp.direccion.set('Calle 10 #5-20');
    comp.enviar();

    const p = emitido as unknown as {
      nombre_comercial: string; telefono: string; whatsapp: string;
      categorias: string[]; direccion: string; sitio_web: string | null; visibilidad: string;
    };
    expect(p.nombre_comercial).toBe('Carnes del Valle');
    // Un solo número para los dos botones: llamar y escribir.
    expect(p.telefono).toBe('+573001112233');
    expect(p.whatsapp).toBe('+573001112233');
    expect(p.categorias).toEqual(['carnes']);
    expect(p.direccion).toBe('Calle 10 #5-20');
    // Lo que se deja en blanco viaja como null, no como cadena vacía.
    expect(p.sitio_web).toBeNull();
    expect(p.visibilidad).toBe('PRIVADO');
  });

  it('no emite nada si falta el nombre, y enciende el error', () => {
    const comp = montar().componentInstance;
    let veces = 0;
    comp.guardar.subscribe(() => { veces += 1; });

    comp.enviar();
    expect(veces).toBe(0);
    expect(comp.errorNombre()).not.toBeNull();
  });

  it('al editar se rellena con la ficha que llega', () => {
    const comp = montar({
      id_proveedor: 7,
      nombre_comercial: 'Distribuidora Andina',
      whatsapp: '+573009998877',
      direccion: 'Carrera 7 #30-15',
      sitio_web: 'https://andina.co',
      visibilidad: 'DIRECTORIO',
      categorias: [CATEGORIAS[0]],
      redes: {},
      es_propio: true,
      nivel_acceso: 'propio',
    }).componentInstance;

    expect(comp.esEdicion()).toBe(true);
    expect(comp.nombre()).toBe('Distribuidora Andina');
    expect(comp.contacto()).toBe('+573009998877');
    expect(comp.direccion()).toBe('Carrera 7 #30-15');
    expect(comp.sitioWeb()).toBe('https://andina.co');
    expect(comp.visibilidad()).toBe('DIRECTORIO');
    expect(comp.categoria()).toBe('carnes');
    expect(comp.buscaCategoria()).toBe('Carnes y proteínas');
  });

  /**
   * El fallo que este test existe para impedir: el backend reescribe la ficha entera al
   * editar, así que un campo que el formulario ya no muestra y no devuelve se borraría solo.
   */
  it('devuelve intactos los campos que ya no se piden', () => {
    const comp = montar({
      id_proveedor: 9,
      nombre_comercial: 'Vieja Guardia',
      nombre_legal: 'Vieja Guardia SAS',
      identificacion: '900111222-3',
      email: 'ventas@vieja.co',
      ciudad: 'Medellín',
      pedido_minimo: 80000,
      dias_entrega: [1, 3],
      observaciones: 'Entrega antes de las 9',
      categorias: [],
      redes: { instagram: '@vieja' },
      tipo_atencion: 'ENTREGA',
      es_propio: true,
      nivel_acceso: 'propio',
    }).componentInstance;

    let emitido: Record<string, unknown> | null = null;
    comp.guardar.subscribe((p) => { emitido = p as Record<string, unknown>; });
    comp.enviar();

    const p = emitido as unknown as Record<string, unknown>;
    expect(p['nombre_legal']).toBe('Vieja Guardia SAS');
    expect(p['identificacion']).toBe('900111222-3');
    expect(p['email']).toBe('ventas@vieja.co');
    expect(p['ciudad']).toBe('Medellín');
    expect(p['pedido_minimo']).toBe(80000);
    expect(p['dias_entrega']).toEqual([1, 3]);
    expect(p['observaciones']).toBe('Entrega antes de las 9');
    expect(p['redes']).toEqual({ instagram: '@vieja' });
    expect(p['tipo_atencion']).toBe('ENTREGA');
  });
});
