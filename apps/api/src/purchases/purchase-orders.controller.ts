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
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  purchaseOrderListQuerySchema,
  type CreatePurchaseOrderInput,
  type UpdatePurchaseOrderInput,
  type PurchaseOrderListQuery,
  type PurchaseOrderListResponse,
  type PurchaseOrderDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * `approve`, not `confirm`, in the URL matches the pre-existing
 * `purchases.orders.approve` permission code — see docs/purchases.md's
 * documented naming deviation.
 */
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @RequirePermissions('purchases.orders.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(purchaseOrderListQuerySchema))
    query: PurchaseOrderListQuery,
  ): Promise<PurchaseOrderListResponse> {
    return this.purchaseOrdersService.list(ctx.companyId, query);
  }

  @RequirePermissions('purchases.orders.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const purchaseOrder = await this.purchaseOrdersService.getById(
      ctx.companyId,
      id,
    );
    return { purchaseOrder };
  }

  @RequirePermissions('purchases.orders.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    body: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderDetailResponse> {
    const purchaseOrder = await this.purchaseOrdersService.create(ctx, body);
    return { purchaseOrder };
  }

  @RequirePermissions('purchases.orders.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema))
    body: UpdatePurchaseOrderInput,
  ): Promise<PurchaseOrderDetailResponse> {
    const purchaseOrder = await this.purchaseOrdersService.update(
      ctx,
      id,
      body,
    );
    return { purchaseOrder };
  }

  @RequirePermissions('purchases.orders.approve')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const purchaseOrder = await this.purchaseOrdersService.confirm(ctx, id);
    return { purchaseOrder };
  }

  @RequirePermissions('purchases.orders.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<PurchaseOrderDetailResponse> {
    const purchaseOrder = await this.purchaseOrdersService.cancel(ctx, id);
    return { purchaseOrder };
  }
}
