import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  assignRoleSchema,
  createUserSchema,
  type AssignRoleInput,
  type CompanyUserDetailResponse,
  type CompanyUsersResponse,
  type CreateUserInput,
  type UserRolesResponse,
  type RoleDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';

@Controller('administration')
export class UsersController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly usersService: UsersService,
  ) {}

  /** Only users with active membership to the active company — never a global user directory. See CLAUDE.md. */
  @RequirePermissions('administration.users.read')
  @Get('users')
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<CompanyUsersResponse> {
    const users = await this.rolesService.listCompanyUsers(ctx.companyId);
    return { users };
  }

  /**
   * Creates the account AND its membership in the active company — the two
   * are one action here, never a global user directory the caller can add
   * themselves to later. Gated on `administration.users.create` alone: the
   * optional initial roles come with the creation, so requiring
   * `roles.assign` as well would block an administrator who is allowed to
   * onboard people from doing the only sensible version of it.
   */
  @RequirePermissions('administration.users.create')
  @Post('users')
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<CompanyUserDetailResponse> {
    const user = await this.usersService.create(ctx, body);
    return { user };
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
