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
  createProductCategorySchema,
  updateProductCategorySchema,
  type CreateProductCategoryInput,
  type UpdateProductCategoryInput,
  type ProductCategoriesResponse,
  type ProductCategoryDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProductCategoriesService } from './product-categories.service';

@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly categoriesService: ProductCategoriesService) {}

  @RequirePermissions('products.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<ProductCategoriesResponse> {
    const categories = await this.categoriesService.list(ctx.companyId);
    return { categories };
  }

  @RequirePermissions('products.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createProductCategorySchema))
    body: CreateProductCategoryInput,
  ): Promise<ProductCategoryDetailResponse> {
    const category = await this.categoriesService.create(ctx, body);
    return { category };
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductCategorySchema))
    body: UpdateProductCategoryInput,
  ): Promise<ProductCategoryDetailResponse> {
    const category = await this.categoriesService.update(ctx, id, body);
    return { category };
  }

  @RequirePermissions('products.update')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<ProductCategoryDetailResponse> {
    const category = await this.categoriesService.deactivate(ctx, id);
    return { category };
  }
}
