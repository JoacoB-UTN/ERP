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
  createStockTransferSchema,
  updateStockTransferSchema,
  stockTransferListQuerySchema,
  type CreateStockTransferInput,
  type UpdateStockTransferInput,
  type StockTransferListQuery,
  type StockTransferListResponse,
  type StockTransferDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StockTransfersService } from './stock-transfers.service';

/**
 * Stock transfers between two warehouses of the same company — see
 * docs/inventory.md. Thin by design: every rule lives in the service.
 *
 * Permissions mirror adjustments, with one addition: `cancel` has its own
 * code because cancelling a CONFIRMED transfer writes compensating
 * movements, which is a stock-changing capability rather than a draft
 * edit.
 */
@Controller('inventory/transfers')
export class StockTransfersController {
  constructor(private readonly transfersService: StockTransfersService) {}

  @RequirePermissions('inventory.transfers.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(stockTransferListQuerySchema))
    query: StockTransferListQuery,
  ): Promise<StockTransferListResponse> {
    return this.transfersService.list(ctx.companyId, query);
  }

  @RequirePermissions('inventory.transfers.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.transfersService.getById(ctx.companyId, id);
    return { transfer };
  }

  @RequirePermissions('inventory.transfers.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createStockTransferSchema))
    body: CreateStockTransferInput,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.transfersService.create(ctx, body);
    return { transfer };
  }

  @RequirePermissions('inventory.transfers.create')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateStockTransferSchema))
    body: UpdateStockTransferInput,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.transfersService.update(ctx, id, body);
    return { transfer };
  }

  @RequirePermissions('inventory.transfers.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.transfersService.confirm(ctx, id);
    return { transfer };
  }

  @RequirePermissions('inventory.transfers.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.transfersService.cancel(ctx, id);
    return { transfer };
  }
}
