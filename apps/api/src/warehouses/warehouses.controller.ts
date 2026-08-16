import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
  type WarehousesResponse,
  type WarehouseDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WarehousesService } from './warehouses.service';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @RequirePermissions('inventory.warehouses.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<WarehousesResponse> {
    const warehouses = await this.warehousesService.list(ctx.companyId);
    return { warehouses };
  }

  @RequirePermissions('inventory.warehouses.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<WarehouseDetailResponse> {
    const warehouse = await this.warehousesService.getById(ctx.companyId, id);
    return { warehouse };
  }

  @RequirePermissions('inventory.warehouses.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createWarehouseSchema))
    body: CreateWarehouseInput,
  ): Promise<WarehouseDetailResponse> {
    const warehouse = await this.warehousesService.create(ctx, body);
    return { warehouse };
  }

  @RequirePermissions('inventory.warehouses.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema))
    body: UpdateWarehouseInput,
  ): Promise<WarehouseDetailResponse> {
    const warehouse = await this.warehousesService.update(ctx, id, body);
    return { warehouse };
  }

  @RequirePermissions('inventory.warehouses.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<WarehouseDetailResponse> {
    const warehouse = await this.warehousesService.deactivate(ctx, id);
    return { warehouse };
  }

  @RequirePermissions('inventory.warehouses.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<WarehouseDetailResponse> {
    const warehouse = await this.warehousesService.reactivate(ctx, id);
    return { warehouse };
  }
}
