import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';

import { environment } from '../../../../../environments/environment';
import { AuthService } from '../../../../core/services/auth.service';

interface LimiteRecurso {
  incluidos: number | null;
  adicionales: number;
  total: number | null;
}

interface ComplementoResumen {
  codigo: string;
  nombre: string;
  amplia: 'usuarios' | 'cajas' | null;
  cantidad: number;
  cantidad_solicitada: number | null;
  precio: number;
}

interface ResumenPlan {
  complementos: ComplementoResumen[];
  total_mensual: number;
  moneda: string;
  limites: { plan: string; usuarios: LimiteRecurso; cajas: LimiteRecurso } | null;
}

/**
 * Configuración → Mi plan: qué tiene contratado el negocio y cuánto le queda de margen.
 *
 * **Aquí no se cobra nada.** La gestión del plan vive en «Mis pagos» de la consola, que es donde
 * están las facturas y las pasarelas; duplicar aquí el cobro sería mantener dos pantallas de
 * dinero que un día dirán cosas distintas. Lo que hace falta en la app del negocio es lo otro:
 * saber de un vistazo si le quedan usuarios o cajas antes de intentar crear uno, y tener a mano
 * el camino para ampliarlo.
 *
 * El enlace entra ya autenticado: pide un código de un solo uso y aterriza directo en «Mis pagos»
 * (ver `AuthService.irAlInicio`), así que el usuario no vuelve a escribir su contraseña.
 */
@Component({
  selector: 'app-mi-plan-panel',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mi-plan-panel.html',
  styleUrl: './mi-plan-panel.scss',
})
export class MiPlanPanelComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  protected readonly cargando = signal(true);
  protected readonly error = signal('');
  protected readonly resumen = signal<ResumenPlan | null>(null);

  protected readonly limites = computed(() => this.resumen()?.limites ?? null);

  /** Lo pedido y aún no pagado, para no dar por hecho algo que todavía no está activo. */
  protected readonly pendientes = computed(() =>
    (this.resumen()?.complementos ?? []).filter(
      (c) => c.cantidad_solicitada != null && c.cantidad_solicitada !== c.cantidad,
    ),
  );

  /** Solo los que de verdad tiene: la lista completa del catálogo no le dice nada aquí. */
  protected readonly contratados = computed(() =>
    (this.resumen()?.complementos ?? []).filter((c) => c.cantidad > 0),
  );

  ngOnInit(): void {
    const idNegocio = this.auth.negocio()?.id_negocio;
    if (!idNegocio) {
      this.cargando.set(false);
      return;
    }

    // Mismo apaño que `UsuariosService`: la cobranza vive en el API de admin, no en el de
    // restaurante, y el entorno solo declara la base del vertical.
    const adminApi = environment.apiUrl.replace(/\/restaurante\/?$/, '/admin');

    this.http
      .get<{ data?: ResumenPlan }>(`${adminApi}/cobranza/mi-plan`, {
        params: { id_negocio: String(idNegocio) },
      })
      .subscribe({
        next: (res) => {
          this.resumen.set(res?.data ?? null);
          this.cargando.set(false);
        },
        // Sin plan de cobro (o sin permiso para verlo) el panel simplemente no se pinta: no es un
        // fallo que el usuario tenga que entender.
        error: () => {
          this.error.set('');
          this.cargando.set(false);
        },
      });
  }

  protected dinero(valor: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: this.resumen()?.moneda || 'COP',
      maximumFractionDigits: 0,
    }).format(Number(valor ?? 0));
  }

  protected gestionar(): void {
    void this.auth.irAMisPagos();
  }
}
