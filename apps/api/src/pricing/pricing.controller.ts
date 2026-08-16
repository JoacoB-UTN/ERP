import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  priceLookupQuerySchema,
  priceLookupBatchSchema,
  type PriceLookupQuery,
  type PriceLookupResponse,
  type PriceLookupBatchInput,
  type PriceLookupBatchResponse,
  type CurrenciesResponse,
  type ProductPricesResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PricingService } from './pricing.service';
import { PriceListsService } from './price-lists.service';

@Controller('pricing')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    private readonly priceListsService: PriceListsService,
  ) {}

  @RequirePermissions('pricing.lists.read')
  @Get('currencies')
  async currencies(): Promise<CurrenciesResponse> {
    const currencies = await this.priceListsService.listCurrencies();
    return { currencies };
  }

  /** Operational lookup for a future Facturación/POS selector — see docs/pricing.md. */
  @RequirePermissions('pricing.prices.read')
  @Get('lookup')
  async lookup(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(priceLookupQuerySchema))
    query: PriceLookupQuery,
  ): Promise<PriceLookupResponse> {
    const result = await this.pricingService.getPrice(
      ctx.companyId,
      query.priceListId,
      query.productVariantId,
      query.date,
    );
    return { result };
  }

  @RequirePermissions('pricing.prices.read')
  @Post('lookup/batch')
  async lookupBatch(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(priceLookupBatchSchema))
    body: PriceLookupBatchInput,
  ): Promise<PriceLookupBatchResponse> {
    const { currencyCode, items } = await this.pricingService.getPrices(
      ctx.companyId,
      body.priceListId,
      body.productVariantIds,
      body.date,
    );
    return { currencyCode, priceListId: body.priceListId, items };
  }

  @RequirePermissions('pricing.prices.read')
  @Get('products/:productId/prices')
  getProductPrices(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('productId') productId: string,
  ): Promise<ProductPricesResponse> {
    return this.priceListsService.getProductPrices(ctx.companyId, productId);
  }
}
