import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal,
} from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
import {
  Audiencia, Campana, CodigoSegmento, Destinatario, Elegibilidad, EstadoCampana, InformeCampana,
  PlantillaPromo, PromocionesService, Segmento, Simulacion,
} from '../../core/services/promociones.service';
import { UiFeedbackService } from '../../core/ui-feedback/ui-feedback.service';

/** Cuántos clientes se piden de una vez. La clientela de un restaurante son cientos, no miles. */
const LIMITE_LISTA = 500;

/**
 * Los pasos, en el orden en que se recorren.
 *
 * `audiencia` → `mensaje` → `enviar`, y `historial` aparte. No es un asistente que encierre: se
 * puede volver atrás, porque lo normal es armar la audiencia, ver el costo, y entonces decidir qué
 * se dice.
 */
type Paso = 'audiencia' | 'mensaje' | 'enviar' | 'historial';

/**
 * Promociones — a quién le puedes escribir y cuánto costaría (F1).
 *
 * ## Qué resuelve esta pantalla, con las palabras del dueño
 *
 * > «Quiero sacar una promoción de 2 hamburguesas por $20.000, será para todos. Pero como tengo
 * > clientes activos, a estos no necesito enviarles mensaje, sino a los clientes no frecuentes
 * > para recuperar esta clientela.»
 *
 * O sea que el valor no está en poder mandarle a todos: está en **poder no mandarle al que ya
 * viene**. Por eso lo primero que se ve no es un botón de enviar, son los segmentos con su conteo,
 * y «Frecuentes» aparece marcado como el grupo al que normalmente NO hay que escribirle.
 *
 * ## Todavía no envía, y se dice en la primera línea
 *
 * F1 cuenta, segmenta y simula. El envío es F2 y el precio por crédito es F3. Una pantalla que
 * pareciera capaz de enviar y no lo hiciera sería peor que no tenerla, así que el aviso va arriba y
 * no hay ningún botón que insinúe otra cosa.
 *
 * ## Las tres cifras que tiene que dejar claras
 *
 *   1. **A cuántos se puede escribir de verdad**, que casi nunca es «todos mis clientes».
 *   2. **Qué cobra Meta y qué cobramos nosotros**, por separado y dicho quién cobra cada cosa: el
 *      cargo de Meta va a la tarjeta del negocio, no a su factura de EscalApp.
 *   3. **Cuántos pedidos tiene que traer para empatar**, calculado con el MARGEN y no con la venta
 *      (ver `simulador.js`: con la venta la cifra sale inflada y la primera campaña lo desmiente).
 */
