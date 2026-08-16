import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createRoleSchema,
  updateRoleSchema,
  updateRolePermissionsSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
  type UpdateRolePermissionsInput,
  type RolesResponse,
  type RoleDetailResponse,
  type PermissionsCatalogResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RolesService } from './roles.service';

@Controller('administration')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermissions('administration.roles.read')
  @Get('roles')
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<RolesResponse> {
    const roles = await this.rolesService.list(ctx.companyId);
    return { roles };
  }

  @RequirePermissions('administration.roles.read')
  @Get('permissions')
  permissions(): PermissionsCatalogResponse {
    return { permissions: this.rolesService.listPermissionCatalog() };
  }

  @RequirePermissions('administration.roles.read')
  @Get('roles/:id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.getById(ctx.companyId, id);
    return { role };
  }

  @RequirePermissions('administration.roles.create')
  @Post('roles')
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.create(ctx, body);
    return { role };
  }

  @RequirePermissions('administration.roles.update')
  @Patch('roles/:id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.update(ctx, id, body);
    return { role };
  }

  @RequirePermissions('administration.roles.delete')
  @Delete('roles/:id')
  async remove(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.remove(ctx, id);
    return { role };
  }

  @RequirePermissions('administration.roles.update')
  @Put('roles/:id/permissions')
  async replacePermissions(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRolePermissionsSchema))
    body: UpdateRolePermissionsInput,
  ): Promise<RoleDetailResponse> {
    const role = await this.rolesService.replacePermissions(
      ctx,
      id,
      body.permissionCodes,
    );
    return { role };
  }
}
