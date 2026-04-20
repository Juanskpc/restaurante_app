import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, NgClass, TitleCasePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { UsuariosService } from './usuarios.service';
import { AuthService } from '../../../core/services/auth.service';
import { UiFeedbackService } from '../../../core/ui-feedback/ui-feedback.service';
import {
  EstadoRegistro,
  PermisoModulo,
  RolAdminOption,
  UsuarioAdmin,
  UsuarioAdminPayload,
  UsuarioPermisosDetalle,
} from './usuarios.models';

const NAME_PATTERN = /^[\p{L}' .-]+$/u;
const IDENT_PATTERN = /^[0-9A-Za-z._-]+$/;

type UserFormControlName =
  | 'primer_nombre'
  | 'segundo_nombre'
  | 'primer_apellido'
  | 'segundo_apellido'
  | 'num_identificacion'
  | 'email'
  | 'password'
  | 'confirmPassword'
  | 'id_rol'
  | 'estado';

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
  private readonly auth = inject(AuthService);
  private readonly uiFeedback = inject(UiFeedbackService);

  protected readonly activeTab = signal<'usuarios' | 'roles'>('usuarios');
  protected readonly loading = signal(false);
  protected readonly loadingPermisos = signal(false);
  protected readonly loadingDetalleUsuario = signal(false);
  protected readonly saving = signal(false);
  protected readonly showFormModal = signal(false);
  protected readonly showPermisosUsuarioModal = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly showConfirmPassword = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly usuarios = signal<UsuarioAdmin[]>([]);
  protected readonly roles = signal<RolAdminOption[]>([]);
  protected readonly roleFilter = signal<number | null>(null);
  protected readonly estadoFilter = signal<EstadoRegistro | 'ALL'>('ALL');
  protected readonly searchTerm = signal('');

  protected readonly selectedRoleId = signal<number | null>(null);
  protected readonly permisosRol = signal<PermisoModulo[]>([]);
  protected readonly permisosSnapshot = signal('[]');

  protected readonly selectedUsuarioPermisos = signal<UsuarioPermisosDetalle | null>(null);
  protected readonly negocioId = computed(() => this.auth.negocio()?.id_negocio ?? null);
  protected readonly modulosConAccesoCount = computed(
    () => this.permisosRol().filter((modulo) => modulo.puede_ver).length
  );
  protected readonly hasPermisosPendientes = computed(
    () => this.serializePermisos(this.permisosRol()) !== this.permisosSnapshot()
  );
  protected readonly passwordMismatch = computed(() => {
    const password = this.userForm.controls.password.value;
    const confirm = this.userForm.controls.confirmPassword.value;

    if (!password && !confirm) {
      return false;
    }

    return password !== confirm;
  });

  protected readonly userForm = this.fb.nonNullable.group({
    id_usuario: [0],
    primer_nombre: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(NAME_PATTERN)]],
    segundo_nombre: ['', [Validators.maxLength(100), Validators.pattern(NAME_PATTERN)]],
    primer_apellido: ['', [Validators.required, Validators.maxLength(100), Validators.pattern(NAME_PATTERN)]],
    segundo_apellido: ['', [Validators.maxLength(100), Validators.pattern(NAME_PATTERN)]],
    num_identificacion: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(50), Validators.pattern(IDENT_PATTERN)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(255)]],
    password: ['', [Validators.minLength(8), Validators.maxLength(120)]],
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
    effect(() => {
      const idNegocio = this.negocioId();

      if (!idNegocio) {
        this.roles.set([]);
        this.usuarios.set([]);
        this.selectedRoleId.set(null);
        this.permisosRol.set([]);
        this.permisosSnapshot.set('[]');
        this.roleFilter.set(null);
        return;
      }

      this.roleFilter.set(null);
      this.loadInitialData(idNegocio);
    });
  }

  protected changeTab(tab: 'usuarios' | 'roles'): void {
    this.activeTab.set(tab);

    if (tab === 'roles' && !this.selectedRoleId() && this.roles().length > 0) {
      const firstRole = this.roles()[0];
      this.selectedRoleId.set(firstRole.id_rol);
      this.loadPermisosRol(firstRole.id_rol);
    }
  }

  protected loadInitialData(idNegocio: number): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.usuariosService.getRoles({ idNegocio }).subscribe({
      next: (roles) => {
        this.roles.set(roles);

        if (roles.length === 0) {
          this.selectedRoleId.set(null);
        } else {
          const selected = this.selectedRoleId();
          const exists = selected ? roles.some((rol) => rol.id_rol === selected) : false;
          this.selectedRoleId.set(exists ? selected : roles[0].id_rol);
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
    const idNegocio = this.negocioId();
    if (!idNegocio) {
      this.loading.set(false);
      this.usuarios.set([]);
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    this.usuariosService.getUsuarios({ idNegocio }).pipe(
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

  protected async onRoleSelected(value: string): Promise<void> {
    const roleId = Number(value);
    if (!roleId) return;
    if (roleId === this.selectedRoleId()) return;

    if (this.hasPermisosPendientes()) {
      const confirmed = await this.uiFeedback.confirm({
        title: 'Cambios sin guardar',
        message: 'Tienes cambios sin guardar para este rol. Si cambias de rol perderas el avance. ¿Deseas continuar?',
        confirmText: 'Cambiar rol',
        cancelText: 'Seguir editando',
        tone: 'warning',
      });

      if (!confirmed) return;
    }

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

    this.resetPasswordVisibility();
    this.errorMessage.set(null);
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

    this.resetPasswordVisibility();
    this.errorMessage.set(null);
    this.showFormModal.set(true);
  }

  protected closeFormModal(): void {
    this.showFormModal.set(false);
    this.userForm.markAsPristine();
    this.resetPasswordVisibility();
  }

  protected togglePasswordVisibility(): void {
    this.showPassword.update((value) => !value);
  }

  protected toggleConfirmPasswordVisibility(): void {
    this.showConfirmPassword.update((value) => !value);
  }

  protected markControlAsTouched(controlName: UserFormControlName): void {
    this.userForm.controls[controlName].markAsTouched();
  }

  protected hasControlError(controlName: UserFormControlName): boolean {
    const control = this.userForm.controls[controlName];
    const interacted = control.touched || control.dirty;
    if (!interacted) return false;

    if (controlName === 'password' && !this.isEditing() && !String(control.value || '').trim()) {
      return true;
    }

    return control.invalid;
  }

  protected controlError(controlName: UserFormControlName): string | null {
    const control = this.userForm.controls[controlName];
    const errors = control.errors;

    if (controlName === 'password' && !this.isEditing() && !String(control.value || '').trim()) {
      return 'La contrasena es obligatoria para crear el usuario.';
    }

    if (!errors) return null;

    if (errors['required']) {
      return 'Este campo es obligatorio.';
    }

    if (errors['email']) {
      return 'Ingresa un correo electronico valido.';
    }

    if (errors['minlength']) {
      return `Debe tener al menos ${errors['minlength'].requiredLength} caracteres.`;
    }

    if (errors['maxlength']) {
      return `Debe tener maximo ${errors['maxlength'].requiredLength} caracteres.`;
    }

    if (errors['min']) {
      return 'Selecciona un rol valido.';
    }

    if (errors['pattern']) {
      if (controlName === 'num_identificacion') {
        return 'Usa solo letras, numeros, punto, guion o guion bajo.';
      }

      return 'Formato invalido para este campo.';
    }

    return 'Valor invalido.';
  }

  protected shouldShowPasswordMismatch(): boolean {
    if (!this.passwordMismatch()) return false;

    return this.userForm.controls.password.touched
      || this.userForm.controls.confirmPassword.touched;
  }

  protected submitUserForm(): void {
    this.userForm.markAllAsTouched();
    const formValue = this.userForm.getRawValue();
    const isCreate = formValue.id_usuario === 0;

    if (this.userForm.invalid || (isCreate && !String(formValue.password || '').trim())) {
      this.errorMessage.set('Revisa los campos del formulario antes de guardar.');
      return;
    }

    if (formValue.password || formValue.confirmPassword) {
      if (formValue.password !== formValue.confirmPassword) {
        this.userForm.controls.confirmPassword.markAsTouched();
        this.errorMessage.set('La contrasena y su confirmacion no coinciden.');
        return;
      }
    }

    const idNegocio = this.negocioId();
    if (!idNegocio) {
      this.errorMessage.set('No se encontro un negocio activo para asignar el usuario.');
      return;
    }

    const payload: UsuarioAdminPayload = {
      primer_nombre: formValue.primer_nombre.trim(),
      segundo_nombre: formValue.segundo_nombre?.trim() || null,
      primer_apellido: formValue.primer_apellido.trim(),
      segundo_apellido: formValue.segundo_apellido?.trim() || null,
      num_identificacion: formValue.num_identificacion.trim(),
      email: formValue.email.trim().toLowerCase(),
      id_rol: Number(formValue.id_rol),
      id_negocio: idNegocio,
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
        if (isCreate) {
          this.uiFeedback.created('Usuario creado correctamente.');
        } else {
          this.uiFeedback.updated('Los datos del usuario fueron actualizados.');
        }
        this.closeFormModal();
        this.loadUsuarios();
      },
      error: (error) => {
        this.handleError(error, 'No fue posible guardar el usuario.');
      },
    });
  }

  protected async toggleEstado(usuario: UsuarioAdmin): Promise<void> {
    const estadoNuevo: EstadoRegistro = usuario.estado === 'A' ? 'I' : 'A';

    const confirmed = await this.uiFeedback.confirm({
      title: estadoNuevo === 'I' ? 'Inactivar usuario' : 'Activar usuario',
      message: estadoNuevo === 'I'
        ? `Se inactivara a ${usuario.nombre_completo}. ¿Deseas continuar?`
        : `Se activara a ${usuario.nombre_completo}. ¿Deseas continuar?`,
      confirmText: estadoNuevo === 'I' ? 'Inactivar' : 'Activar',
      cancelText: 'Cancelar',
      tone: estadoNuevo === 'I' ? 'warning' : 'info',
    });

    if (!confirmed) return;

    this.usuariosService.setEstadoUsuario(usuario.id_usuario, estadoNuevo).subscribe({
      next: () => {
        if (estadoNuevo === 'I') {
          this.uiFeedback.inactivated('El usuario fue inactivado correctamente.');
        } else {
          this.uiFeedback.activated('El usuario fue activado correctamente.');
        }
        this.loadUsuarios();
      },
      error: (error) => {
        this.handleError(error, 'No fue posible actualizar el estado del usuario.');
      },
    });
  }

  protected async deleteUsuario(usuario: UsuarioAdmin): Promise<void> {
    const confirmed = await this.uiFeedback.confirm({
      title: 'Eliminar usuario',
      message: `Seguro que deseas eliminar a ${usuario.nombre_completo}? Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      tone: 'error',
    });

    if (!confirmed) return;

    this.usuariosService.deleteUsuario(usuario.id_usuario).subscribe({
      next: () => {
        this.uiFeedback.deleted('El usuario fue eliminado correctamente.');
        this.loadUsuarios();
      },
      error: (error) => {
        this.handleError(error, 'No fue posible eliminar el usuario.');
      },
    });
  }

  protected loadPermisosRol(idRol: number): void {
    const idNegocio = this.negocioId();
    if (!idNegocio) {
      this.permisosRol.set([]);
      return;
    }

    this.loadingPermisos.set(true);

    this.usuariosService.getPermisosRol(idRol, idNegocio).pipe(
      finalize(() => this.loadingPermisos.set(false)),
    ).subscribe({
      next: (matriz) => {
        const permisos =
          (matriz.modulos ?? []).map((modulo) => ({
            ...modulo,
            puede_ver: Boolean(modulo.puede_ver),
            puede_crear: false,
            puede_editar: false,
            puede_eliminar: false,
            subniveles: (modulo.subniveles ?? []).map((subnivel) => ({
              ...subnivel,
              puede_ver: Boolean(subnivel.puede_ver),
            })),
          }));

        this.permisosRol.set(permisos);
        this.permisosSnapshot.set(this.serializePermisos(permisos));
      },
      error: (error) => {
        this.handleError(error, 'No fue posible cargar la matriz de permisos.');
      },
    });
  }

  protected updateModuloAcceso(index: number, checked: boolean): void {
    this.permisosRol.update((rows) => rows.map((row, i) => i === index
      ? {
        ...row,
        puede_ver: checked,
        puede_crear: false,
        puede_editar: false,
        puede_eliminar: false,
        subniveles: (row.subniveles ?? []).map((subnivel) => ({
          ...subnivel,
          puede_ver: checked ? subnivel.puede_ver : false,
        })),
      }
      : row));
  }

  protected updateSubnivelAcceso(moduleIndex: number, subIndex: number, checked: boolean): void {
    this.permisosRol.update((rows) => rows.map((row, rowIndex) => {
      if (rowIndex !== moduleIndex) return row;

      const subniveles = (row.subniveles ?? []).map((subnivel, currentSubIndex) =>
        currentSubIndex === subIndex
          ? { ...subnivel, puede_ver: checked }
          : subnivel
      );

      return {
        ...row,
        puede_ver: checked ? true : row.puede_ver,
        subniveles,
      };
    }));
  }

  protected savePermisosRol(): void {
    const idRol = this.selectedRoleId();
    const idNegocio = this.negocioId();
    if (!idRol || !idNegocio) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    const payload = this.permisosRol().map((modulo) => ({
      ...modulo,
      puede_ver: Boolean(modulo.puede_ver),
      puede_crear: false,
      puede_editar: false,
      puede_eliminar: false,
      subniveles: (modulo.subniveles ?? []).map((subnivel) => ({
        ...subnivel,
        puede_ver: Boolean(modulo.puede_ver) && Boolean(subnivel.puede_ver),
      })),
    }));

    this.usuariosService.savePermisosRol(idRol, idNegocio, payload).pipe(
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.permisosSnapshot.set(this.serializePermisos(payload));
        this.uiFeedback.updated('Los permisos del rol fueron actualizados correctamente.');
        this.loadPermisosRol(idRol);
      },
      error: (error) => {
        this.handleError(error, 'No fue posible guardar permisos del rol.');
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
        this.handleError(error, 'No fue posible consultar los permisos del usuario.');
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

  private serializePermisos(modulos: PermisoModulo[]): string {
    const normalized = [...modulos]
      .map((modulo) => ({
        id_nivel: modulo.id_nivel,
        puede_ver: Boolean(modulo.puede_ver),
        subniveles: [...(modulo.subniveles ?? [])]
          .map((subnivel) => ({
            id_nivel: subnivel.id_nivel,
            puede_ver: Boolean(subnivel.puede_ver),
          }))
          .sort((a, b) => a.id_nivel - b.id_nivel),
      }))
      .sort((a, b) => a.id_nivel - b.id_nivel);

    return JSON.stringify(normalized);
  }

  private handleError(error: unknown, fallback: string): void {
    const message = this.extractError(error, fallback);
    this.errorMessage.set(message);
    this.uiFeedback.error(message);
  }

  private extractError(error: unknown, fallback: string): string {
    const httpError = error as HttpErrorResponse;
    return httpError?.error?.message || fallback;
  }

  private resetPasswordVisibility(): void {
    this.showPassword.set(false);
    this.showConfirmPassword.set(false);
  }
}
