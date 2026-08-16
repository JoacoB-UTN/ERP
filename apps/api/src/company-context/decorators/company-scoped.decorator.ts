import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CompanyContextGuard } from '../guards/company-context.guard';

/**
 * Marks a route as requiring both authentication AND a validated company
 * context (X-Company-Id, optionally X-Branch-Id). Order matters — Nest
 * runs guards in array order, and CompanyContextGuard depends on
 * JwtAuthGuard having already attached `request.user`.
 *
 * No RBAC here: this only answers "which company," never "what may this
 * user do there." See CLAUDE.md.
 */
export function CompanyScoped() {
  return applyDecorators(UseGuards(JwtAuthGuard, CompanyContextGuard));
}
