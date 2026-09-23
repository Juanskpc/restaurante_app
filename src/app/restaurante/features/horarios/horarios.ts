import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { forkJoin } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth.service';
import { CatalogoCacheService } from '../../../core/services/catalogo-cache.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';

/**
 * Franja de un día. `uid` es de cliente, no viaja al backend — igual que en `reserva_app`
 * (misma pantalla, mismo motivo): identificar la franja por posición se rompe en cuanto dos
 * franjas del mismo día tienen las mismas horas.
 */
interface BloqueDia {
  uid: number;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
}

interface Horario {
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const LABORABLES = [1, 2, 3, 4, 5];

let contadorUid = 1;

/**
 * Horarios del restaurante: el de apertura del negocio, y el de cada domiciliario.
 *
 * Misma pantalla que ya existe en `reserva_app` (franjas semanales, día + hora inicio + hora
 * fin, reemplazables completas), pero en tabla y API propias de `restaurante` — no se comparte
 * la tabla entre verticales (ADR-005, ver `migrate_restaurante_horario.js`). Sin los bloqueos
 * puntuales de `reserva_app`: no se pidieron aquí, y un restaurante que cierra un día concreto
 * puede simplemente no abrir la caja ese día.
 *
 * ## Los dos usos de la misma pantalla
 *
 * - **Horario del negocio** (selector en "Todo el negocio"): decide si el asistente de
 *   WhatsApp dice que está cerrado al querer tomar un pedido.
 * - **Horario de un domiciliario**: decide a quién asigna el asistente un pedido a domicilio
 *   cuando hay más de uno — al que esté en turno ahora mismo.
 *
 * Un negocio que no carga nada aquí no pierde nada: sin horario del negocio, el asistente
 * sigue funcionando siempre; sin horarios de domiciliarios, la asignación sigue siendo al azar.
 */
@Component({
  selector: 'app-horarios',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './horarios.html',
  styleUrl: './horarios.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HorariosComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly catalogo = inject(CatalogoCacheService);
  private readonly uiFeedback = inject(UiFeedbackService);

  readonly domiciliarios = signal<Array<{ id_usuario: number; nombre: string }>>([]);
  // null = horario del negocio; id = el de ese domiciliario.
  readonly usuarioSeleccionado = signal<number | null>(null);
  readonly bloques = signal<BloqueDia[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly sucio = signal(false);

  readonly puedeEditar = computed(() => this.auth.canAccessRoute('/horarios'));

  readonly diasSemana = DIAS;

  readonly bloquesPorDia = computed(() => {
    const map = new Map<number, BloqueDia[]>();
    for (let d = 0; d < 7; d++) map.set(d, []);
    for (const b of this.bloques()) map.get(b.dia_semana)!.push(b);
    for (const arr of map.values()) arr.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
    return map;
  });

  readonly diasAbiertos = computed(() =>
    [...this.bloquesPorDia().values()].filter((arr) => arr.length > 0).length,
  );

  readonly horasSemanales = computed(() => {
    const min = this.bloques().reduce((acc, b) => {
      const d = this.minutosEntre(b.hora_inicio, b.hora_fin);
      return d > 0 ? acc + d : acc;
    }, 0);
    return Math.round((min / 60) * 10) / 10;
  });

  readonly erroresPorDia = computed(() => {
    const errores = new Map<number, string>();
    for (const [dia, arr] of this.bloquesPorDia()) {
      const invalida = arr.find((b) => this.minutosEntre(b.hora_inicio, b.hora_fin) <= 0);
      if (invalida) { errores.set(dia, 'La hora de fin debe ser posterior a la de inicio.'); continue; }
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].hora_inicio < arr[i - 1].hora_fin) {
          errores.set(dia, 'Hay franjas que se solapan.');
          break;
        }
      }
    }
    return errores;
  });

  readonly hayErrores = computed(() => this.erroresPorDia().size > 0);

  readonly nombreTarget = computed(() => {
    const id = this.usuarioSeleccionado();
    if (id == null) return 'el negocio';
    return this.domiciliarios().find((d) => d.id_usuario === id)?.nombre ?? 'este domiciliario';
  });

  ngOnInit(): void {
    const idNegocio = this.auth.negocio()?.id_negocio;
    if (!idNegocio) return;
    this.cargando.set(true);
    forkJoin({
      doms: this.catalogo.domiciliarios(idNegocio),
    }).subscribe({
      next: ({ doms }) => {
        this.domiciliarios.set(
          (doms ?? []).map((d) => ({ id_usuario: d.id_usuario, nombre: d.nombre })),
        );
        this.cargarHorario();
      },
      error: () => { this.uiFeedback.error('No se pudo cargar.'); this.cargando.set(false); },
    });
  }

