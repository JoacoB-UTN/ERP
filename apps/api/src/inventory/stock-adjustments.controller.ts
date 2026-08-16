import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createStockAdjustmentSchema,
  updateStockAdjustmentSchema,
  stockAdjustmentListQuerySchema,
  type CreateStockAdjustmentInput,
  type UpdateStockAdjustmentInput,
  type StockAdjustmentListQuery,
  type StockAdjustmentListResponse,
  type StockAdjustmentDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StockAdjustmentsService } from './stock-adjustments.service';

@Controller('inventory/adjustments')
export class StockAdjustmentsController {
  constructor(private readonly adjustmentsService: StockAdjustmentsService) {}

  @RequirePermissions('inventory.adjustments.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(stockAdjustmentListQuerySchema))
    query: StockAdjustmentListQuery,
  ): Promise<StockAdjustmentListResponse> {
    return this.adjustmentsService.list(ctx.companyId, query);
  }

  @RequirePermissions('inventory.adjustments.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockAdjustmentDetailResponse> {
    const adjustment = await this.adjustmentsService.getById(ctx.companyId, id);
    return { adjustment };
  }

  @RequirePermissions('inventory.adjustments.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createStockAdjustmentSchema))
    body: CreateStockAdjustmentInput,
  ): Promise<StockAdjustmentDetailResponse> {
    const adjustment = await this.adjustmentsService.create(ctx, body);
    return { adjustment };
  }

  @RequirePermissions('inventory.adjustments.create')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStockAdjustmentSchema))
    body: UpdateStockAdjustmentInput,
  ): Promise<StockAdjustmentDetailResponse> {
    const adjustment = await this.adjustmentsService.update(ctx, id, body);
    return { adjustment };
  }

  @RequirePermissions('inventory.adjustments.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockAdjustmentDetailResponse> {
    const adjustment = await this.adjustmentsService.confirm(ctx, id);
    return { adjustment };
  }

  @RequirePermissions('inventory.adjustments.create')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockAdjustmentDetailResponse> {
    const adjustment = await this.adjustmentsService.cancel(ctx, id);
    return { adjustment };
  }
}
