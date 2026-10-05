import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/** Gestos que el navegador acepta como «el usuario está aquí» para dejar sonar el audio. */
const GESTOS_DE_DESBLOQUEO = ['pointerdown', 'keydown', 'touchstart'] as const;

/**
 * SonidoAlertaService — los avisos sonoros del negocio.
 *
 * Son dos, y suenan distinto a propósito: `sonarNuevoPedido` (un pedido entró por el asistente) y
 * `sonarConversacionEscalada` (el asistente no supo responder y hay alguien esperando). Quien
 * añada un tercero tiene el mismo deber: que se distinga sin mirar la pantalla.
 *
 * ## Por qué se sintetiza y no se carga un `.mp3`
 *
 * Un tono de dos o tres notas se genera con Web Audio en unas líneas: no hay archivo que servir, ni que
 * cachear, ni derechos que revisar, y no puede fallar por una ruta mal apuntada en el despliegue
 * (esta app se sirve bajo `/restaurante/`). Cuesta lo mismo que un recurso y falla menos.
 *
 * ## La política de autoplay del navegador, que es lo que de verdad puede fallar
 *
 * Un navegador no deja sonar nada hasta que el usuario haya tocado la página. Como aquí el aviso
 * llega por un canal en vivo, sin ningún clic detrás, hay que **desbloquear el audio con el primer
 * gesto** (cualquier clic o tecla, que en una app de caja es cuestión de segundos). Si la pestaña
 * se recarga y nadie toca nada antes de que llegue el pedido, ese primer aviso NO suena: no hay
 * manera de saltarse esa regla, y es preferible saberlo a prometer lo contrario.
 *
 * Todo es no-op en el servidor (SSR) y nunca lanza: un sonido que no puede sonar no puede tumbar la
 * pantalla.
 */
@Injectable({ providedIn: 'root' })
export class SonidoAlertaService {
  private readonly esNavegador = isPlatformBrowser(inject(PLATFORM_ID));
  private contexto: AudioContext | null = null;

  constructor() {
    if (!this.esNavegador) return;
    for (const gesto of GESTOS_DE_DESBLOQUEO) {
      window.addEventListener(gesto, this.desbloquear, { passive: true });
    }
  }

  /** Dos notas ascendentes, cortas y claras: se oye por encima del ruido de una cocina. */
  sonarNuevoPedido(): void {
    if (!this.esNavegador) return;
    try {
      const contexto = this.obtenerContexto();
      if (!contexto) return;
      // Suspendido = todavía nadie ha tocado la página: no suena, y no hay nada más que hacer.
      if (contexto.state === 'suspended') void contexto.resume();

      const inicio = contexto.currentTime + 0.02;
      this.nota(contexto, 880, inicio, 0.16);
      this.nota(contexto, 1174.66, inicio + 0.17, 0.26);
    } catch {
      // Sin audio disponible: se pierde el sonido, no la pantalla.
    }
  }

  /**
   * Tres golpes graves y descendentes, con timbre de triángulo: el aviso de que una conversación
   * se quedó esperando a una persona.
   *
   * **Tiene que no parecerse al de un pedido**, y por eso se diferencia en las tres cosas que el
   * oído distingue sin mirar la pantalla: el contorno (baja en vez de subir), la cuenta (tres en
   * vez de dos) y el timbre (triángulo, más áspero que el seno). Con solo cambiar las notas, en
   * una cocina con ruido los dos avisos acaban siendo «un pitido» y hay que ir a ver cuál fue —
   * que es exactamente lo que este sonido existe para evitar.
   */
  sonarConversacionEscalada(): void {
    if (!this.esNavegador) return;
    try {
      const contexto = this.obtenerContexto();
      if (!contexto) return;
      if (contexto.state === 'suspended') void contexto.resume();

      const inicio = contexto.currentTime + 0.02;
      // Sol4 → Re4 → Sol3: el salto final de octava es lo que lo vuelve inconfundible.
      this.nota(contexto, 392, inicio, 0.14, 'triangle');
      this.nota(contexto, 293.66, inicio + 0.16, 0.14, 'triangle');
      this.nota(contexto, 196, inicio + 0.32, 0.34, 'triangle');
    } catch {
      // Sin audio disponible: se pierde el sonido, no la pantalla.
    }
  }

  private readonly desbloquear = (): void => {
    try {
      const contexto = this.obtenerContexto();
      if (contexto?.state === 'suspended') void contexto.resume();
      // Con el audio ya listo, los oyentes sobran: no se vuelve a hacer nada por cada clic.
      if (contexto?.state === 'running') {
        for (const gesto of GESTOS_DE_DESBLOQUEO) window.removeEventListener(gesto, this.desbloquear);
      }
    } catch {
      // Ídem.
    }
  };

  private obtenerContexto(): AudioContext | null {
    if (this.contexto) return this.contexto;
    const Constructor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;
    this.contexto = new Constructor();
    return this.contexto;
  }

  /** Una nota con ataque y caída suaves: sin ellas cada nota termina con un «clic» seco. */
  private nota(
    contexto: AudioContext,
    frecuencia: number,
    inicio: number,
    duracion: number,
    timbre: OscillatorType = 'sine',
  ): void {
    const oscilador = contexto.createOscillator();
    const volumen = contexto.createGain();

    oscilador.type = timbre;
    oscilador.frequency.value = frecuencia;

    volumen.gain.setValueAtTime(0.0001, inicio);
    volumen.gain.exponentialRampToValueAtTime(0.28, inicio + 0.02);
    volumen.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);

    oscilador.connect(volumen).connect(contexto.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + duracion + 0.02);
  }
}
