import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { SidebarService } from './sidebar.service';

describe('SidebarService', () => {
  let servicio: SidebarService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    servicio = TestBed.inject(SidebarService);
  });

  it('una pantalla que pide el ancho pliega el menú y al soltarlo lo deja como estaba', () => {
    expect(servicio.colapsado()).toBe(false);

    servicio.pedir();
    expect(servicio.colapsado()).toBe(true);

    servicio.soltar();
    expect(servicio.colapsado()).toBe(false);
  });

  it('pedir/soltar no toca lo que el usuario dejó guardado', () => {
    servicio.pedir();
    servicio.soltar();

    expect(localStorage.getItem('negocio_sidebar_colapsado')).toBeNull();
  });

  it('si el usuario tenía el menú plegado, sigue plegado al salir de la pantalla', () => {
    servicio.alternar(); // el usuario lo pliega
    servicio.pedir();
    servicio.soltar();

    expect(servicio.colapsado()).toBe(true);
  });

  it('abrir el menú dentro de la pantalla vale para esa visita y se recuerda', () => {
    servicio.pedir();
    servicio.alternar(); // el usuario lo despliega estando en Pedidos
    expect(servicio.colapsado()).toBe(false);

    servicio.soltar();
    expect(servicio.colapsado()).toBe(false);
  });

  it('con dos pantallas pidiendo, no se despliega hasta que se sueltan las dos', () => {
    servicio.pedir();
    servicio.pedir(); // la nueva pide antes de que la vieja suelte
    servicio.soltar();
    expect(servicio.colapsado()).toBe(true);

    servicio.soltar();
    expect(servicio.colapsado()).toBe(false);
  });
});
