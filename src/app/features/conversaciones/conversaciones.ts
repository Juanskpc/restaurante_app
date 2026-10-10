import {
  ChangeDetectionStrategy, Component, computed, inject, signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

import { AuthService } from '../../core/services/auth.service';
import { BandejaComponent } from './bandeja/bandeja';
import { CanalWhatsappComponent } from './numero/numero';

/** La feature del plan que trae el asistente (ADR-021: se pregunta la feature, no el plan). */
const FEATURE_ASISTENTE = 'asistente_ia';

/** Qué se está mirando. No son rutas: cambiar de una a otra no recarga nada. */
type Vista = 'conversaciones' | 'numero';

/**
 * ConversacionesComponent — el asistente de WhatsApp, desde la app del negocio.
 *
 * ## Por qué esta pantalla está aquí y no en el panel
 *
 * Hasta el 2026-10-08 la Bandeja vivía en `admin_app_v21`, que es la consola SaaS. El cajero
 * recibía el aviso de «una conversación te espera» mientras trabajaba aquí, y el botón lo
 * mandaba por un código SSO de un solo uso a **otra app, en otro origen**, a contestarle a un
 * cliente. Lo hace muchas veces al día. Responder a un cliente es operación del inquilino —de
 * la misma familia que Pedidos, Despacho o Caja— y por eso vive donde vive la operación.
 *
 * El panel conserva la vista, pero **solo para super admin**: allá sirve para mirar por encima
 * de todos los inquilinos a la vez, que es un trabajo distinto y de otra persona.
 *
 * ## Las cuatro cosas que puede estar pasando
 *
 * Son excluyentes y se deciden en este orden, que no es arbitrario: cada una responde a una
 * pregunta distinta y enseñar la de más abajo cuando vale la de más arriba confunde.
 *
 *   1. **El plan no trae el asistente** → no hay nada que conectar ni que contestar. Se ofrece
 *      mejorar el plan, que es la única acción posible.
 *   2. **Lo trae pero no hay número conectado, y manda quien puede conectarlo** → la pantalla de
 *      conexión, embebida. No es otra ruta: es el mismo sitio en otro momento de su vida.
 *   3. **Lo trae, no hay número y quien mira no puede conectarlo** (un cajero) → se le dice a
 *      quién pedírselo. Enseñarle el flujo de Meta sería ofrecerle algo que su rol no termina.
 *   4. **Hay número** → las conversaciones.
 *
 * El caso 2 y el 4 comparten componente de página a propósito: desde la Bandeja se vuelve a
 * «Tu número» y al revés sin navegar, porque son dos caras de lo mismo.
 */
@Component({
  selector: 'app-conversaciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule, BandejaComponent, CanalWhatsappComponent],
  templateUrl: './conversaciones.html',
  styleUrl: './conversaciones.scss',
})
export class ConversacionesComponent {
  private readonly auth = inject(AuthService);

  readonly negocio = computed(() => this.auth.negocio());
  readonly idNegocio = computed(() => this.negocio()?.id_negocio ?? null);

  /** ¿El plan incluye el asistente? Sin esto, «no lo tienes» y «no lo has conectado» se ven igual. */
  readonly habilitado = computed(() => this.auth.tieneFeature(FEATURE_ASISTENTE));

  /**
   * ¿Puede conectar o desconectar el número?
   *
   * Es el subnivel `whatsapp_numero`, que nace encendido solo para ADMINISTRADOR. El cajero
   * contesta conversaciones pero no decide si el WhatsApp del negocio pasa por la Cloud API:
   * esa decisión tiene consecuencias (el número deja de funcionar en el móvil) y es del dueño.
   */
  readonly administra = computed(() => this.auth.canAccessSubnivel('whatsapp_numero'));

  /**
   * Si hay número conectado. `null` mientras no se sabe: la pantalla de conexión lo averigua y
   * lo cuenta por `estadoCambio`, así que esta página no hace su propia consulta para lo mismo.
   */
  readonly conectado = signal<boolean | null>(null);

  private readonly vistaElegida = signal<Vista | null>(null);

  /**
   * La vista que toca: la que se eligió a mano, o la que corresponde al estado del canal.
   *
   * Mientras `conectado()` es `null` se queda en «numero», que es la que sabe consultar el
   * estado. Es lo que evita montar la Bandeja para un negocio que resultará no tener número.
   */
  readonly vista = computed<Vista>(() => this.vistaElegida() ?? (this.conectado() ? 'conversaciones' : 'numero'));

  irA(vista: Vista): void {
    this.vistaElegida.set(vista);
  }

  /**
   * Lo que cuenta la pantalla de conexión cada vez que consulta el estado del canal.
   *
   * ⚠️ **Solo se cambia de vista cuando el estado CAMBIA de verdad.** La primera versión
   * reseteaba `vistaElegida` siempre, y eso rompía «Gestionar número»: el botón ponía la vista
   * en «numero», la pantalla de conexión se montaba, consultaba el estado, avisaba «conectado:
   * true» con ese mismo aviso, y el reset devolvía a las conversaciones antes de que diera
   * tiempo a ver nada. Desde fuera el botón no hacía absolutamente nada.
   *
   * Ahora la primera lectura solo informa. Conectar o desconectar sí mueve la vista, porque ahí
   * el cambio lo provocó la persona y quedarse donde estaba parecería que no pasó nada.
   */
  alCambiarEstadoDelCanal(evento: { idNegocio: number; conectado: boolean }): void {
    const antes = this.conectado();
    this.conectado.set(evento.conectado);

    if (antes === null) return;          // primera lectura: no se sabía nada, no se decide nada
    if (antes === evento.conectado) return;  // un refresco que dice lo mismo no mueve a nadie

    this.vistaElegida.set(null);
  }

  /** Lo que se gana con el asistente. Es el texto de venta, no una lista de funciones. */
  readonly beneficios = [
    'Un asistente que atiende tu WhatsApp y toma pedidos cuando no puedes contestar',
    'Las conversaciones que no sepa resolver te las pasa a ti, con todo el hilo',
    'Tus clientes escriben al mismo número de siempre',
  ];
}
