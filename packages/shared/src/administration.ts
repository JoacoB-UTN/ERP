import { z } from 'zod';

/**
 * Roles/permissions/user-administration DTOs and response shapes shared
 * between apps/api and both frontends. See docs/authorization.md.
 */

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100, 'El nombre es demasiado largo.'),
  description: z.string().trim().max(500, 'La descripción es demasiado larga.').optional(),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio.').max(100).optional(),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const updateRolePermissionsSchema = z.object({
  permissionCodes: z.array(z.string()).default([]),
});
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;

export const assignRoleSchema = z.object({
  roleId: z.string().uuid('Identificador de rol inválido.'),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export interface RoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  active: boolean;
  permissionCodes: string[];
}

export interface RolesResponse {
  roles: RoleSummary[];
}

export interface RoleDetailResponse {
  role: RoleSummary;
}

export interface PermissionsCatalogResponse {
  permissions: import('./permissions').PermissionDefinition[];
}

export interface CompanyUserSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  roles: { id: string; name: string }[];
}

export interface CompanyUsersResponse {
  users: CompanyUserSummary[];
}

export interface UserRolesResponse {
  roles: RoleSummary[];
}

export interface EffectivePermissionsResponse {
  permissions: string[];
}
