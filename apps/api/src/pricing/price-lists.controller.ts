import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  createPriceListSchema,
  updatePriceListSchema,
  priceListItemsQuerySchema,
  setPriceSchema,
  setPricesBatchSchema,
  bulkAdjustSchema,
  priceHistoryQuerySchema,
  priceListHistoryQuerySchema,
  type CreatePriceListInput,
  type UpdatePriceListInput,
  type PriceListsResponse,
  type PriceListDetailResponse,
  type PriceListItemsQuery,
  type PriceListItemsResponse,
  type SetPriceInput,
  type SetPriceResponse,
  type SetPricesBatchInput,
  type SetPricesBatchResponse,
  type BulkAdjustInput,
  type BulkAdjustPreviewResponse,
  type BulkAdjustResponse,
  type PriceHistoryQuery,
  type PriceHistoryResponse,
  type PriceListHistoryQuery,
  type AuditEntityHistoryResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PriceListsService } from './price-lists.service';
import { PricingService } from './pricing.service';

@Controller('pricing/lists')
export class PriceListsController {
  constructor(
    private readonly priceListsService: PriceListsService,
    private readonly pricingService: PricingService,
  ) {}

  @RequirePermissions('pricing.lists.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<PriceListsResponse> {
    const priceLists = await this.priceListsService.list(ctx.companyId);
    return { priceLists };
  }

  @RequirePermissions('pricing.lists.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.getById(ctx.companyId, id);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createPriceListSchema))
    body: CreatePriceListInput,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.create(ctx, body);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePriceListSchema))
    body: UpdatePriceListInput,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.update(ctx, id, body);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.deactivate(ctx, id);
    return { priceList };
  }

  @RequirePermissions('pricing.lists.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PriceListDetailResponse> {
    const priceList = await this.priceListsService.reactivate(ctx, id);
    return { priceList };
  }

  /** Administrative history (created/updated/deactivated/default changed/...) — distinct from the per-variant commercial price history below. */
  @RequirePermissions('pricing.lists.read')
  @Get(':id/history')
  history(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(priceListHistoryQuerySchema))
    query: PriceListHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    return this.priceListsService.getHistory(ctx.companyId, id, query);
  }

  @RequirePermissions('pricing.lists.read')
  @Get(':id/items')
  listItems(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(priceListItemsQuerySchema))
    query: PriceListItemsQuery,
  ): Promise<PriceListItemsResponse> {
    return this.priceListsService.listItems(ctx.companyId, id, query);
  }

  @RequirePermissions('pricing.prices.update')
  @Put(':priceListId/products/:variantId')
  async setPrice(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('priceListId') priceListId: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(setPriceSchema)) body: SetPriceInput,
  ): Promise<SetPriceResponse> {
    const result = await this.pricingService.setPrice(
      ctx,
      priceListId,
      variantId,
      body,
    );
    return { result };
  }

  @RequirePermissions('pricing.prices.update')
  @Put(':priceListId/prices')
  async setPrices(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('priceListId') priceListId: string,
    @Body(new ZodValidationPipe(setPricesBatchSchema))
    body: SetPricesBatchInput,
  ): Promise<SetPricesBatchResponse> {
    const results = await this.pricingService.setPrices(ctx, priceListId, body);
    return { results };
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/bulk-adjust/preview')
  @HttpCode(200)
  previewBulkAdjust(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bulkAdjustSchema)) body: BulkAdjustInput,
  ): Promise<BulkAdjustPreviewResponse> {
    return this.pricingService.previewBulkAdjust(ctx.companyId, id, body);
  }

  @RequirePermissions('pricing.prices.bulk_update')
  @Post(':id/bulk-adjust')
  confirmBulkAdjust(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(bulkAdjustSchema)) body: BulkAdjustInput,
  ): Promise<BulkAdjustResponse> {
    return this.pricingService.confirmBulkAdjust(ctx, id, body);
  }

  @RequirePermissions('pricing.prices.read')
  @Get(':listId/products/:variantId/history')
  getHistory(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('listId') listId: string,
    @Param('variantId') variantId: string,
    @Query(new ZodValidationPipe(priceHistoryQuerySchema))
    query: PriceHistoryQuery,
  ): Promise<PriceHistoryResponse> {
    return this.pricingService.getPriceHistory(
      ctx.companyId,
      listId,
      variantId,
      query,
    );
  }
}
