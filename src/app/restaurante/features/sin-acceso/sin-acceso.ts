import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';

type AccessIssueCode =
  | 'SIN_SESION'
  | 'SIN_NEGOCIO_ACTIVO'
  | 'SIN_PERMISOS_VISTA'
  | 'RUTA_SIN_PERMISO'
  | 'SIN_RUTA_DISPONIBLE';

interface AccessIssueInfo {
  motivo: AccessIssueCode;
  ruta: string;
  permisosCargados: boolean;
  permisosVista: number;
  totalNegocios: number;
  negocio: string;
}

@Component({
  selector: 'app-sin-acceso',
  templateUrl: './sin-acceso.html',
  styleUrl: './sin-acceso.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SinAccesoComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly revalidando = signal(false);

  readonly issueInfo = toSignal(
    this.route.queryParamMap.pipe(
      map((params): AccessIssueInfo => ({
        motivo: (params.get('motivo') as AccessIssueCode) || 'SIN_RUTA_DISPONIBLE',
        ruta: params.get('ruta') || '/',
        permisosCargados: params.get('permisos_cargados') === '1',
        permisosVista: Number(params.get('permisos_vista') || 0),
        totalNegocios: Number(params.get('total_negocios') || this.auth.negocios().length || 0),
        negocio: params.get('negocio') || '',
      })),
    ),
    {
      initialValue: {
        motivo: 'SIN_RUTA_DISPONIBLE',
        ruta: '/',
        permisosCargados: this.auth.session()?.permisos_cargados === true,
        permisosVista: this.getPermisosVistaActivosCount(),
        totalNegocios: this.auth.negocios().length,
        negocio: this.auth.negocio()?.id_negocio ? String(this.auth.negocio()?.id_negocio) : '',
      },
    },
  );

  readonly firstAccessibleRoute = computed(() => this.auth.getFirstAccessibleRoute());

  readonly issueLabel = computed(() => {
    const reason = this.issueInfo().motivo;

    if (reason === 'SIN_SESION') return 'Sesion no disponible';
    if (reason === 'SIN_NEGOCIO_ACTIVO') return 'Negocio activo no disponible';
    if (reason === 'SIN_PERMISOS_VISTA') return 'Sin permisos de vista';
    if (reason === 'RUTA_SIN_PERMISO') return 'Ruta no autorizada';
    return 'No hay modulo accesible';
  });

  readonly issueDescription = computed(() => {
    const reason = this.issueInfo().motivo;

    if (reason === 'SIN_SESION') {
      return 'No se encontro una sesion valida para entrar al modulo de restaurante.';
    }

    if (reason === 'SIN_NEGOCIO_ACTIVO') {
      return 'La sesion no tiene un negocio activo para cargar la informacion del modulo.';
    }

    if (reason === 'SIN_PERMISOS_VISTA') {
      return 'Tu sesion cargo permisos, pero no tiene ningun modulo habilitado para visualizar.';
    }

    if (reason === 'RUTA_SIN_PERMISO') {
      return 'La ruta solicitada no esta permitida para tu rol actual en este negocio.';
    }

    return 'No se encontro una ruta valida para abrir automaticamente en este contexto.';
  });

  readonly negocioActivoNombre = computed(() => this.auth.negocio()?.nombre || 'No seleccionado');
  readonly permisosCargadosTexto = computed(() => (this.auth.session()?.permisos_cargados === true ? 'Si' : 'No'));
  readonly permisosVistaActivosCount = computed(() => this.getPermisosVistaActivosCount());
  readonly totalNegocios = computed(() => this.auth.negocios().length || this.issueInfo().totalNegocios || 0);

  async revalidateSession(): Promise<void> {
    const token = this.auth.getAccessToken();
    if (!token) {
      this.auth.logout();
      return;
    }

    this.revalidando.set(true);
    const isValid = await this.auth.validateAndSetToken(token);
    this.revalidando.set(false);

    if (!isValid) {
      this.auth.logout();
      return;
    }

    const fallbackRoute = this.auth.getFirstAccessibleRoute();
    if (fallbackRoute) {
      await this.router.navigateByUrl(fallbackRoute);
      return;
    }

    await this.router.navigate(['/sin-acceso'], {
      replaceUrl: true,
      queryParams: this.buildLiveDiagnosticQuery(this.issueInfo().ruta),
    });
  }

  openFirstAccessibleRoute(): void {
    const route = this.firstAccessibleRoute();
    if (!route) return;
    void this.router.navigateByUrl(route);
  }

  goToLogin(): void {
    this.auth.logout();
  }

  private getPermisosVistaActivosCount(): number {
    return this.auth
      .permisosVistaActivos()
      .filter((permiso) => permiso?.puede_ver && permiso?.url)
      .length;
  }

  private buildLiveDiagnosticQuery(requestedPath: string): Record<string, string | number> {
    return {
      motivo: this.resolveCurrentReason(requestedPath),
      ruta: requestedPath,
      permisos_cargados: this.auth.session()?.permisos_cargados === true ? '1' : '0',
      permisos_vista: this.getPermisosVistaActivosCount(),
      total_negocios: this.auth.negocios().length,
      negocio: this.auth.negocio()?.id_negocio ?? '',
    };
  }

  private resolveCurrentReason(requestedPath: string): AccessIssueCode {
    const session = this.auth.session();
    if (!session) return 'SIN_SESION';
    if (!this.auth.negocio()) return 'SIN_NEGOCIO_ACTIVO';

    const permisosVista = this.getPermisosVistaActivosCount();
    if (session.permisos_cargados === true && permisosVista === 0) {
      return 'SIN_PERMISOS_VISTA';
    }

    if (session.permisos_cargados === true && !this.auth.canAccessRoute(requestedPath)) {
      return 'RUTA_SIN_PERMISO';
    }

    return 'SIN_RUTA_DISPONIBLE';
  }
}