@Component({
  selector: 'app-promociones',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, DecimalPipe, TitleCasePipe, LucideAngularModule],
  templateUrl: './promociones.html',
  styleUrl: './promociones.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromocionesComponent implements OnInit {
  private readonly promociones = inject(PromocionesService);
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiFeedbackService);

  readonly cargando = signal(true);
  readonly error = signal('');
  readonly audiencia = signal<Audiencia | null>(null);

  readonly cargandoLista = signal(false);
  readonly destinatarios = signal<Destinatario[]>([]);
  readonly totalLista = signal(0);
  readonly busqueda = signal('');

  /** Los segmentos elegidos. Vacío = todavía no hay nada que simular. */
  readonly seleccionados = signal<Set<CodigoSegmento>>(new Set());

  /**
   * Clientes quitados a mano de la selección.
   *
   * Se guarda a quién se **excluye** y no a quién se incluye: así, al cambiar de segmento, la
   * selección sigue siendo «todo el segmento menos estos» sin tener que rehacerla.
   */
  readonly quitados = signal<Set<string>>(new Set());

  /** Mostrar también a los que NO van a recibir nada, con su motivo. */
  readonly verExcluidos = signal(false);

  readonly simulacion = signal<Simulacion | null>(null);
  readonly simulando = signal(false);

  /** Margen bruto con el que se calcula el punto de equilibrio. Lo mueve el dueño. */
  readonly margen = signal(30);

  readonly resumen = computed(() => this.audiencia()?.resumen ?? null);
  readonly etiqueta = computed(() => this.audiencia()?.etiqueta ?? { uno: 'pedido', varios: 'pedidos' });

  readonly segmentos = computed<Segmento[]>(() =>
    [...(this.audiencia()?.segmentos ?? [])].sort((a, b) => a.orden - b.orden),
  );

  /** Lo que de verdad se enviaría: los contactables de los segmentos elegidos, menos los quitados. */
  readonly totalSeleccionado = computed(() => {
    const elegidos = this.seleccionados();
    const base = this.segmentos()
      .filter((s) => elegidos.has(s.codigo))
      .reduce((n, s) => n + s.contactables, 0);
    return Math.max(0, base - this.quitados().size);
  });

  readonly hayAlgoElegido = computed(() => this.seleccionados().size > 0);

  /** La lista que se pinta: con el filtro de búsqueda aplicado aquí, sin ir al servidor. */
  readonly listaVisible = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const digitos = q.replace(/\D/g, '');
    const lista = this.destinatarios();
    if (!q) return lista;
    return lista.filter(
      (d) =>
        d.cliente.toLowerCase().includes(q) ||
        (digitos && (d.telefono ?? '').includes(digitos)),
    );
  });

  ngOnInit(): void {
    this.cargarAudiencia();
  }

  /** El negocio activo, igual que en el resto de las vistas. */
  private readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);

  private get idNegocio(): number | null {
    return this.negocioId();
  }

  cargarAudiencia(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) {
      this.cargando.set(false);
      this.error.set('No hay un negocio activo.');
      return;
    }

    this.cargando.set(true);
    this.promociones.audiencia(idNegocio).subscribe({
      next: (datos) => {
        this.audiencia.set(datos);
        this.error.set('');
        this.cargando.set(false);
        // Arranca con los segmentos recomendados ya marcados: es la respuesta a «¿a quién le
        // mando?» para quien abre esto por primera vez, y se puede deshacer con un clic.
        const recomendados = datos.segmentos
          .filter((s) => s.recomendado && s.contactables > 0)
          .map((s) => s.codigo);
        if (recomendados.length) {
          this.seleccionados.set(new Set(recomendados));
          this.cargarDestinatarios();
          this.simular();
        }
      },
      error: (e) => {
        this.cargando.set(false);
        this.error.set(e?.error?.message || 'No se pudo cargar la audiencia.');
      },
    });
  }

  alternarSegmento(codigo: CodigoSegmento): void {
    const actual = new Set(this.seleccionados());
    if (actual.has(codigo)) actual.delete(codigo);
    else actual.add(codigo);
    this.seleccionados.set(actual);
    // Al cambiar de grupo, los quitados a mano del grupo anterior dejan de tener sentido.
    this.quitados.set(new Set());
    this.cargarDestinatarios();
    this.simular();
  }

  alternarVerExcluidos(): void {
    this.verExcluidos.update((v) => !v);
    this.cargarDestinatarios();
  }

  cargarDestinatarios(): void {
    const idNegocio = this.idNegocio;
    const elegidos = [...this.seleccionados()];
    if (!idNegocio || !elegidos.length) {
      this.destinatarios.set([]);
      this.totalLista.set(0);
      return;
    }

    this.cargandoLista.set(true);
    this.promociones
      .destinatarios({
        idNegocio,
        segmentos: elegidos,
        soloContactables: !this.verExcluidos(),
        limite: LIMITE_LISTA,
      })
      .subscribe({
        next: (datos) => {
          this.destinatarios.set(datos.destinatarios);
          this.totalLista.set(datos.total);
          this.cargandoLista.set(false);
        },
        error: () => {
          this.cargandoLista.set(false);
          this.ui.error('No se pudo cargar la lista de clientes.');
        },
      });
  }

  /** Quita o devuelve un cliente a la selección de ESTA campaña (no es una baja). */
  alternarQuitado(d: Destinatario): void {
    const actual = new Set(this.quitados());
    if (actual.has(d.id_persona_negocio)) actual.delete(d.id_persona_negocio);
    else actual.add(d.id_persona_negocio);
    this.quitados.set(actual);
    this.simular();
  }

  estaQuitado(d: Destinatario): boolean {
    return this.quitados().has(d.id_persona_negocio);
  }

  simular(): void {
    const idNegocio = this.idNegocio;
    const elegidos = [...this.seleccionados()];
    if (!idNegocio || !elegidos.length) {
      this.simulacion.set(null);
      return;
    }

    // Con clientes quitados a mano se mandan los ids; si no, basta con los segmentos — y así el
    // servidor vuelve a resolver quién es contactable en ese momento.
    const quitados = this.quitados();
    const personas = quitados.size
      ? this.destinatarios()
          .filter((d) => d.contactable && !quitados.has(d.id_persona_negocio))
          .map((d) => d.id_persona_negocio)
      : undefined;

    this.simulando.set(true);
    this.promociones
      .simular({
        idNegocio,
        segmentos: personas ? undefined : (elegidos as CodigoSegmento[]),
        personas,
        margen: this.margen() / 100,
      })
      .subscribe({
        next: (s) => {
          this.simulacion.set(s);
          this.simulando.set(false);
        },
        error: (e) => {
          this.simulando.set(false);
          this.simulacion.set(null);
          // 422 con PROMOS_SIN_DESTINATARIOS es normal: el dueño quitó a todo el mundo.
          if (e?.status !== 422) this.ui.error('No se pudo calcular el costo.');
        },
      });
  }

  cambiarMargen(valor: string | number): void {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 1 || n > 100) return;
    this.margen.set(Math.round(n));
    this.simular();
  }

  /**
   * La baja de verdad: este cliente no vuelve a recibir promociones de este negocio.
   *
   * Es para quien lo pide en el mostrador o por teléfono. No se confunde con quitarlo de la
   * selección de una campaña: eso es `alternarQuitado`, y por eso están en botones distintos con
   * palabras distintas.
   */
  darDeBaja(d: Destinatario): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    this.promociones.baja(idNegocio, d.id_persona_negocio).subscribe({
      next: () => {
        this.ui.success(`${d.cliente} no volverá a recibir promociones.`, 'Baja registrada');
        this.cargarAudiencia();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo registrar la baja.'),
    });
  }

  /** Deshace la baja. */
  readmitir(d: Destinatario): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;

    this.promociones.readmitir(idNegocio, d.id_persona_negocio).subscribe({
      next: () => {
        this.ui.success(`${d.cliente} vuelve a recibir promociones.`);
        this.cargarAudiencia();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo readmitir al cliente.'),
    });
  }

  /** El texto del motivo por el que alguien no recibe nada. */
  motivo(d: Destinatario): string {
    switch (d.motivo_exclusion) {
      case 'pidio_baja':
        return 'Pidió no recibir promociones';
      case 'bloqueo_whatsapp':
        return 'Se dio de baja de todo el WhatsApp';
      case 'sin_telefono':
        return 'No tiene teléfono registrado';
      default:
        return '';
    }
  }

  /** «hace 3 días» / «hace 2 meses». El dueño piensa en eso, no en fechas. */
  haceCuanto(dias: number | null): string {
    if (dias === null || dias === undefined) return 'nunca';
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 30) return `hace ${dias} días`;
    const meses = Math.round(dias / 30);
    return meses <= 1 ? 'hace un mes' : `hace ${meses} meses`;
  }

  nombreSegmento(codigo: CodigoSegmento): string {
    return this.segmentos().find((s) => s.codigo === codigo)?.nombre ?? codigo;
  }

  // ── F2: el mensaje, el envío y el historial ───────────────────────────────────────────

  readonly paso = signal<Paso>('audiencia');

  readonly plantillas = signal<PlantillaPromo[]>([]);
  readonly plantillaElegida = signal<string | null>(null);
  readonly preparandoPlantillas = signal(false);

  readonly oferta = signal('');
  readonly nombreCampana = signal('');
  readonly imagenUrl = signal<string | null>(null);
  readonly subiendoImagen = signal(false);

  readonly gate = signal<Elegibilidad | null>(null);
  readonly campana = signal<Campana | null>(null);
  readonly preparando = signal(false);
  readonly probando = signal(false);
  /**
   * A qué móvil llega la prueba.
   *
   * Se pregunta y no se deduce: el número del negocio es el que ENVÍA, y WhatsApp no se manda
   * mensajes a sí mismo, así que la prueba tiene que llegar al móvil de quien la va a mirar.
   */
  readonly telefonoPrueba = signal('');
  readonly enviando = signal(false);

  readonly historial = signal<Campana[]>([]);
  readonly informe = signal<InformeCampana | null>(null);

  /** La plantilla que se va a usar, con su texto y su estado. */
  readonly plantilla = computed(
    () => this.plantillas().find((p) => p.nombre === this.plantillaElegida()) ?? null,
  );

  readonly hayPlantillaUsable = computed(() => this.plantillas().some((p) => p.usable));

  /**
   * La vista previa: el cuerpo aprobado con los huecos rellenos.
   *
   * Se compone aquí con el texto que devuelve el servidor —y no con una copia escrita en el
   * frontend— para que lo que el dueño ve sea **exactamente** lo que Meta aprobó. Una vista previa
   * que se parece pero no es igual es peor que no tener vista previa.
   */
  readonly vistaPrevia = computed(() => {
    const p = this.plantilla();
    if (!p?.cuerpo) return '';
    const valores: Record<string, string> = {
      cliente: 'Ana',
      negocio: this.auth.negocio()?.nombre ?? 'tu negocio',
      oferta: this.oferta() || '(aquí va tu promoción)',
    };
    return p.parametros.reduce(
      (texto, clave, i) => texto.replaceAll(`{{${i + 1}}}`, valores[clave] ?? ''),
      p.cuerpo,
    );
  });

  /** ¿Se puede pasar al paso de enviar? */
  readonly mensajeListo = computed(
    () =>
      Boolean(this.plantillaElegida())
      && this.oferta().trim().length >= 3
      && (!this.plantilla()?.necesita_imagen || Boolean(this.imagenUrl())),
  );

  irA(paso: Paso): void {
    this.paso.set(paso);
    if (paso === 'mensaje' && this.plantillas().length === 0) this.cargarPlantillas();
    if (paso === 'enviar') this.cargarGate();
    if (paso === 'historial') this.cargarHistorial();
  }

  cargarPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.plantillas(idNegocio).subscribe({
      next: (lista) => {
        this.plantillas.set(lista);
        // Se preselecciona la primera usable: lo normal es que haya una sola, y obligar a elegir
        // entre «texto» e «imagen» antes de saber qué es cada una no ayuda a nadie.
        const usable = lista.find((p) => p.usable);
        if (usable && !this.plantillaElegida()) this.plantillaElegida.set(usable.nombre);
      },
      error: () => this.ui.error('No se pudieron leer las plantillas.'),
    });
  }

  /**
   * Le pide a Meta las plantillas que falten.
   *
   * Conviene hacerlo con tiempo: Meta tarda de minutos a 24 horas en revisarlas, y hasta que
   * apruebe no se puede enviar nada.
   */
  prepararPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.preparandoPlantillas.set(true);
    this.promociones.asegurarPlantillas(idNegocio, this.imagenUrl()).subscribe({
      next: (lista) => {
        this.plantillas.set(lista);
        this.preparandoPlantillas.set(false);
        this.ui.success(
          lista.some((p) => p.usable)
            ? 'Ya tienes una plantilla aprobada.'
            : 'Pedido a WhatsApp. Suele tardar unos minutos; vuelve a comprobar en un rato.',
          'Plantillas',
        );
      },
      error: (e) => {
        this.preparandoPlantillas.set(false);
        this.ui.error(e?.error?.message || 'No se pudieron pedir las plantillas.');
      },
    });
  }

  comprobarPlantillas(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.preparandoPlantillas.set(true);
    this.promociones.sincronizarPlantillas(idNegocio).subscribe({
      next: (lista) => {
        this.plantillas.set(lista);
        this.preparandoPlantillas.set(false);
        const usable = lista.find((p) => p.usable);
        if (usable && !this.plantillaElegida()) this.plantillaElegida.set(usable.nombre);
      },
      error: () => {
        this.preparandoPlantillas.set(false);
        this.ui.error('No se pudo consultar el estado en WhatsApp.');
      },
    });
  }

  subirImagen(evento: Event): void {
    const idNegocio = this.idNegocio;
    const input = evento.target as HTMLInputElement;
    const archivo = input.files?.[0];
    if (!idNegocio || !archivo) return;

    this.subiendoImagen.set(true);
    this.promociones.subirImagen(idNegocio, archivo).subscribe({
      next: ({ url }) => {
        this.imagenUrl.set(url);
        this.subiendoImagen.set(false);
      },
      error: (e) => {
        this.subiendoImagen.set(false);
        this.ui.error(e?.error?.message || 'No se pudo subir la imagen.');
      },
    });
  }

  quitarImagen(): void {
    this.imagenUrl.set(null);
  }

  cargarGate(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones
      .elegibilidad(idNegocio, {
        idCampana: this.campana()?.id_campana,
        destinatarios: this.totalSeleccionado(),
      })
      .subscribe({
        next: (g) => this.gate.set(g),
        error: () => this.ui.error('No se pudo comprobar si se puede enviar.'),
      });
  }

  /** Arma la campaña: congela la lista y deja el costo guardado. Todavía no manda nada. */
  prepararCampana(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio || !this.mensajeListo()) return;

    const quitados = this.quitados();
    const personas = quitados.size
      ? this.destinatarios()
          .filter((d) => d.contactable && !quitados.has(d.id_persona_negocio))
          .map((d) => d.id_persona_negocio)
      : undefined;

    this.preparando.set(true);
    this.promociones
      .crearCampana({
        idNegocio,
        nombre: this.nombreCampana().trim() || this.oferta().slice(0, 60),
        plantilla: this.plantillaElegida()!,
        oferta: this.oferta().trim(),
        imagenUrl: this.imagenUrl(),
        segmentos: personas ? undefined : ([...this.seleccionados()] as CodigoSegmento[]),
        personas,
        margen: this.margen() / 100,
      })
      .subscribe({
        next: (c) => {
          this.campana.set(c);
          this.preparando.set(false);
          this.paso.set('enviar');
          this.cargarGate();
        },
        error: (e) => {
          this.preparando.set(false);
          this.ui.error(e?.error?.message || 'No se pudo preparar la promoción.');
        },
      });
  }

  mandarPrueba(): void {
    const idNegocio = this.idNegocio;
    const c = this.campana();
    if (!idNegocio || !c) return;

    // Se exige aquí y no solo en el servidor para no gastar una petición en lo que ya se sabe: sin
    // número no hay prueba, y el número es de quien la va a mirar en su móvil.
    const telefono = this.telefonoPrueba().trim();
    if (telefono.replace(/D/g, '').length < 7) {
      this.ui.error('Escribe el WhatsApp al que quieres que llegue la prueba.');
      return;
    }

    this.probando.set(true);
    this.promociones.prueba(idNegocio, c.id_campana, telefono).subscribe({
      next: ({ telefono }) => {
        this.probando.set(false);
        this.ui.success(
          `Mandamos la promoción al ${telefono}. Míralo en tu WhatsApp antes de enviársela a los clientes.`,
          'Prueba enviada',
        );
        // La compuerta cambia en cuanto el acuse de Meta llega, así que se vuelve a mirar.
        setTimeout(() => this.cargarGate(), 4000);
      },
      error: (e) => {
        this.probando.set(false);
        this.ui.error(e?.error?.message || 'No se pudo mandar la prueba.');
      },
    });
  }

  enviar(programada: string | null = null): void {
    const idNegocio = this.idNegocio;
    const c = this.campana();
    if (!idNegocio || !c) return;

    this.enviando.set(true);
    this.promociones.enviarCampana(idNegocio, c.id_campana, programada).subscribe({
      next: (actualizada) => {
        this.campana.set(actualizada);
        this.enviando.set(false);
        this.ui.success(
          programada
            ? 'Queda programada. Se enviará sola a la hora que elegiste.'
            : 'En marcha. Se van mandando poco a poco; puedes seguirlo en el historial.',
          'Promoción enviada',
        );
        this.paso.set('historial');
        this.cargarHistorial();
      },
      error: (e) => {
        this.enviando.set(false);
        this.ui.error(e?.error?.message || 'No se pudo enviar.');
      },
    });
  }

  cargarHistorial(): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.campanas(idNegocio).subscribe({
      next: (lista) => this.historial.set(lista),
      error: () => this.ui.error('No se pudo leer el historial.'),
    });
  }

  verInforme(c: Campana): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.informe(idNegocio, c.id_campana).subscribe({
      next: (i) => this.informe.set(i),
      error: () => this.ui.error('No se pudo leer el informe.'),
    });
  }

  cerrarInforme(): void {
    this.informe.set(null);
  }

  pausar(c: Campana): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.pausarCampana(idNegocio, c.id_campana, 'Pausada por el negocio').subscribe({
      next: () => {
        this.ui.success('Pausada. Lo que ya salió no se puede deshacer.');
        this.cargarHistorial();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo pausar.'),
    });
  }

  cancelar(c: Campana): void {
    const idNegocio = this.idNegocio;
    if (!idNegocio) return;
    this.promociones.cancelarCampana(idNegocio, c.id_campana).subscribe({
      next: () => {
        this.ui.success('Cancelada. Lo que quedaba por mandar ya no sale.');
        this.cargarHistorial();
      },
      error: (e) => this.ui.error(e?.error?.message || 'No se pudo cancelar.'),
    });
  }

  /** Para el historial: en qué estado está, dicho como lo diría una persona. */
  estadoLegible(estado: EstadoCampana): string {
    return {
      BORRADOR: 'Sin terminar',
      PENDIENTE_PLANTILLA: 'Esperando a WhatsApp',
      LISTA: 'Lista para enviar',
      PROGRAMADA: 'Programada',
      ENVIANDO: 'Enviando',
      PAUSADA: 'Pausada',
      ENVIADA: 'Enviada',
      CANCELADA: 'Cancelada',
      FALLIDA: 'Falló',
    }[estado] ?? estado;
  }

  /** El motivo de una omisión, en palabras. */
  motivoOmision(codigo: string): string {
    return {
      se_dio_de_baja: 'Pidió no recibir promociones',
      bloqueo_whatsapp: 'Bloqueó el WhatsApp del negocio',
      campana_cancelada: 'Se canceló la promoción antes de llegarle',
    }[codigo] ?? codigo;
  }

  /** Lo que significa un código de error de Meta, que es lo que dice si hay que hacer algo. */
  errorDeMeta(codigo: string | null): string {
    if (!codigo) return 'No se pudo entregar';
    return {
      '131049': 'WhatsApp limitó la publicidad que recibe esa persona (no es culpa del negocio)',
      '131042': 'La cuenta de WhatsApp del negocio no tiene método de pago',
      '131026': 'Ese número no tiene WhatsApp',
      '132001': 'La plantilla no existe en la cuenta de WhatsApp',
    }[codigo] ?? `Error ${codigo}`;
  }
}