  cargarHorario(): void {
    const idNegocio = this.auth.negocio()?.id_negocio;
    if (!idNegocio) return;
    this.cargando.set(true);

    const idUsuario = this.usuarioSeleccionado();
    const params: Record<string, string> = { id_negocio: String(idNegocio) };
    // '' explícito para "el negocio": sin esto, omitir el parámetro y mandar 'null' se leen
    // igual en el backend, pero aquí conviene ser explícito con lo que se pide.
    if (idUsuario != null) params['id_usuario'] = String(idUsuario);

    this.http.get<{ success: boolean; data: Horario[] }>(`${environment.apiUrl}/horarios`, { params })
      .subscribe({
        next: (r) => {
          this.bloques.set((r?.data ?? []).map((h) => ({
            uid: contadorUid++,
            dia_semana: h.dia_semana,
            hora_inicio: this.normalizarHora(h.hora_inicio),
            hora_fin: this.normalizarHora(h.hora_fin),
          })));
          this.sucio.set(false);
          this.cargando.set(false);
        },
        error: () => { this.uiFeedback.error('No se pudo cargar el horario.'); this.cargando.set(false); },
      });
  }

  cambiarTarget(idRaw: string): void {
    this.usuarioSeleccionado.set(idRaw === '' ? null : Number(idRaw));
    this.cargarHorario();
  }

  // ── Edición de franjas ──

  abrirDia(dia: number): void {
    this.bloques.update((arr) => [
      ...arr,
      { uid: contadorUid++, dia_semana: dia, hora_inicio: '08:00', hora_fin: '12:00' },
      { uid: contadorUid++, dia_semana: dia, hora_inicio: '14:00', hora_fin: '20:00' },
    ]);
    this.sucio.set(true);
  }

  cerrarDia(dia: number): void {
    this.bloques.update((arr) => arr.filter((b) => b.dia_semana !== dia));
    this.sucio.set(true);
  }

  alternarDia(dia: number): void {
    if ((this.bloquesPorDia().get(dia)?.length ?? 0) > 0) this.cerrarDia(dia);
    else this.abrirDia(dia);
  }

  agregarFranja(dia: number): void {
    const existentes = this.bloquesPorDia().get(dia) ?? [];
    const ultima = existentes[existentes.length - 1];
    const inicio = ultima ? ultima.hora_fin : '08:00';
    this.bloques.update((arr) => [
      ...arr,
      { uid: contadorUid++, dia_semana: dia, hora_inicio: inicio, hora_fin: this.sumarHoras(inicio, 2) },
    ]);
    this.sucio.set(true);
  }

  eliminarFranja(uid: number): void {
    this.bloques.update((arr) => arr.filter((b) => b.uid !== uid));
    this.sucio.set(true);
  }

  actualizarHora(uid: number, campo: 'hora_inicio' | 'hora_fin', valor: string): void {
    if (!valor) return;
    this.bloques.update((arr) => arr.map((b) => (b.uid === uid ? { ...b, [campo]: valor } : b)));
    this.sucio.set(true);
  }

  /** Copia la jornada de `dia` al resto (a todos, o solo a lunes–viernes). */
  copiarDia(dia: number, destino: 'todos' | 'laborables'): void {
    const origen = this.bloquesPorDia().get(dia) ?? [];
    if (origen.length === 0) {
      this.uiFeedback.warning('Ese día está cerrado: no hay nada que copiar.');
      return;
    }
    const objetivo = (destino === 'todos' ? [0, 1, 2, 3, 4, 5, 6] : LABORABLES).filter((d) => d !== dia);

    this.bloques.update((arr) => [
      ...arr.filter((b) => !objetivo.includes(b.dia_semana)),
      ...objetivo.flatMap((d) => origen.map((b) => ({
        uid: contadorUid++, dia_semana: d, hora_inicio: b.hora_inicio, hora_fin: b.hora_fin,
      }))),
    ]);
    this.sucio.set(true);
  }

  guardar(): void {
    const idNegocio = this.auth.negocio()?.id_negocio;
    if (!idNegocio) return;

    const errores = this.erroresPorDia();
    if (errores.size > 0) {
      const [dia, msg] = [...errores.entries()][0];
      this.uiFeedback.error(`${DIAS[dia]}: ${msg}`);
      return;
    }

    this.guardando.set(true);
    this.http.put<{ success: boolean; message?: string }>(`${environment.apiUrl}/horarios`, {
      id_negocio: idNegocio,
      id_usuario: this.usuarioSeleccionado(),
      bloques: this.bloques().map(({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin })),
    }).subscribe({
      next: (r) => {
        this.guardando.set(false);
        if (r?.success) {
          this.uiFeedback.success('Horario guardado.');
          this.sucio.set(false);
        } else {
          this.uiFeedback.error(r?.message || 'No se pudo guardar.');
        }
      },
      error: (e) => {
        this.guardando.set(false);
        this.uiFeedback.error(e?.error?.message || 'Error al guardar.');
      },
    });
  }

  horasDelDia(dia: number): string {
    const min = (this.bloquesPorDia().get(dia) ?? []).reduce((acc, b) => {
      const d = this.minutosEntre(b.hora_inicio, b.hora_fin);
      return d > 0 ? acc + d : acc;
    }, 0);
    if (min === 0) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} m`;
  }

  // ── Helpers ──

  private minutosEntre(inicio: string, fin: string): number {
    const [hi, mi] = inicio.split(':').map(Number);
    const [hf, mf] = fin.split(':').map(Number);
    return (hf * 60 + mf) - (hi * 60 + mi);
  }

  private sumarHoras(hora: string, horas: number): string {
    const [h, m] = hora.split(':').map(Number);
    const total = Math.min(23 * 60 + 59, h * 60 + m + horas * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  private normalizarHora(h: string): string {
    return h.length >= 5 ? h.slice(0, 5) : h;
  }
}
