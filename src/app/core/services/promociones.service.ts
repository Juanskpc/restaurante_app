import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../environments/environment';

/** Cómo se reparte la clientela. Los códigos los fija el backend (`app_core/promociones/segmentos`). */
export type CodigoSegmento =
  | 'en_riesgo'
  | 'dormido'
  | 'ocasional'
  | 'intermedio'
  | 'frecuente'
  | 'sin_actividad';

export interface Segmento {
  codigo: CodigoSegmento;
  nombre: string;
  descripcion: string;
  /** Para qué sirve mandarle a este grupo, escrito para el dueño. */
  recomendado_para: string;
  orden: number;
  recomendado: boolean;
  personas: number;
  /** Cuántos de ellos recibirían la promoción hoy. Es la cifra que manda. */
  contactables: number;
  alto_valor: number;
  ticket_medio: number;
}

export interface ResumenAudiencia {
  personas: number;
  con_telefono: number;
  contactables: number;
  de_baja: number;
  bloqueados: number;
  sin_telefono: number;
}

export interface Audiencia {
  resumen: ResumenAudiencia;
  vertical: string;
  /** Cómo se llama el hecho en este vertical: pedido / cita. */
  etiqueta: { uno: string; varios: string };
  umbrales: Record<string, number>;
  segmentos: Segmento[];
}

export type MotivoExclusion = 'pidio_baja' | 'bloqueo_whatsapp' | 'sin_telefono' | null;

export interface Destinatario {
  id_persona_negocio: string;
  cliente: string;
  telefono: string | null;
  eventos: number;
  ultimo_evento: string | null;
  dias_desde_ultimo: number | null;
  valor_total: number;
  segmento: CodigoSegmento;
  alto_valor: boolean;
  contactable: boolean;
  motivo_exclusion: MotivoExclusion;
}

export interface CostoPais {
  indicativo: string | null;
  pais: string | null;
  destinatarios: number;
  precio_unitario_usd: number | null;
  costo_usd: number;
  /** `false` = no tenemos la tarifa de ese país publicada. No se estima. */
  confirmada: boolean;
  /** Meta no entrega plantillas de marketing a ese país. */
  sin_entrega: boolean;
}

export interface Simulacion {
  destinatarios: number;
  enviables: number;
  sin_entrega: number;
  sin_tarifa_confirmada: number;
  meta: {
    costo_usd: number;
    costo_estimado_local: number | null;
    moneda: string;
    por_pais: CostoPais[];
    vigencia_tarifa: string;
    fx_referencia: { fecha: string; COP: number };
    lo_cobra: string;
  };
  escalapp: {
    creditos: number;
    /** Lo que costaría en EscalApp. `null` si no hay precio en la moneda del negocio. */
    precio_local: number | null;
    precio_unitario_local?: number | null;
    /** `false` mientras solo se muestra y no se descuenta. */
    se_cobra?: boolean;
    nota: string;
  };
  retorno: {
    ticket_medio: number;
    margen_usado: number;
    margen_por_pedido: number;
    pedidos_para_empatar: number | null;
    base: string;
  };
  asistente: {
    conversaciones_esperadas: number;
    mensajes_estimados: number;
    tasa_respuesta_supuesta: number;
    medida: boolean;
    cupo: { usados: number; techo: number; restantes: number; alcanza: boolean } | null;
  };
}

/** Una plantilla de promoción, con el estado que tiene en la WABA de ESTE negocio. */
export interface PlantillaPromo {
  nombre: string;
  idioma: string;
  necesita_imagen: boolean;
  /** 'NO_CREADA' | 'PENDIENTE' | 'APPROVED' | 'REJECTED' | … */
  estado: string;
  motivo_rechazo: string | null;
  /** Lo único que decide si se puede enviar con ella. */
  usable: boolean;
  cuerpo: string | null;
  pie: string | null;
  botones: { tipo: string; texto: string }[];
  parametros: string[];
}

/** Un motivo por el que no se puede enviar (o un aviso, si `bloquea` es falso). */
export interface MotivoGate {
  code: string;
  mensaje: string;
  bloquea: boolean;
  dato?: unknown;
}

