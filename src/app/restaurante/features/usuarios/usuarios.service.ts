import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../environments/environment';
import {
  UsuarioAdmin,
  UsuarioAdminPayload,
  UsuariosAdminResponse,
  RolAdminOption,
  RolesAdminResponse,
  RolPermisosMatriz,
  RolPermisosResponse,
  PermisoModulo,
  AdminOkResponse,
  UsuarioPermisosDetalle,
  UsuarioPermisosResponse,
  EstadoRegistro,
} from './usuarios.models';

@Injectable({ providedIn: 'root' })
export class UsuariosService {
  private readonly http = inject(HttpClient);

  private readonly adminApi = environment.apiUrl.replace(/\/restaurante\/?$/, '/admin');

  getUsuarios(filters?: {
    search?: string;
    idRol?: number | null;
    estado?: EstadoRegistro | 'ALL';
  }): Observable<UsuarioAdmin[]> {
    let params = new HttpParams();

    if (filters?.search) {
      params = params.set('search', filters.search.trim());
    }
    if (filters?.idRol) {
      params = params.set('id_rol', String(filters.idRol));
    }
    if (filters?.estado) {
      params = params.set('estado', filters.estado);
    }

    return this.http
      .get<UsuariosAdminResponse>(`${this.adminApi}/usuarios/admin`, { params })
      .pipe(map((res) => res.data ?? []));
  }

  getRoles(): Observable<RolAdminOption[]> {
    return this.http
      .get<RolesAdminResponse>(`${this.adminApi}/roles/admin/lista`)
      .pipe(map((res) => res.data ?? []));
  }

  createUsuario(payload: UsuarioAdminPayload): Observable<AdminOkResponse> {
    return this.http.post<AdminOkResponse>(`${this.adminApi}/usuarios/admin`, payload);
  }

  updateUsuario(idUsuario: number, payload: UsuarioAdminPayload): Observable<AdminOkResponse> {
    return this.http.put<AdminOkResponse>(`${this.adminApi}/usuarios/admin/${idUsuario}`, payload);
  }

  setEstadoUsuario(idUsuario: number, estado: EstadoRegistro): Observable<AdminOkResponse> {
    return this.http.patch<AdminOkResponse>(`${this.adminApi}/usuarios/admin/${idUsuario}/estado`, { estado });
  }

  deleteUsuario(idUsuario: number): Observable<AdminOkResponse> {
    return this.http.delete<AdminOkResponse>(`${this.adminApi}/usuarios/admin/${idUsuario}`);
  }

  getPermisosRol(idRol: number): Observable<RolPermisosMatriz> {
    return this.http
      .get<RolPermisosResponse>(`${this.adminApi}/roles/admin/${idRol}/permisos`)
      .pipe(map((res) => res.data!));
  }

  savePermisosRol(idRol: number, modulos: PermisoModulo[]): Observable<AdminOkResponse> {
    return this.http.put<AdminOkResponse>(`${this.adminApi}/roles/admin/${idRol}/permisos`, { modulos });
  }

  getPermisosUsuario(idUsuario: number): Observable<UsuarioPermisosDetalle> {
    return this.http
      .get<UsuarioPermisosResponse>(`${this.adminApi}/usuarios/admin/${idUsuario}/permisos`)
      .pipe(map((res) => res.data!));
  }
}
