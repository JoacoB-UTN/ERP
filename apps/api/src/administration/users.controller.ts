import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  assignRoleSchema,
  type AssignRoleInput,
  type CompanyUsersResponse,
  type UserRolesResponse,
  type RoleDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@Controller('administration')
export class UsersController {
  constructor(private readonly rolesService: RolesService) {}

  /** Only users with active membership to the active company — never a global user directory. See CLAUDE.md. */
  @RequirePermissions('administration.users.read')
  @Get('users')
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<CompanyUsersResponse> {
    const users = await this.rolesService.listCompanyUsers(ctx.companyId);
    return { users };
  }

  @RequirePermissions('administration.roles.assign')
  @Get('users/:userId/roles')
  async listRoles(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('userId') userId: string,
  ): Promise<UserRolesResponse> {
    const roles = await this.rolesService.listUserRoles(ctx.companyId, userId);
    return { roles };
  }

  @RequirePermissions('administration.roles.assign')
  @Post('users/:userId/roles')
  async assign(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(assignRoleSchema)) body: AssignRoleInput,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.assignRole(ctx, userId, body.roleId);
    return { role };
  }

  @RequirePermissions('administration.roles.assign')
  @Delete('users/:userId/roles/:roleId')
  async remove(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ): Promise<{ ok: true }> {
    await this.rolesService.removeRole(ctx, userId, roleId);
    return { ok: true };
  }
}
