import { z } from 'zod';

import { emailSchema, passwordSchema } from './auth';

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

/**
 * Creating a user from the administration screen.
 *
 * The initial password is set by the administrator rather than emailed as
 * an invitation because this product ships as a LAN install with no mail
 * transport of any kind (there is no mailer in apps/api — password reset
 * is the same story). An invite flow that cannot deliver its invite is
 * worse than none. The administrator hands the password over in person and
 * the user changes it from their profile.
 *
 * `roleIds` is optional and may be empty: a user with company access and no
 * role is a legitimate, useful state — they can sign in and see nothing
 * until someone decides what they should do.
 *
 * The password rule is `passwordSchema`, the same one login, reset and
 * change-password use — the policy lives in exactly one place (CLAUDE.md).
 */
export const createUserSchema = z.object({
  firstName: z.string().trim().min(1, 'El nombre es obligatorio.').max(100, 'El nombre es demasiado largo.'),
  lastName: z
    .string()
    .trim()
    .min(1, 'El apellido es obligatorio.')
    .max(100, 'El apellido es demasiado largo.'),
  email: emailSchema,
  password: passwordSchema,
  roleIds: z.array(z.string().uuid('Identificador de rol inválido.')).default([]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

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

export interface CompanyUserDetailResponse {
  user: CompanyUserSummary;
}

export interface UserRolesResponse {
  roles: RoleSummary[];
}

export interface EffectivePermissionsResponse {
  permissions: string[];
}
