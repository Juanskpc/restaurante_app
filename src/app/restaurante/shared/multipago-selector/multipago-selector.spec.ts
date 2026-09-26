import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

import { MultipagoSelectorComponent } from './multipago-selector';

/**
 * El selector de forma de pago, que **comparten las tres pantallas que cobran**: POS, Mesas y
 * Despacho.
 *
 * Estas pruebas existen por un fallo concreto: el selector de «¿de quién es la tiquetera?» se
 * puso al principio solo en el POS. Mesas ofrecía «Cuenta / Tiquetera» en el desplegable, no
 * preguntaba el cliente, y el cobro moría con un 422 que no explicaba nada. Por eso ahora la
 * pregunta vive **aquí dentro** y no en cada pantalla.
 *
 * Lo que se sostiene:
 *   1. El selector de cliente aparece SOLO si la forma de pago elegida es la de las cuentas, y
 *      esa se reconoce por la marca `es_cuenta`, nunca por el nombre (el negocio la renombra).
 *   2. Mientras no se elija cliente, la selección **no es válida** — es lo que impide que el
 *      cobro llegue al servidor para ser rechazado.
 *   3. También cuando la cuenta es una de las formas de un multipago (la tiquetera no alcanza
 *      y el resto se paga en efectivo).
 */
describe('MultipagoSelectorComponent — cobro contra la cuenta del cliente', () => {
  const EFECTIVO = { id_metodo_pago: 1, nombre: 'Efectivo' };
  // Renombrada a propósito: si el código la buscara por el nombre, esta prueba lo caza.
  const CUENTA = { id_metodo_pago: 9, nombre: 'Fiado de la casa', es_cuenta: true };

  const CUENTAS = [
    { id_cuenta: 7, cliente: 'Don Pedro', modo: 'DINERO' as const, saldo: 50000 },
    { id_cuenta: 8, cliente: 'Doña Rosa', modo: 'TIQUETES' as const, saldo: 0, total_tiquetes: 12 },
  ];

  let fixture: ReturnType<typeof TestBed.createComponent<MultipagoSelectorComponent>>;
  let comp: MultipagoSelectorComponent;

  /** Acceso a los miembros protegidos, que es lo que la plantilla usa. */
  const interno = () => comp as unknown as {
    modo: { set: (v: 'simple' | 'multi') => void };
    metodoSimple: { set: (v: number | null) => void };
    filas: { set: (v: Array<{ id_metodo_pago: number | null; valor: number | null }>) => void };
    cuentaElegida: { set: (v: number | null) => void };
    pagaConCuenta: () => boolean;
    resumenCuenta: () => string;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MultipagoSelectorComponent] });
    fixture = TestBed.createComponent(MultipagoSelectorComponent);
    comp = fixture.componentInstance;
    fixture.componentRef.setInput('metodos', [EFECTIVO, CUENTA]);
    fixture.componentRef.setInput('cuentas', CUENTAS);
    fixture.componentRef.setInput('total', 20000);
    fixture.componentRef.setInput('permiteMultipago', true);
    fixture.detectChanges();
  });

  it('con una forma de pago normal no pregunta por ninguna cuenta', () => {
    interno().metodoSimple.set(EFECTIVO.id_metodo_pago);

    expect(interno().pagaConCuenta()).toBe(false);
    expect(comp.seleccion().valido).toBe(true);
    expect(comp.seleccion().idCuenta).toBeNull();
  });

  it('reconoce la forma de pago de cuenta por la marca, aunque esté renombrada', () => {
    interno().metodoSimple.set(CUENTA.id_metodo_pago);
    expect(interno().pagaConCuenta()).toBe(true);
  });

  it('sin elegir cliente, la selección NO es válida', () => {
    interno().metodoSimple.set(CUENTA.id_metodo_pago);

    // Esto es lo que impide que el cobro salga y vuelva como 422.
    expect(comp.seleccion().valido).toBe(false);
    expect(comp.seleccion().idCuenta).toBeNull();
  });

  it('al elegir el cliente, la selección queda válida y lo lleva', () => {
    interno().metodoSimple.set(CUENTA.id_metodo_pago);
    interno().cuentaElegida.set(7);

    expect(comp.seleccion().valido).toBe(true);
    expect(comp.seleccion().idCuenta).toBe(7);
  });

  it('también lo pide cuando la cuenta es una de las formas del multipago', () => {
    // La tiquetera no alcanza: 12.000 de cuenta y 8.000 en efectivo.
    interno().modo.set('multi');
    interno().filas.set([
      { id_metodo_pago: CUENTA.id_metodo_pago, valor: 12000 },
      { id_metodo_pago: EFECTIVO.id_metodo_pago, valor: 8000 },
    ]);

    expect(interno().pagaConCuenta()).toBe(true);
    // El desglose cuadra con el total, pero falta decir de quién es la cuenta.
    expect(comp.seleccion().valido).toBe(false);

    interno().cuentaElegida.set(8);
    expect(comp.seleccion().valido).toBe(true);
    expect(comp.seleccion().idCuenta).toBe(8);
  });

  it('enseña lo que le queda al cliente, en su unidad', () => {
    interno().metodoSimple.set(CUENTA.id_metodo_pago);

    interno().cuentaElegida.set(7);
    expect(interno().resumenCuenta()).toContain('a favor');

    interno().cuentaElegida.set(8);
    expect(interno().resumenCuenta()).toBe('Le quedan 12 tiquetes');
  });

  it('si el negocio no tiene la forma de pago de cuenta, nada cambia', () => {
    fixture.componentRef.setInput('metodos', [EFECTIVO]);
    interno().metodoSimple.set(EFECTIVO.id_metodo_pago);

    expect(interno().pagaConCuenta()).toBe(false);
    expect(comp.seleccion().valido).toBe(true);
  });
});

