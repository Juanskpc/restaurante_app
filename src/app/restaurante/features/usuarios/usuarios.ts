import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { UsuariosService } from './usuarios.service';
import {
  EstadoRegistro,
  PermisoModulo,
  RolAdminOption,
  UsuarioAdmin,
  UsuarioAdminPayload,
  UsuarioPermisosDetalle,
} from './usuarios.models';

@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule, DatePipe, NgClass, TitleCasePipe],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsuariosComponent {
  private readonly fb = inject(FormBuilder);
  private readonly usuariosService = inject(UsuariosService);

  protected readonly activeTab = signal<'usuarios' | 'roles'>('usuarios');
  protected readonly loading = signal(false);
  protected readonly loadingPermisos = signal(false);
  protected readonly loadingDetalleUsuario = signal(false);
  protected readonly saving = signal(false);
  protected readonly showFormModal = signal(false);
  protected readonly showPermisosUsuarioModal = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly usuarios = signal<UsuarioAdmin[]>([]);
  protected readonly roles = signal<RolAdminOption[]>([]);
  protected readonly roleFilter = signal<number | null>(null);
  protected readonly estadoFilter = signal<EstadoRegistro | 'ALL'>('ALL');
  protected readonly searchTerm = signal('');

  protected readonly selectedRoleId = signal<number | null>(null);
  protected readonly permisosRol = signal<PermisoModulo[]>([]);

  protected readonly selectedUsuarioPermisos = signal<UsuarioPermisosDetalle | null>(null);

  protected readonly userForm = this.fb.nonNullable.group({
    id_usuario: [0],
    primer_nombre: ['', [Validators.required, Validators.maxLength(100)]],
    segundo_nombre: [''],
    primer_apellido: ['', [Validators.required, Validators.maxLength(100)]],
    segundo_apellido: [''],
    num_identificacion: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.minLength(8)]],
    confirmPassword: [''],
    id_rol: [0, [Validators.required, Validators.min(1)]],
    estado: ['A' as EstadoRegistro, [Validators.required]],
    es_admin_principal: [false],
  });

  protected readonly isEditing = computed(() => this.userForm.controls.id_usuario.value > 0);

  protected readonly usuariosFiltrados = computed(() => {
    const rol = this.roleFilter();
    const estado = this.estadoFilter();
    const term = this.searchTerm().trim().toLowerCase();

    return this.usuarios().filter((u) => {
      const matchRol = rol ? u.roles.some((r) => r.id_rol === rol) : true;
      const matchEstado = estado === 'ALL' ? true : u.estado === estado;
      const matchSearch = !term
        ? true
        : `${u.nombre_completo} ${u.email} ${u.num_identificacion}`.toLowerCase().includes(term);

      return matchRol && matchEstado && matchSearch;
    });
  });

  constructor() {
    this.loadInitialData();
  }

  protected changeTab(tab: 'usuarios' | 'roles'): void {
    this.activeTab.set(tab);

    if (tab === 'roles' && !this.selectedRoleId() && this.roles().length > 0) {
      const firstRole = this.roles()[0];
      this.selectedRoleId.set(firstRole.id_rol);
      this.loadPermisosRol(firstRole.id_rol);
    }
  }

  protected loadInitialData(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.usuariosService.getRoles().subscribe({
      next: (roles) => {
        this.roles.set(roles);

        if (roles.length > 0 && !this.selectedRoleId()) {
          this.selectedRoleId.set(roles[0].id_rol);
        }

        this.loadUsuarios();
      },
      error: (error) => {
        this.loading.set(false);
        this.errorMessage.set(this.extractError(error, 'No fue posible cargar la informacion.'));
      },
    });
  }

  protected loadUsuarios(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.usuariosService.getUsuarios().pipe(
      finalize(() => this.loading.set(false)),
    ).subscribe({
      next: (usuarios) => {
        this.usuarios.set(usuarios);

        const selected = this.selectedRoleId();
        if (selected) {
          this.loadPermisosRol(selected);
        }
      },
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible cargar usuarios.'));
      },
    });
  }

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
  }

  protected onRoleFilter(value: string): void {
    this.roleFilter.set(value ? Number(value) : null);
  }

  protected onEstadoFilter(value: string): void {
    this.estadoFilter.set((value || 'ALL') as EstadoRegistro | 'ALL');
  }

  protected onRoleSelected(value: string): void {
    const roleId = Number(value);
    if (!roleId) return;

    this.selectedRoleId.set(roleId);
    this.loadPermisosRol(roleId);
  }

  protected openCreateModal(): void {
    this.userForm.reset({
      id_usuario: 0,
      primer_nombre: '',
      segundo_nombre: '',
      primer_apellido: '',
      segundo_apellido: '',
      num_identificacion: '',
      email: '',
      password: '',
      confirmPassword: '',
      id_rol: this.roles()[0]?.id_rol ?? 0,
      estado: 'A',
      es_admin_principal: false,
    });

    this.showFormModal.set(true);
  }

  protected openEditModal(usuario: UsuarioAdmin): void {
    this.userForm.reset({
      id_usuario: usuario.id_usuario,
      primer_nombre: usuario.primer_nombre,
      segundo_nombre: usuario.segundo_nombre ?? '',
      primer_apellido: usuario.primer_apellido,
      segundo_apellido: usuario.segundo_apellido ?? '',
      num_identificacion: usuario.num_identificacion,
      email: usuario.email,
      password: '',
      confirmPassword: '',
      id_rol: usuario.rol_principal?.id_rol ?? this.roles()[0]?.id_rol ?? 0,
      estado: usuario.estado,
      es_admin_principal: usuario.es_admin_principal,
    });

    this.showFormModal.set(true);
  }

  protected closeFormModal(): void {
    this.showFormModal.set(false);
    this.userForm.markAsPristine();
  }

  protected submitUserForm(): void {
    this.userForm.markAllAsTouched();
    if (this.userForm.invalid) return;

    const formValue = this.userForm.getRawValue();
    const isCreate = formValue.id_usuario === 0;

    if (isCreate && !formValue.password) {
      this.errorMessage.set('La contrasena es obligatoria para crear un usuario.');
      return;
    }

    if (formValue.password || formValue.confirmPassword) {
      if (formValue.password !== formValue.confirmPassword) {
        this.errorMessage.set('La contrasena y su confirmacion no coinciden.');
        return;
      }
    }

    const payload: UsuarioAdminPayload = {
      primer_nombre: formValue.primer_nombre.trim(),
      segundo_nombre: formValue.segundo_nombre?.trim() || null,
      primer_apellido: formValue.primer_apellido.trim(),
      segundo_apellido: formValue.segundo_apellido?.trim() || null,
      num_identificacion: formValue.num_identificacion.trim(),
      email: formValue.email.trim().toLowerCase(),
      id_rol: Number(formValue.id_rol),
      estado: formValue.estado,
      es_admin_principal: Boolean(formValue.es_admin_principal),
    };

    if (formValue.password) {
      payload.password = formValue.password;
    }

    this.saving.set(true);
    this.errorMessage.set(null);

    const request$ = isCreate
      ? this.usuariosService.createUsuario(payload)
      : this.usuariosService.updateUsuario(formValue.id_usuario, payload);

    request$.pipe(
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.closeFormModal();
        this.loadUsuarios();
      },
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible guardar el usuario.'));
      },
    });
  }

  protected toggleEstado(usuario: UsuarioAdmin): void {
    const estadoNuevo: EstadoRegistro = usuario.estado === 'A' ? 'I' : 'A';

    this.usuariosService.setEstadoUsuario(usuario.id_usuario, estadoNuevo).subscribe({
      next: () => this.loadUsuarios(),
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible actualizar el estado del usuario.'));
      },
    });
  }

  protected deleteUsuario(usuario: UsuarioAdmin): void {
    const confirmed = window.confirm(`Seguro que deseas eliminar a ${usuario.nombre_completo}?`);
    if (!confirmed) return;

    this.usuariosService.deleteUsuario(usuario.id_usuario).subscribe({
      next: () => this.loadUsuarios(),
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible eliminar el usuario.'));
      },
    });
  }

  protected loadPermisosRol(idRol: number): void {
    this.loadingPermisos.set(true);

    this.usuariosService.getPermisosRol(idRol).pipe(
      finalize(() => this.loadingPermisos.set(false)),
    ).subscribe({
      next: (matriz) => {
        this.permisosRol.set(matriz.modulos);
      },
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible cargar la matriz de permisos.'));
      },
    });
  }

  protected updatePermiso(index: number, key: keyof PermisoModulo, checked: boolean): void {
    this.permisosRol.update((rows) => rows.map((row, i) => i === index ? { ...row, [key]: checked } : row));
  }

  protected savePermisosRol(): void {
    const idRol = this.selectedRoleId();
    if (!idRol) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    this.usuariosService.savePermisosRol(idRol, this.permisosRol()).pipe(
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.loadPermisosRol(idRol);
      },
      error: (error) => {
        this.errorMessage.set(this.extractError(error, 'No fue posible guardar permisos del rol.'));
      },
    });
  }

  protected verPermisosUsuario(usuario: UsuarioAdmin): void {
    this.loadingDetalleUsuario.set(true);
    this.showPermisosUsuarioModal.set(true);

    this.usuariosService.getPermisosUsuario(usuario.id_usuario).pipe(
      finalize(() => this.loadingDetalleUsuario.set(false)),
    ).subscribe({
      next: (detalle) => {
        this.selectedUsuarioPermisos.set(detalle);
      },
      error: (error) => {
        this.showPermisosUsuarioModal.set(false);
        this.selectedUsuarioPermisos.set(null);
        this.errorMessage.set(this.extractError(error, 'No fue posible consultar los permisos del usuario.'));
      },
    });
  }

  protected closePermisosUsuarioModal(): void {
    this.showPermisosUsuarioModal.set(false);
    this.selectedUsuarioPermisos.set(null);
  }

  protected rolDescripcion(usuario: UsuarioAdmin): string {
    return usuario.rol_principal?.descripcion ?? 'Sin rol';
  }

  protected estadoLabel(estado: EstadoRegistro): string {
    return estado === 'A' ? 'Activo' : 'Inactivo';
  }

  private extractError(error: unknown, fallback: string): string {
    const httpError = error as HttpErrorResponse;
    return httpError?.error?.message || fallback;
  }
}