export interface Elegibilidad {
  puede: boolean;
  motivos: MotivoGate[];
  avisos: MotivoGate[];
  numero: {
    telefono: string | null;
    calidad: string | null;
    tier: number | null;
    tier_texto: string | null;
    ilimitado: boolean;
  };
  plantillas: PlantillaPromo[];
  prueba: { hecha: boolean; entregada?: boolean; estado?: string; codigo_error?: string | null };
  horario: { min: number; max: number; dentro: boolean };
}

export type EstadoCampana =
  | 'BORRADOR'
  | 'PENDIENTE_PLANTILLA'
  | 'LISTA'
  | 'PROGRAMADA'
  | 'ENVIANDO'
  | 'PAUSADA'
  | 'ENVIADA'
  | 'CANCELADA'
  | 'FALLIDA';

export interface Campana {
  id_campana: string;
  nombre: string;
  estado: EstadoCampana;
  plantilla: string;
  parametros?: Record<string, string>;
  imagen_url?: string | null;
  destinatarios: number;
  programada_para: string | null;
  enviando_desde: string | null;
  terminada_en: string | null;
  creado_en: string;
  costo_usd?: string | null;
  encolados?: number;
  leidos?: number;
  prueba_en?: string | null;
}

export interface InformeCampana {
  campana: Campana;
  envio: {
    destinatarios: number;
    encolados: number;
    omitidos: number;
    pendientes: number;
    salieron: number;
    leidos: number;
    fallidos: number;
    creditos_cobrados: number;
    creditos_devueltos: number;
  };
  omisiones: { motivo: string; n: number }[];
  errores: { codigo: string | null; n: number }[];
  retorno: {
    respondieron: number;
    pidieron: number;
    recuperados: number;
    venta_atribuida: number;
    ventana_dias: number;
  } | null;
}

/**
 * Promociones — audiencia, segmentos y simulador (F1); plantillas, campañas y envío (F2).
 *
 * ## Por qué apunta al API de admin y no al del vertical
 *
 * El módulo es transversal: la misma pantalla servirá a reserva cambiando el adaptador de hechos
 * del backend. Así que las rutas viven en `app_admin_api`, igual que la cobranza y que
 * `/usuarios/admin/*` (que es lo que usa la vista «Personal»).
 *
 * El `replace` es el mismo apaño que ya hacen `UsuariosService` y `mi-plan-panel`: el entorno solo
 * declara la base del vertical. Está en tres sitios y conviene que siga siendo visible: el día que
 * el entorno declare las dos bases, se quita de los tres.
 */
@Injectable({ providedIn: 'root' })
export class PromocionesService {
  private readonly http = inject(HttpClient);

  private readonly api = environment.apiUrl.replace(/\/restaurante\/?$/, '/admin');

  /** ¿Tiene sentido esta pantalla para este negocio? Hoy lo decide el vertical. */
  disponible(idNegocio: number): Observable<{ disponible: boolean; vertical: string | null }> {
    return this.http
      .get<{ data?: { disponible: boolean; vertical: string | null } }>(
        `${this.api}/promociones/disponible`,
        { params: new HttpParams().set('id_negocio', String(idNegocio)) },
      )
      .pipe(map((r) => r?.data ?? { disponible: false, vertical: null }));
  }

