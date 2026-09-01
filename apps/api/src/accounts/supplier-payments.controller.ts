import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createSupplierPaymentSchema,
  updateSupplierPaymentSchema,
  supplierPaymentListQuerySchema,
  type CreateSupplierPaymentInput,
  type UpdateSupplierPaymentInput,
  type SupplierPaymentListQuery,
  type SupplierPaymentListResponse,
  type SupplierPaymentDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SupplierPaymentsService } from './supplier-payments.service';

@Controller('supplier-payments')
export class SupplierPaymentsController {
  constructor(private readonly supplierPaymentsService: SupplierPaymentsService) {}

  @RequirePermissions('treasury.payments.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(supplierPaymentListQuerySchema)) query: SupplierPaymentListQuery,
  ): Promise<SupplierPaymentListResponse> {
    return this.supplierPaymentsService.list(ctx.companyId, query);
  }

  @RequirePermissions('treasury.payments.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierPaymentDetailResponse> {
    const payment = await this.supplierPaymentsService.getById(ctx.companyId, id);
    return { payment };
  }

  @RequirePermissions('treasury.payments.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) body: CreateSupplierPaymentInput,
  ): Promise<SupplierPaymentDetailResponse> {
    const payment = await this.supplierPaymentsService.create(ctx, body);
    return { payment };
  }

  @RequirePermissions('treasury.payments.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierPaymentSchema)) body: UpdateSupplierPaymentInput,
  ): Promise<SupplierPaymentDetailResponse> {
    const payment = await this.supplierPaymentsService.update(ctx, id, body);
    return { payment };
  }

  @RequirePermissions('treasury.payments.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierPaymentDetailResponse> {
    const payment = await this.supplierPaymentsService.confirm(ctx, id);
    return { payment };
  }

  @RequirePermissions('treasury.payments.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierPaymentDetailResponse> {
    const payment = await this.supplierPaymentsService.cancel(ctx, id);
    return { payment };
  }
}
