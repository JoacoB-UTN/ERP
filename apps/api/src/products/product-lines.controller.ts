import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createProductLineSchema,
  updateProductLineSchema,
  type CreateProductLineInput,
  type UpdateProductLineInput,
  type ProductLinesResponse,
  type ProductLineDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProductLinesService } from './product-lines.service';

@Controller('product-lines')
export class ProductLinesController {
  constructor(private readonly productLinesService: ProductLinesService) {}

  @RequirePermissions('products.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<ProductLinesResponse> {
    const lines = await this.productLinesService.list(ctx.companyId);
    return { lines };
  }

  @RequirePermissions('products.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createProductLineSchema))
    body: CreateProductLineInput,
  ): Promise<ProductLineDetailResponse> {
    const line = await this.productLinesService.create(ctx, body);
    return { line };
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductLineSchema))
    body: UpdateProductLineInput,
  ): Promise<ProductLineDetailResponse> {
    const line = await this.productLinesService.update(ctx, id, body);
    return { line };
  }

  @RequirePermissions('products.update')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<ProductLineDetailResponse> {
    const line = await this.productLinesService.deactivate(ctx, id);
    return { line };
  }
}
