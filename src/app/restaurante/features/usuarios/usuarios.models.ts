export type EstadoRegistro = 'A' | 'I';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: unknown[];
}

export interface RolAdminOption {
  id_rol: number;
  descripcion: string;
  id_tipo_negocio: number | null;
  tipoNegocio?: {
    id_tipo_negocio: number;
    nombre: string;
  } | null;
}

export interface UsuarioRolResumen {
  id_usuario_rol: number;
  id_rol: number;
  descripcion: string;
  id_tipo_negocio: number | null;
  id_negocio: number | null;
  negocio_nombre: string | null;
}

export interface UsuarioAdmin {
  id_usuario: number;
  nombre_completo: string;
  primer_nombre: string;
  segundo_nombre: string | null;
  primer_apellido: string;
  segundo_apellido: string | null;
  num_identificacion: string;
  email: string;
  estado: EstadoRegistro;
  fecha_creacion: string;
  es_admin_principal: boolean;
  rol_principal: UsuarioRolResumen | null;
  roles: UsuarioRolResumen[];
}

export interface UsuarioAdminPayload {
  primer_nombre: string;
  segundo_nombre?: string | null;
  primer_apellido: string;
  segundo_apellido?: string | null;
  num_identificacion: string;
  email: string;
  password?: string;
  id_rol: number;
  id_negocio?: number | null;
  estado: EstadoRegistro;
  es_admin_principal?: boolean;
}

export interface PermisoModulo {
  id_nivel: number;
  modulo: string;
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface RolPermisosMatriz {
  id_rol: number;
  descripcion: string;
  id_tipo_negocio: number | null;
  modulos: PermisoModulo[];
}

export interface PermisoVistaUsuario {
  id_nivel: number;
  vista: string;
  url: string;
  roles: string[];
  puede_ver: boolean;
  puede_crear: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface UsuarioPermisosDetalle {
  usuario: UsuarioAdmin;
  permisos_vista: PermisoVistaUsuario[];
}

export type UsuariosAdminResponse = ApiResponse<UsuarioAdmin[]>;
export type RolesAdminResponse = ApiResponse<RolAdminOption[]>;
export type RolPermisosResponse = ApiResponse<RolPermisosMatriz>;
export type UsuarioPermisosResponse = ApiResponse<UsuarioPermisosDetalle>;
export type AdminOkResponse = ApiResponse<{ id_usuario?: number }>;