  audiencia(idNegocio: number): Observable<Audiencia> {
    return this.http
      .get<{ data?: Audiencia }>(`${this.api}/promociones/audiencia`, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(map((r) => r!.data!));
  }

  /**
   * Los clientes de unos segmentos.
   *
   * `soloContactables = false` devuelve además a los que quedan fuera, **con el motivo**: es la
   * vista que explica por qué «812 clientes» no son «812 mensajes».
   */
  destinatarios(opciones: {
    idNegocio: number;
    segmentos?: CodigoSegmento[];
    busqueda?: string;
    soloContactables?: boolean;
    limite?: number;
    offset?: number;
  }): Observable<{ total: number; destinatarios: Destinatario[] }> {
    let params = new HttpParams().set('id_negocio', String(opciones.idNegocio));
    if (opciones.segmentos?.length) params = params.set('segmentos', opciones.segmentos.join(','));
    if (opciones.busqueda) params = params.set('q', opciones.busqueda);
    if (opciones.soloContactables === false) params = params.set('solo_contactables', 'false');
    if (opciones.limite) params = params.set('limite', String(opciones.limite));
    if (opciones.offset) params = params.set('offset', String(opciones.offset));

    return this.http
      .get<{ data?: { total: number; destinatarios: Destinatario[] } }>(
        `${this.api}/promociones/destinatarios`,
        { params },
      )
      .pipe(map((r) => r?.data ?? { total: 0, destinatarios: [] }));
  }

  /**
   * Qué costaría mandarle a esta selección.
   *
   * Es un POST porque la selección a mano puede traer cientos de ids, que no caben en una URL. No
   * escribe nada: se puede llamar en cada clic.
   */
  simular(opciones: {
    idNegocio: number;
    segmentos?: CodigoSegmento[];
    personas?: string[];
    margen?: number;
  }): Observable<Simulacion> {
    return this.http
      .post<{ data?: Simulacion }>(`${this.api}/promociones/simular`, {
        id_negocio: opciones.idNegocio,
        segmentos: opciones.segmentos ?? undefined,
        personas: opciones.personas ?? undefined,
        margen: opciones.margen ?? undefined,
      })
      .pipe(map((r) => r!.data!));
  }

  /** Saca a un cliente de las promociones. Para el que lo pide en el mostrador o por teléfono. */
  baja(idNegocio: number, idPersonaNegocio: string, nota?: string): Observable<unknown> {
    return this.http.post(`${this.api}/promociones/clientes/${idPersonaNegocio}/baja`, {
      id_negocio: idNegocio,
      nota: nota ?? null,
    });
  }

  /** Deshace la baja: el error del cajero, o el cliente que cambia de idea. */
  readmitir(idNegocio: number, idPersonaNegocio: string): Observable<unknown> {
    return this.http.post(`${this.api}/promociones/clientes/${idPersonaNegocio}/readmitir`, {
      id_negocio: idNegocio,
    });
  }

  // ── F2: plantillas, campañas y envío ──────────────────────────────────────────────────

  /** En qué estado están las plantillas de este negocio en SU cuenta de WhatsApp. */
  plantillas(idNegocio: number): Observable<PlantillaPromo[]> {
    return this.http
      .get<{ data?: { plantillas: PlantillaPromo[] } }>(`${this.api}/promociones/plantillas`, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(map((r) => r?.data?.plantillas ?? []));
  }

  /**
   * Pide a Meta las plantillas que falten.
   *
   * `imagenUrl` es para la que lleva encabezado de imagen: Meta exige una imagen de ejemplo para
   * revisarla, así que sin ninguna subida esa queda fuera y solo se crea la de texto.
   */
  asegurarPlantillas(idNegocio: number, imagenUrl?: string | null): Observable<PlantillaPromo[]> {
    return this.http
      .post<{ data?: { plantillas: PlantillaPromo[] } }>(
        `${this.api}/promociones/plantillas/asegurar`,
        { id_negocio: idNegocio, imagen_url: imagenUrl ?? null },
      )
      .pipe(map((r) => r?.data?.plantillas ?? []));
  }

  /** Vuelve a preguntarle a Meta si ya las aprobó. */
  sincronizarPlantillas(idNegocio: number): Observable<PlantillaPromo[]> {
    return this.http
      .post<{ data?: { plantillas: PlantillaPromo[] } }>(
        `${this.api}/promociones/plantillas/sincronizar`,
        { id_negocio: idNegocio },
      )
      .pipe(map((r) => r?.data?.plantillas ?? []));
  }

  /** La compuerta: qué falta para poder enviar. La pantalla y la API miran esta misma respuesta. */
  elegibilidad(
    idNegocio: number,
    opciones: { idCampana?: string; destinatarios?: number } = {},
  ): Observable<Elegibilidad> {
    let params = new HttpParams().set('id_negocio', String(idNegocio));
    if (opciones.idCampana) params = params.set('id_campana', opciones.idCampana);
    if (opciones.destinatarios != null) {
      params = params.set('destinatarios', String(opciones.destinatarios));
    }
    return this.http
      .get<{ data?: Elegibilidad }>(`${this.api}/promociones/elegibilidad`, { params })
      .pipe(map((r) => r!.data!));
  }

  /** Sube la imagen de la promoción. Devuelve la URL ABSOLUTA, que es la que descarga Meta. */
  subirImagen(idNegocio: number, archivo: File): Observable<{ url: string; recomendacion: string }> {
    const cuerpo = new FormData();
    cuerpo.append('imagen', archivo);
    return this.http
      .post<{ data?: { url: string; recomendacion: string } }>(
        `${this.api}/promociones/${idNegocio}/imagen`,
        cuerpo,
      )
      .pipe(map((r) => r!.data!));
  }

  /** Arma la campaña y congela su lista. No envía nada. */
  crearCampana(opciones: {
    idNegocio: number;
    nombre: string;
    plantilla: string;
    oferta: string;
    imagenUrl?: string | null;
    segmentos?: CodigoSegmento[];
    personas?: string[];
    margen?: number;
  }): Observable<Campana> {
    return this.http
      .post<{ data?: Campana }>(`${this.api}/promociones/campanas`, {
        id_negocio: opciones.idNegocio,
        nombre: opciones.nombre,
        plantilla: opciones.plantilla,
        parametros: { oferta: opciones.oferta },
        imagen_url: opciones.imagenUrl ?? null,
        segmentos: opciones.segmentos ?? undefined,
        personas: opciones.personas ?? undefined,
        margen: opciones.margen ?? undefined,
      })
      .pipe(map((r) => r!.data!));
  }

  /**
   * El mensaje real a un WhatsApp de verdad. Sin que llegue, no se puede enviar.
   *
   * El teléfono va explícito porque el número del negocio es **el que envía**, y WhatsApp no se
   * manda mensajes a sí mismo: la prueba tiene que llegar a otro móvil.
   */
  prueba(idNegocio: number, idCampana: string, telefono: string): Observable<{ telefono: string }> {
    return this.http
      .post<{ data?: { telefono: string } }>(
        `${this.api}/promociones/campanas/${idCampana}/prueba`,
        { id_negocio: idNegocio, telefono },
      )
      .pipe(map((r) => r!.data!));
  }

  /** Da la orden. El envío lo hace el despachador con ritmo, no esta petición. */
  enviarCampana(
    idNegocio: number,
    idCampana: string,
    programadaPara?: string | null,
  ): Observable<Campana> {
    return this.http
      .post<{ data?: Campana }>(`${this.api}/promociones/campanas/${idCampana}/enviar`, {
        id_negocio: idNegocio,
        programada_para: programadaPara ?? null,
      })
      .pipe(map((r) => r!.data!));
  }

  pausarCampana(idNegocio: number, idCampana: string, motivo?: string): Observable<unknown> {
    return this.http.post(`${this.api}/promociones/campanas/${idCampana}/pausar`, {
      id_negocio: idNegocio,
      motivo: motivo ?? null,
    });
  }

  cancelarCampana(idNegocio: number, idCampana: string): Observable<unknown> {
    return this.http.post(`${this.api}/promociones/campanas/${idCampana}/cancelar`, {
      id_negocio: idNegocio,
    });
  }

  campanas(idNegocio: number): Observable<Campana[]> {
    return this.http
      .get<{ data?: { campanas: Campana[] } }>(`${this.api}/promociones/campanas`, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(map((r) => r?.data?.campanas ?? []));
  }

  /** El informe, que es el producto. */
  informe(idNegocio: number, idCampana: string): Observable<InformeCampana> {
    return this.http
      .get<{ data?: InformeCampana }>(`${this.api}/promociones/campanas/${idCampana}`, {
        params: new HttpParams().set('id_negocio', String(idNegocio)),
      })
      .pipe(map((r) => r!.data!));
  }
}
