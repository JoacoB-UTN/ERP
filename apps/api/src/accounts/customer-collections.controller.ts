import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createCustomerCollectionSchema,
  updateCustomerCollectionSchema,
  customerCollectionListQuerySchema,
  type CreateCustomerCollectionInput,
  type UpdateCustomerCollectionInput,
  type CustomerCollectionListQuery,
  type CustomerCollectionListResponse,
  type CustomerCollectionDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomerCollectionsService } from './customer-collections.service';

@Controller('customer-collections')
export class CustomerCollectionsController {
  constructor(private readonly customerCollectionsService: CustomerCollectionsService) {}

  @RequirePermissions('treasury.receipts.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(customerCollectionListQuerySchema)) query: CustomerCollectionListQuery,
  ): Promise<CustomerCollectionListResponse> {
    return this.customerCollectionsService.list(ctx.companyId, query);
  }

  @RequirePermissions('treasury.receipts.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerCollectionDetailResponse> {
    const collection = await this.customerCollectionsService.getById(ctx.companyId, id);
    return { collection };
  }

  @RequirePermissions('treasury.receipts.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createCustomerCollectionSchema)) body: CreateCustomerCollectionInput,
  ): Promise<CustomerCollectionDetailResponse> {
    const collection = await this.customerCollectionsService.create(ctx, body);
    return { collection };
  }

  @RequirePermissions('treasury.receipts.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerCollectionSchema)) body: UpdateCustomerCollectionInput,
  ): Promise<CustomerCollectionDetailResponse> {
    const collection = await this.customerCollectionsService.update(ctx, id, body);
    return { collection };
  }

  @RequirePermissions('treasury.receipts.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerCollectionDetailResponse> {
    const collection = await this.customerCollectionsService.confirm(ctx, id);
    return { collection };
  }

  @RequirePermissions('treasury.receipts.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerCollectionDetailResponse> {
    const collection = await this.customerCollectionsService.cancel(ctx, id);
    return { collection };
  }
}
