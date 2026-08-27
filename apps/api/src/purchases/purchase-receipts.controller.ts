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
  createPurchaseReceiptSchema,
  updatePurchaseReceiptSchema,
  purchaseReceiptListQuerySchema,
  type CreatePurchaseReceiptInput,
  type UpdatePurchaseReceiptInput,
  type PurchaseReceiptListQuery,
  type PurchaseReceiptListResponse,
  type PurchaseReceiptDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PurchaseReceiptsService } from './purchase-receipts.service';

@Controller('purchase-receipts')
export class PurchaseReceiptsController {
  constructor(
    private readonly purchaseReceiptsService: PurchaseReceiptsService,
  ) {}

  @RequirePermissions('purchases.goods-receipts.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(purchaseReceiptListQuerySchema))
    query: PurchaseReceiptListQuery,
  ): Promise<PurchaseReceiptListResponse> {
    return this.purchaseReceiptsService.list(ctx.companyId, query);
  }

  @RequirePermissions('purchases.goods-receipts.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseReceiptDetailResponse> {
    const purchaseReceipt = await this.purchaseReceiptsService.getById(
      ctx.companyId,
      id,
    );
    return { purchaseReceipt };
  }

  @RequirePermissions('purchases.goods-receipts.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createPurchaseReceiptSchema))
    body: CreatePurchaseReceiptInput,
  ): Promise<PurchaseReceiptDetailResponse> {
    const purchaseReceipt = await this.purchaseReceiptsService.create(
      ctx,
      body,
    );
    return { purchaseReceipt };
  }

  @RequirePermissions('purchases.goods-receipts.create')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseReceiptSchema))
    body: UpdatePurchaseReceiptInput,
  ): Promise<PurchaseReceiptDetailResponse> {
    const purchaseReceipt = await this.purchaseReceiptsService.update(
      ctx,
      id,
      body,
    );
    return { purchaseReceipt };
  }

  @RequirePermissions('purchases.goods-receipts.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseReceiptDetailResponse> {
    const purchaseReceipt = await this.purchaseReceiptsService.confirm(ctx, id);
    return { purchaseReceipt };
  }

  @RequirePermissions('purchases.goods-receipts.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseReceiptDetailResponse> {
    const purchaseReceipt = await this.purchaseReceiptsService.cancel(ctx, id);
    return { purchaseReceipt };
  }
}
