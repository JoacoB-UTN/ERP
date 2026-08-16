import { z } from 'zod';

/**
 * Centralized password policy (CLAUDE.md: "Centralize the policy").
 * Deliberately just a length floor — no arbitrary symbol/uppercase/digit
 * rules — so passphrases are welcome. Reused by both the backend DTOs and
 * the frontend forms so users get the same rule in both places.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(200, 'La contraseña es demasiado larga.');

export const emailSchema = z.string().trim().toLowerCase().email('Ingresá un email válido.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Ingresá tu contraseña.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Ingresá tu contraseña actual.'),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Safe (never includes passwordHash) shape returned by the API. */
export interface SafeUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
}

/**
 * Deliberately identity-only. "Which companies can this user operate" is
 * answered by GET /context/companies (see @erp/shared's CompanySummary),
 * not by /auth/me — keeps authentication and company context as separate
 * concerns instead of one endpoint doing both. See
 * docs/multi-company-architecture.md.
 */
export interface MeResponse {
  user: SafeUser;
}

export interface LoginResponse {
  user: SafeUser;
}
