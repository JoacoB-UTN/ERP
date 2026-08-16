import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CompanyContextGuard } from '../../company-context/guards/company-context.guard';
import { PermissionGuard } from '../guards/permission.guard';
import { REQUIRED_PERMISSIONS_KEY } from '../authorization.constants';

/**
 * Marks a route as requiring authentication, a validated company context,
 * AND every listed permission (AND semantics) for the active company.
 * This is the full guard chain a permission-protected route needs — no
 * separate @CompanyScoped() required, and no controller should call
 * AuthorizationService directly. See CLAUDE.md: "every protected
 * company-scoped operation must explicitly declare its required
 * permissions."
 *
 *   @RequirePermissions('administration.roles.read')
 *   @Get('roles')
 *   listRoles() { ... }
 */
export function RequirePermissions(...permissions: string[]) {
  return applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions),
    UseGuards(JwtAuthGuard, CompanyContextGuard, PermissionGuard),
  );
}
