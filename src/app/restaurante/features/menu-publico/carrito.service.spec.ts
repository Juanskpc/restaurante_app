import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { CarritoService } from './carrito.service';

/**
 * El carrito del menú digital.
 *
 * Lo que más se prueba aquí es el **código compacto**, porque es un contrato: el asistente lo
 * lee del mensaje de WhatsApp para armar el pedido. Si el formato cambia sin que cambie el
 * parser del bot, el cliente manda un pedido que nadie entiende — y no se entera hasta que
 * alguien no le trae la comida.
 */
describe('CarritoService', () => {
  let carrito: CarritoService;

  const hamburguesa = { id_producto: 39, nombre: 'Hamburguesa doble', precio: 32000 };
  const limonada = { id_producto: 41, nombre: 'Limonada', precio: 7000 };

  beforeEach(() => {
    TestBed.configureTestingModule({});
    carrito = TestBed.inject(CarritoService);
    try {
      localStorage.clear();
    } catch {
      /* en un entorno sin localStorage el servicio ya degrada solo */
    }
    carrito.iniciar(12);
  });

  describe('sumar y restar', () => {
    it('agregar dos veces el mismo producto sube la cantidad, no duplica la línea', () => {
      carrito.agregar(hamburguesa);
      carrito.agregar(hamburguesa);

      expect(carrito.items().length).toBe(1);
      expect(carrito.items()[0].cantidad).toBe(2);
      expect(carrito.cantidadTotal()).toBe(2);
    });

    it('quitar la última unidad saca el producto del carrito', () => {
      carrito.agregar(hamburguesa);
      carrito.quitar(hamburguesa.id_producto);

      expect(carrito.items()).toEqual([]);
      expect(carrito.vacio()).toBe(true);
    });

    it('el total suma precio por cantidad', () => {
      carrito.agregar(hamburguesa);
      carrito.agregar(hamburguesa);
      carrito.agregar(limonada);

      expect(carrito.total()).toBe(32000 * 2 + 7000);
    });
  });

  describe('el código compacto — el contrato con el bot', () => {
    it('lleva el negocio y cada producto con su cantidad', () => {
      carrito.agregar(hamburguesa);
      carrito.agregar(hamburguesa);
      carrito.agregar(limonada);

      expect(carrito.codigoCompacto()).toBe('#P12-39x2,41x1');
    });

    it('va en la ÚLTIMA línea y solo', () => {
      // El cliente suele escribir algo antes de enviar. Si el código estuviera en medio del
      // texto, esa frase lo partiría; en la última línea el bot lo encuentra siempre.
      carrito.agregar(hamburguesa);

      const lineas = carrito.mensajeParaWhatsApp().split('\n');
      expect(lineas[lineas.length - 1]).toBe(carrito.codigoCompacto());
    });

    it('el mensaje también es legible para una persona', () => {
      // Las dos mitades importan: el humano ve lo que pidió, el bot lee el código. Un mensaje
      // que solo fuera código parecería un error al cliente que lo envía.
      carrito.agregar(hamburguesa);
      carrito.agregar(limonada);

      const mensaje = carrito.mensajeParaWhatsApp();
      expect(mensaje).toContain('1 × Hamburguesa doble');
      expect(mensaje).toContain('1 × Limonada');
      expect(mensaje).toContain('Total aproximado');
    });
  });

  describe('el enlace de WhatsApp', () => {
    beforeEach(() => carrito.agregar(hamburguesa));

    it('acepta el número suelto y le pone el indicativo', () => {
      expect(carrito.enlaceWhatsApp('3152812484')).toContain('wa.me/573152812484');
    });

    it('acepta un número ya en formato internacional', () => {
      expect(carrito.enlaceWhatsApp('+57 315 281 2484')).toContain('wa.me/573152812484');
    });

    it('acepta una URL de wa.me ya hecha', () => {
      // Los tres formatos aparecen en la práctica según quién rellenó el campo. Fallar por eso
      // sería castigar al negocio por un detalle de forma.
      expect(carrito.enlaceWhatsApp('https://wa.me/573152812484')).toContain('wa.me/573152812484');
    });

    it('sin número devuelve null, y entonces el botón no se muestra', () => {
      expect(carrito.enlaceWhatsApp(null)).toBeNull();
      expect(carrito.enlaceWhatsApp('')).toBeNull();
    });

    it('el mensaje va codificado para la URL', () => {
      const enlace = carrito.enlaceWhatsApp('3152812484')!;
      expect(enlace).toContain('?text=');
      // Un salto de línea sin codificar rompería la URL.
      expect(enlace).not.toContain('\n');
    });
  });

  describe('memoria entre visitas', () => {
    it('el carrito sobrevive a recargar la página', () => {
      carrito.agregar(hamburguesa);

      const otro = TestBed.inject(CarritoService);
      otro.iniciar(12);
      expect(otro.cantidadTotal()).toBeGreaterThan(0);
    });

    it('cada negocio tiene el suyo: no se mezclan las cartas', () => {
      // Quien mire dos cartas distintas no debe encontrarse los platos de una en la otra.
      carrito.agregar(hamburguesa);
      carrito.iniciar(99);

      expect(carrito.vacio()).toBe(true);
    });

    it('ignora lo guardado si viene con otra forma', () => {
      // Es entrada del exterior, aunque la haya escrito esta misma aplicación hace una semana
      // con otra versión del formato.
      localStorage.setItem('escalapp.carrito.12', JSON.stringify([{ nombre: 'roto' }, 42, null]));
      carrito.iniciar(12);

      expect(carrito.items()).toEqual([]);
    });

    it('el formato viejo (un array pelado) se descarta: no se sabe de cuándo es', () => {
      // Así se guardaba antes. Sin fecha no hay forma de saber si es de hace diez minutos o de
      // hace un mes, y un carrito de hace un mes enciende la insignia como si hubiera un pedido.
      localStorage.setItem(
        'escalapp.carrito.12',
        JSON.stringify([
          { id_producto: 39, nombre: 'Hamburguesa doble', precio: 32000, cantidad: 1 },
        ])
      );
      carrito.iniciar(12);

      expect(carrito.vacio()).toBe(true);
    });

    it('lo descartado se borra, no se queda ocupando sitio en el navegador', () => {
      localStorage.setItem('escalapp.carrito.12', JSON.stringify([{ id_producto: 39 }]));
      carrito.iniciar(12);

      expect(localStorage.getItem('escalapp.carrito.12')).toBeNull();
    });

    it('un carrito de anteayer no vuelve', () => {
      carrito.agregar(hamburguesa);

      const sobre = JSON.parse(localStorage.getItem('escalapp.carrito.12')!);
      sobre.guardado = Date.now() - 48 * 60 * 60 * 1000;
      localStorage.setItem('escalapp.carrito.12', JSON.stringify(sobre));

      carrito.iniciar(12);
      expect(carrito.vacio()).toBe(true);
    });

    it('dentro de la vigencia sí vuelve', () => {
      carrito.agregar(hamburguesa);

      const sobre = JSON.parse(localStorage.getItem('escalapp.carrito.12')!);
      sobre.guardado = Date.now() - 30 * 60 * 1000; // media hora
      localStorage.setItem('escalapp.carrito.12', JSON.stringify(sobre));

      carrito.iniciar(12);
      expect(carrito.cantidadTotal()).toBe(1);
    });
  });

  describe('un pedido que ya salió no resucita', () => {
    it('tras abrir WhatsApp, la siguiente visita empieza limpia', () => {
      carrito.agregar(hamburguesa);
      carrito.marcarEnviado();

      carrito.iniciar(12); // el cliente vuelve a abrir el menú
      expect(carrito.vacio()).toBe(true);
    });

    it('pero en la MISMA pestaña sigue ahí, por si vuelve sin haber enviado', () => {
      // Abrir WhatsApp no es haber enviado. Si vuelve atrás, su trabajo tiene que seguir.
      carrito.agregar(hamburguesa);
      carrito.marcarEnviado();

      expect(carrito.cantidadTotal()).toBe(1);
    });

    it('vaciar a mano borra también la marca: lo que se añada después es un pedido nuevo', () => {
      carrito.agregar(hamburguesa);
      carrito.marcarEnviado();
      carrito.vaciar();
      carrito.agregar(limonada);

      carrito.iniciar(12);
      expect(carrito.cantidadTotal()).toBe(1);
    });
  });

  describe('cómo quiere pedir — modificadores del código (contrato con el bot)', () => {
    beforeEach(() => carrito.agregar(hamburguesa));

    it('SIN elección el código y el mensaje son exactamente los de siempre', () => {
      expect(carrito.codigoCompacto()).toBe('#P12-39x1');
      expect(carrito.mensajeParaWhatsApp()).not.toContain('Modalidad');
      expect(carrito.mensajeParaWhatsApp()).not.toContain('Domicilio');
    });

    it('domicilio con barrio: ~m=D~z=<id> y el domicilio suma al total', () => {
      carrito.elegirModalidad('D');
      carrito.elegirBarrio({ id_barrio: 7, nombre: 'Centro', valor: 4500 });

      expect(carrito.codigoCompacto()).toBe('#P12-39x1~m=D~z=7');
      expect(carrito.totalConDomicilio()).toBe(32000 + 4500);
      const mensaje = carrito.mensajeParaWhatsApp();
      expect(mensaje).toContain('A domicilio · Centro');
      expect(mensaje).toContain('Domicilio: ');
      // El total del mensaje incluye el domicilio.
      expect(mensaje).toMatch(/Total aproximado: \$\s?36\.500/);
    });

    it('«otro barrio» va como z=0 y no suma nada', () => {
      carrito.elegirModalidad('D');
      carrito.elegirBarrio({ id_barrio: 0, nombre: 'Otro barrio', valor: null });

      expect(carrito.codigoCompacto()).toBe('#P12-39x1~m=D~z=0');
      expect(carrito.domicilio()).toBe(0);
    });

    it('recoger: ~m=R; en el local: ~m=L~t=<mesa>', () => {
      carrito.elegirModalidad('R');
      expect(carrito.codigoCompacto()).toBe('#P12-39x1~m=R');

      carrito.elegirModalidad('L');
      carrito.elegirMesa({ id_mesa: 5, nombre: 'Mesa 5', numero: 5 });
      expect(carrito.codigoCompacto()).toBe('#P12-39x1~m=L~t=5');
    });

    it('el código con modificadores sigue en la ÚLTIMA línea y solo', () => {
      carrito.elegirModalidad('D');
      carrito.elegirBarrio({ id_barrio: 7, nombre: 'Centro', valor: 4500 });

      const lineas = carrito.mensajeParaWhatsApp().split('\n');
      expect(lineas[lineas.length - 1]).toBe('#P12-39x1~m=D~z=7');
    });

    it('cambiar de modalidad suelta el barrio y la mesa que ya no aplican', () => {
      carrito.elegirModalidad('D');
      carrito.elegirBarrio({ id_barrio: 7, nombre: 'Centro', valor: 4500 });
      carrito.elegirModalidad('R');

      expect(carrito.barrio()).toBeNull();
      expect(carrito.domicilio()).toBe(0);
      expect(carrito.codigoCompacto()).toBe('#P12-39x1~m=R');
    });

    it('la elección se recuerda entre visitas, por negocio', () => {
      carrito.elegirModalidad('D');
      carrito.elegirBarrio({ id_barrio: 7, nombre: 'Centro', valor: 4500 });

      carrito.iniciar(12);
      expect(carrito.modalidad()).toBe('D');
      expect(carrito.barrio()?.id_barrio).toBe(7);

      carrito.iniciar(99);
      expect(carrito.modalidad()).toBeNull();
    });

    it('lo guardado con otra forma o vencido se ignora', () => {
      localStorage.setItem('escalapp.pedido.12', JSON.stringify({ v: 9 }));
      carrito.iniciar(12);
      expect(carrito.modalidad()).toBeNull();

      localStorage.setItem(
        'escalapp.pedido.12',
        JSON.stringify({ v: 1, guardado: Date.now() - 5 * 60 * 60 * 1000, modalidad: 'R', barrio: null, mesa: null }),
      );
      carrito.iniciar(12);
      expect(carrito.modalidad()).toBeNull();
    });
  });

  describe('ingredientes quitados — líneas distintas y el código `-r`', () => {
    const cebolla = { id_ingrediente: 12, nombre: 'cebolla' };
    const tomate = { id_ingrediente: 15, nombre: 'tomate' };

    it('sin exclusiones todo es como siempre: `39x1`, sin «(sin …)»', () => {
      carrito.agregar(hamburguesa);
      expect(carrito.codigoCompacto()).toBe('#P12-39x1');
      expect(carrito.mensajeParaWhatsApp()).toContain('• 1 × Hamburguesa doble\n');
      expect(carrito.items()[0].exclusiones).toEqual([]);
    });

    it('«una sin cebolla» y «una con todo» son DOS líneas del mismo producto', () => {
      carrito.agregar(hamburguesa, [cebolla]);
      carrito.agregar(hamburguesa);

      expect(carrito.items()).toHaveLength(2);
      expect(carrito.codigoCompacto()).toBe('#P12-39x1-r12,39x1');
    });

    it('se suman solo las líneas con el MISMO conjunto de exclusiones (sin importar el orden)', () => {
      carrito.agregar(hamburguesa, [tomate, cebolla]);
      carrito.agregar(hamburguesa, [cebolla, tomate]);

      expect(carrito.items()).toHaveLength(1);
      expect(carrito.items()[0].cantidad).toBe(2);
      expect(carrito.codigoCompacto()).toBe('#P12-39x2-r12.15');
    });

    it('el mensaje legible dice «(sin cebolla, sin tomate)»', () => {
      carrito.agregar(hamburguesa, [cebolla, tomate]);
      expect(carrito.mensajeParaWhatsApp()).toContain('• 1 × Hamburguesa doble (sin cebolla, sin tomate)');
    });

    it('la línea #P sigue siendo la ÚLTIMA y sola', () => {
      carrito.agregar(hamburguesa, [cebolla]);
      const lineas = carrito.mensajeParaWhatsApp().split('\n');
      expect(lineas[lineas.length - 1]).toBe('#P12-39x1-r12');
    });

    it('el «n» de la tarjeta suma TODAS las líneas del producto', () => {
      carrito.agregar(hamburguesa, [cebolla]);
      carrito.agregar(hamburguesa, [cebolla]);
      carrito.agregar(hamburguesa);
      carrito.agregar(limonada);

      expect(carrito.cantidadDe(39)).toBe(3);
      expect(carrito.cantidadDe(41)).toBe(1);
    });

    it('el «−» de la tarjeta resta de la línea MÁS RECIENTE del producto', () => {
      carrito.agregar(hamburguesa, [cebolla]); // antigua
      carrito.agregar(hamburguesa); // más reciente
      carrito.quitar(39);

      expect(carrito.items()).toHaveLength(1);
      expect(carrito.items()[0].exclusiones).toEqual([cebolla]); // la reciente salió
    });

    it('cada línea se ajusta por separado y sale al llegar a cero', () => {
      carrito.agregar(hamburguesa, [cebolla]);
      carrito.agregar(hamburguesa);
      carrito.sumarALinea('39:12', 2);
      carrito.sumarALinea('39:', -1);

      expect(carrito.items()).toHaveLength(1);
      expect(carrito.items()[0].cantidad).toBe(3);
    });

    it('un texto largo recorta SOLO lo legible: la línea #P va completa', () => {
      for (let n = 1; n <= 28; n++) {
        carrito.agregar({ id_producto: n, nombre: `Producto con un nombre bastante largo número ${n}`, precio: 1000 }, [
          { id_ingrediente: n, nombre: 'ingrediente con nombre largo uno' },
          { id_ingrediente: n + 100, nombre: 'ingrediente con nombre largo dos' },
        ]);
      }
      const mensaje = carrito.mensajeParaWhatsApp();
      const lineas = mensaje.split('\n');

      expect(lineas[lineas.length - 1]).toBe(carrito.codigoCompacto());
      expect(carrito.codigoCompacto().match(/x1-r/g)).toHaveLength(28); // ningún producto se perdió
      expect(mensaje).toContain('… y ');
      expect(mensaje.length - carrito.codigoCompacto().length).toBeLessThan(1700);
    });

    it('sin pasarse de largo el texto no se recorta', () => {
      carrito.agregar(hamburguesa, [cebolla]);
      expect(carrito.mensajeParaWhatsApp()).not.toContain('… y ');
    });

    it('persistencia: las exclusiones sobreviven a recargar', () => {
      carrito.agregar(hamburguesa, [cebolla, tomate]);
      carrito.iniciar(12);
      expect(carrito.items()[0].exclusiones).toEqual([cebolla, tomate]);
    });

    it('un carrito guardado con el formato anterior (v2, sin exclusiones) sigue leyéndose', () => {
      localStorage.setItem(
        'escalapp.carrito.12',
        JSON.stringify({
          v: 2,
          guardado: Date.now(),
          enviadoEn: null,
          items: [{ id_producto: 39, nombre: 'Hamburguesa doble', precio: 32000, cantidad: 2 }],
        }),
      );
      carrito.iniciar(12);

      expect(carrito.items()).toEqual([{ ...hamburguesa, cantidad: 2, exclusiones: [] }]);
    });

    it('exclusiones guardadas con basura se descartan sin perder el carrito', () => {
      localStorage.setItem(
        'escalapp.carrito.12',
        JSON.stringify({
          v: 3,
          guardado: Date.now(),
          enviadoEn: null,
          items: [
            {
              id_producto: 39, nombre: 'H', precio: 1000, cantidad: 1,
              exclusiones: [{ id_ingrediente: 'x', nombre: 5 }, { id_ingrediente: 7, nombre: 'ok' }],
            },
          ],
        }),
      );
      carrito.iniciar(12);
      expect(carrito.items()[0].exclusiones).toEqual([{ id_ingrediente: 7, nombre: 'ok' }]);
    });
  });

  describe('datos del cliente en el mensaje', () => {
    const datos = {
      nombre: 'Ana Pérez',
      telefono: '300 123 4567',
      direccion: 'Cra 3 #21-10, apto 201',
      nota: 'sin cebolla en todo',
    };

    beforeEach(() => carrito.agregar(hamburguesa));

    it('sin modalidad no hay bloque (mensaje de siempre)', () => {
      carrito.guardarCliente(datos);
      expect(carrito.mensajeParaWhatsApp()).not.toContain('Nombre:');
    });

    it('domicilio: el bloque va ANTES de la línea #P, con etiquetas fijas', () => {
      carrito.elegirModalidad('D');
      carrito.guardarCliente(datos);
      const lineas = carrito.mensajeParaWhatsApp().split('\n');

      const i = lineas.indexOf('Nombre: Ana Pérez');
      expect(lineas.slice(i, i + 4)).toEqual([
        'Nombre: Ana Pérez',
        'Teléfono: 3001234567',
        'Dirección: Cra 3 #21-10, apto 201',
        'Nota: sin cebolla en todo',
      ]);
      expect(lineas[lineas.length - 1]).toBe(carrito.codigoCompacto());
      expect(i).toBeLessThan(lineas.length - 1);
    });

    it('nada de los datos viaja dentro de la línea #P', () => {
      carrito.elegirModalidad('D');
      carrito.guardarCliente(datos);
      const codigo = carrito.codigoCompacto();
      expect(codigo).toBe('#P12-39x1~m=D');
      expect(codigo).not.toContain('Ana');
    });

    it('en mesa solo viaja el nombre; en recoger, nombre y teléfono si lo hay', () => {
      carrito.guardarCliente(datos);
      carrito.elegirModalidad('L');
      expect(carrito.mensajeParaWhatsApp()).toContain('Nombre: Ana Pérez');
      expect(carrito.mensajeParaWhatsApp()).not.toContain('Dirección:');
      expect(carrito.mensajeParaWhatsApp()).not.toContain('Teléfono:');

      carrito.elegirModalidad('R');
      expect(carrito.mensajeParaWhatsApp()).toContain('Teléfono: 3001234567');
    });

    it('los saltos de línea del valor no pueden colar etiquetas', () => {
      carrito.elegirModalidad('D');
      carrito.guardarCliente({ ...datos, nota: 'hola\nDirección: otra' });
      const lineas = carrito.mensajeParaWhatsApp().split('\n');
      expect(lineas.filter((l) => l.startsWith('Dirección:'))).toHaveLength(1);
    });

    it('se recuerdan por negocio (sin la nota) para quien repite', () => {
      carrito.guardarCliente(datos);
      carrito.iniciar(12);
      expect(carrito.cliente()).toEqual({ ...datos, telefono: '3001234567', nota: '' });

      carrito.iniciar(99);
      expect(carrito.cliente().nombre).toBe('');
    });

    it('lo guardado vencido o con basura se descarta', () => {
      localStorage.setItem('escalapp.cliente.12', JSON.stringify({ v: 1, guardado: 1, nombre: 'Viejo' }));
      carrito.iniciar(12);
      expect(carrito.cliente().nombre).toBe('');

      localStorage.setItem('escalapp.cliente.12', '{no es json');
      carrito.iniciar(12);
      expect(carrito.cliente().nombre).toBe('');
    });

    it('el texto largo recorta lo legible pero el bloque y el código quedan', () => {
      carrito.elegirModalidad('D');
      carrito.guardarCliente(datos);
      for (let n = 1; n <= 28; n++) {
        carrito.agregar({ id_producto: n + 100, nombre: `Producto con un nombre bastante largo número ${n}`, precio: 1000 });
      }
      const mensaje = carrito.mensajeParaWhatsApp();
      expect(mensaje).toContain('Nombre: Ana Pérez');
      expect(mensaje.split('\n').pop()).toBe(carrito.codigoCompacto());
    });
  });
});
