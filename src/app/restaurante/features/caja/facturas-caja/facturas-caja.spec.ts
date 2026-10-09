import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ExternalLink, FileText, LUCIDE_ICONS, LucideIconProvider, TriangleAlert } from 'lucide-angular';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DocumentoFe, EstadoDocumentoFe, FacturacionService } from '../../../../core/services/facturacion.service';
import { RealtimeService } from '../../../../core/services/realtime.service';
import { UiFeedbackService } from '../../../../core/ui-feedback/ui-feedback.service';
import { FacturasCajaComponent, accionesDe } from './facturas-caja';

const documento = (estado: EstadoDocumentoFe, extra: Partial<DocumentoFe> = {}): DocumentoFe => ({
  id_documento: `doc-${estado}`,
  tipo: 'FV',
  estado,
  numero: estado === 'ACEPTADO' ? 'SETP990024154' : null,
  origen_referencia: 'ORD-0049',
  total: '33000.00',
  creado_en: '2026-10-08T21:30:00-05:00',
  ultimo_error: null,
  url_publica: estado === 'ACEPTADO' ? 'https://ejemplo.test/factura' : null,
  comprador: 'Consumidor Final',
  consumidor_final: true,
  numero_factura_anulada: null,
  ...extra,
});

/**
 * La pestaña «Facturas» de Caja. Lo que importa es que cada estado ofrezca lo que se puede hacer
 * con él y nada más: una factura aceptada no se reintenta, y una que espera datos no tiene PDF.
 */
describe('FacturasCajaComponent', () => {
  describe('qué se puede hacer con cada documento', () => {
    it.each<[EstadoDocumentoFe, string[]]>([
      ['ACEPTADO', ['pdf', 'ver']],
      ['ERROR', ['reintentar']],
      ['RECHAZADO', ['reintentar', 'completar']],
      ['PENDIENTE_DATOS', ['completar']],
      ['EN_COLA', []],
      ['ENVIANDO', []],
      ['ANULADO', []],
    ])('%s → %j', (estado, esperadas) => {
      expect(accionesDe(documento(estado))).toEqual(esperadas);
    });

    it('una aceptada sin enlace público solo ofrece el PDF', () => {
      expect(accionesDe(documento('ACEPTADO', { url_publica: null }))).toEqual(['pdf']);
    });
  });

  describe('en pantalla', () => {
    let api: {
      estado: ReturnType<typeof signal<{ alertas: string[] } | null>>;
      listar: ReturnType<typeof vi.fn>;
      reintentar: ReturnType<typeof vi.fn>;
      completarComprador: ReturnType<typeof vi.fn>;
      pdf: ReturnType<typeof vi.fn>;
    };
    let alCambiar: ReturnType<typeof vi.fn>;

    function montar(documentos: DocumentoFe[]) {
      api.listar.mockReturnValue(of(documentos));
      const fixture = TestBed.createComponent(FacturasCajaComponent);
      fixture.componentRef.setInput('idNegocio', 17);
      fixture.detectChanges();
      return { fixture, el: fixture.nativeElement as HTMLElement };
    }

    beforeEach(() => {
      api = {
        estado: signal<{ alertas: string[] } | null>({ alertas: [] }),
        listar: vi.fn(),
        reintentar: vi.fn(() => of({ estado: 'ACEPTADO', mensaje: 'Factura SETP1 enviada' })),
        completarComprador: vi.fn(),
        pdf: vi.fn(),
      };
      alCambiar = vi.fn(() => () => {});
      TestBed.configureTestingModule({
        imports: [FacturasCajaComponent],
        providers: [
          // En la app los iconos se registran una vez en app.config; aquí, los tres de esta pantalla.
          { provide: LUCIDE_ICONS, multi: true, useValue: new LucideIconProvider({ ExternalLink, FileText, TriangleAlert }) },
          { provide: FacturacionService, useValue: api },
          { provide: RealtimeService, useValue: { alCambiar } },
          { provide: UiFeedbackService, useValue: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } },
        ],
      });
    });

    it('pide las facturas de hoy del negocio y se suscribe a los avisos de caja', () => {
      montar([]);
      expect(api.listar).toHaveBeenCalledWith(17, expect.objectContaining({ estado: null }));
      const filtros = api.listar.mock.calls[0][1];
      expect(filtros.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(filtros.desde).toBe(filtros.hasta);
      expect(alCambiar).toHaveBeenCalledWith(['caja', 'pedidos'], expect.any(Function));
    });

    it('pinta los botones que tocan a cada estado', () => {
      const { el } = montar([
        documento('ACEPTADO'),
        documento('ERROR', { ultimo_error: 'Factus no responde; se reintentará.' }),
        documento('PENDIENTE_DATOS'),
      ]);
      const filas = Array.from(el.querySelectorAll('tbody tr')).filter((f) => !f.classList.contains('fc__fila-detalle'));
      const botones = filas.map((f) => Array.from(f.querySelectorAll('.fc__btn')).map((b) => b.textContent?.trim()));
      expect(botones[0]).toEqual(['Ver PDF', 'Ver en línea']);
      expect(botones[1]).toEqual(['Reintentar']);
      expect(botones[2]).toEqual(['Completar datos']);
      expect(el.textContent).toContain('Factus no responde');
    });

    it('«Completar datos» abre los campos del comprador', () => {
      const { fixture, el } = montar([documento('PENDIENTE_DATOS')]);
      el.querySelector<HTMLButtonElement>('.fc__btn--primario')?.click();
      fixture.detectChanges();
      expect(el.querySelector('app-datos-factura')).not.toBeNull();
      expect(el.textContent).toContain('Guardar y enviar la factura');
    });

    it('reintentar llama al servidor y vuelve a leer la lista', () => {
      const { el } = montar([documento('ERROR')]);
      el.querySelector<HTMLButtonElement>('.fc__btn--mini')?.click();
      expect(api.reintentar).toHaveBeenCalledWith(17, 'doc-ERROR');
      expect(api.listar).toHaveBeenCalledTimes(2);
    });

    it('enseña los avisos de numeración del negocio', () => {
      api.estado.set({ alertas: ['Quedan 50 números en el rango de facturas.'] });
      const { el } = montar([]);
      expect(el.textContent).toContain('Quedan 50 números');
    });
  });
});
