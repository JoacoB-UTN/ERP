import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  stockListQuerySchema,
  inventoryLookupQuerySchema,
  movementListQuerySchema,
  createInitialBalanceSchema,
  type StockListQuery,
  type StockListResponse,
  type InventoryLookupQuery,
  type InventoryLookupResponse,
  type ProductStockResponse,
  type VariantStockResponse,
  type MovementListQuery,
  type MovementListResponse,
  type MovementDetailResponse,
  type CreateInitialBalanceInput,
  type InitialBalanceResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @RequirePermissions('inventory.stock.read')
  @Get('stock')
  listStock(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(stockListQuerySchema))
    query: StockListQuery,
  ): Promise<StockListResponse> {
    return this.inventoryService.listStock(ctx.companyId, query);
  }

  /** Sellable-variant-granularity, warehouse-aware lookup — see docs/inventory.md (future Facturación/POS). */
  @RequirePermissions('inventory.stock.read')
  @Get('lookup')
  lookup(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(inventoryLookupQuerySchema))
    query: InventoryLookupQuery,
  ): Promise<InventoryLookupResponse> {
    return this.inventoryService.lookup(ctx.companyId, query);
  }

  @RequirePermissions('inventory.stock.read')
  @Get('products/:productId')
  getProductStock(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('productId') productId: string,
  ): Promise<ProductStockResponse> {
    return this.inventoryService.getProductStock(ctx.companyId, productId);
  }

  @RequirePermissions('inventory.stock.read')
  @Get('variants/:variantId')
  getVariantStock(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('variantId') variantId: string,
  ): Promise<VariantStockResponse> {
    return this.inventoryService.getVariantStock(ctx.companyId, variantId);
  }

  @RequirePermissions('inventory.movements.read')
  @Get('movements')
  listMovements(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(movementListQuerySchema))
    query: MovementListQuery,
  ): Promise<MovementListResponse> {
    return this.inventoryService.listMovements(ctx.companyId, query);
  }

  @RequirePermissions('inventory.movements.read')
  @Get('movements/:id')
  async getMovementById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<MovementDetailResponse> {
    const movement = await this.inventoryService.getMovementById(
      ctx.companyId,
      id,
    );
    return { movement };
  }

  @RequirePermissions('inventory.initial-balance.create')
  @Post('initial-balance')
  createInitialBalance(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createInitialBalanceSchema))
    body: CreateInitialBalanceInput,
  ): Promise<InitialBalanceResponse> {
    return this.inventoryService.createInitialBalance(ctx, body);
  }
}
