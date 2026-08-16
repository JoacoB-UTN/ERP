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
  createUnitOfMeasureSchema,
  updateUnitOfMeasureSchema,
  type CreateUnitOfMeasureInput,
  type UpdateUnitOfMeasureInput,
  type UnitsOfMeasureResponse,
  type UnitOfMeasureDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UnitsService } from './units.service';

@Controller('units')
export class UnitsController {
  constructor(private readonly unitsService: UnitsService) {}

  @RequirePermissions('products.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<UnitsOfMeasureResponse> {
    const units = await this.unitsService.list(ctx.companyId);
    return { units };
  }

  @RequirePermissions('products.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createUnitOfMeasureSchema))
    body: CreateUnitOfMeasureInput,
  ): Promise<UnitOfMeasureDetailResponse> {
    const unit = await this.unitsService.create(ctx, body);
    return { unit };
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUnitOfMeasureSchema))
    body: UpdateUnitOfMeasureInput,
  ): Promise<UnitOfMeasureDetailResponse> {
    const unit = await this.unitsService.update(ctx, id, body);
    return { unit };
  }

  @RequirePermissions('products.update')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<UnitOfMeasureDetailResponse> {
    const unit = await this.unitsService.deactivate(ctx, id);
    return { unit };
  }
}
