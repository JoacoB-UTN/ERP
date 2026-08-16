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
  createSaleSchema,
  updateSaleSchema,
  salesListQuerySchema,
  type CreateSaleInput,
  type UpdateSaleInput,
  type SalesListQuery,
  type SalesListResponse,
  type SalesDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SalesService } from './sales.service';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @RequirePermissions('sales.documents.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(salesListQuerySchema)) query: SalesListQuery,
  ): Promise<SalesListResponse> {
    return this.salesService.list(ctx.companyId, query);
  }

  @RequirePermissions('sales.documents.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SalesDetailResponse> {
    const salesDocument = await this.salesService.getById(ctx.companyId, id);
    return { salesDocument };
  }

  @RequirePermissions('sales.documents.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createSaleSchema)) body: CreateSaleInput,
  ): Promise<SalesDetailResponse> {
    const salesDocument = await this.salesService.create(ctx, body);
    return { salesDocument };
  }

  @RequirePermissions('sales.documents.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSaleSchema)) body: UpdateSaleInput,
  ): Promise<SalesDetailResponse> {
    const salesDocument = await this.salesService.update(ctx, id, body);
    return { salesDocument };
  }

  @RequirePermissions('sales.documents.confirm')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SalesDetailResponse> {
    const salesDocument = await this.salesService.confirm(ctx, id);
    return { salesDocument };
  }

  @RequirePermissions('sales.documents.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SalesDetailResponse> {
    const salesDocument = await this.salesService.cancel(ctx, id);
    return { salesDocument };
  }
}
