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
});