/**
 * El negocio de DOS formas de pago, que es el caso corriente (efectivo y transferencia).
 *
 * Las dos cosas que se sostienen aquí salieron del mismo sitio: el ORD-0655 de El Callejero,
 * que el cajero acabó cancelando porque el desglose no se dejaba tocar.
 *
 *   1. Al abrir el multipago, las dos formas ya vienen puestas: con solo dos, el reparto no
 *      tiene más variantes que «algo de una y el resto de la otra».
 *   2. Se pueden intercambiar. Antes el desplegable escondía la forma usada en la otra fila,
 *      así que con dos filas llenas cada una solo se ofrecía a sí misma: sin salida.
 */
describe('MultipagoSelectorComponent — negocio con solo dos formas de pago', () => {
  const EFECTIVO = { id_metodo_pago: 1, nombre: 'Efectivo' };
  const TRANSFERENCIA = { id_metodo_pago: 2, nombre: 'Transferencia' };

  let fixture: ReturnType<typeof TestBed.createComponent<MultipagoSelectorComponent>>;
  let comp: MultipagoSelectorComponent;

  const interno = () => comp as unknown as {
    filas: () => Array<{ id_metodo_pago: number | null; valor: number | null }>;
    onSelectChange: (raw: string) => void;
    setFilaMetodo: (index: number, raw: string) => void;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MultipagoSelectorComponent] });
    fixture = TestBed.createComponent(MultipagoSelectorComponent);
    comp = fixture.componentInstance;
    fixture.componentRef.setInput('metodos', [EFECTIVO, TRANSFERENCIA]);
    fixture.componentRef.setInput('total', 19000);
    fixture.componentRef.setInput('permiteMultipago', true);
    fixture.detectChanges();
  });

  it('al elegir multipago siembra las dos formas, sin que el cajero las teclee', () => {
    interno().onSelectChange('__multi__');

    const filas = interno().filas();
    expect(filas.map((f) => f.id_metodo_pago)).toEqual([1, 2]);
    // La primera sigue arrancando con el total, para cuadrar con un solo dato.
    expect(filas[0].valor).toBe(19000);
    expect(filas[1].valor).toBeNull();
  });

  it('elegir en una fila la forma que tiene la otra las intercambia', () => {
    interno().onSelectChange('__multi__');
    interno().setFilaMetodo(0, '15000'); // ruido: un id que no existe no debe romper nada
    interno().setFilaMetodo(0, '1');     // vuelve a Efectivo
    interno().setFilaMetodo(1, '5000');
    interno().setFilaMetodo(1, '2');

    interno().setFilaMetodo(0, '2'); // el cajero pone Transferencia arriba

    expect(interno().filas().map((f) => f.id_metodo_pago)).toEqual([2, 1]);
  });

  it('el reparto del dinero no se mueve al intercambiar las formas', () => {
    interno().onSelectChange('__multi__');

    const antes = interno().filas().map((f) => f.valor);
    interno().setFilaMetodo(0, '2');

    expect(interno().filas().map((f) => f.valor)).toEqual(antes);
  });

  it('con una cuenta de cliente entre las dos formas NO se siembra nada', () => {
    // Sembrar la cuenta abriría «¿de quién es?» de entrada y dejaría el cobro inválido.
    fixture.componentRef.setInput('metodos', [
      EFECTIVO,
      { id_metodo_pago: 9, nombre: 'Fiado', es_cuenta: true },
    ]);
    fixture.detectChanges();

    interno().onSelectChange('__multi__');

    expect(interno().filas().map((f) => f.id_metodo_pago)).toEqual([null, null]);
  });
});
