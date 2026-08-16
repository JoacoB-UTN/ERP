import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createProductSchema,
  updateProductSchema,
  productVariantCreateInputSchema,
  updateProductVariantSchema,
  productCodeInputSchema,
  updateProductCodeSchema,
  productListQuerySchema,
  productLookupQuerySchema,
  productHistoryQuerySchema,
  type CreateProductInput,
  type UpdateProductInput,
  type ProductVariantCreateInput,
  type UpdateProductVariantInput,
  type ProductCodeInput,
  type UpdateProductCodeInput,
  type ProductListQuery,
  type ProductLookupQuery,
  type ProductHistoryQuery,
  type ProductListResponse,
  type ProductLookupResponse,
  type ProductDetailResponse,
  type ProductVariantResponse,
  type ProductCodeResponse,
  type AuditEntityHistoryResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ProductsService } from './products.service';

/**
 * Note on route order: `GET /products/lookup` must be declared before
 * `GET /products/:id` — both are one path segment after `/products`, so
 * Nest/Express matches by declaration order (same pattern as
 * `GET /customers/lookup` vs `GET /customers/:id`).
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @RequirePermissions('products.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(productListQuerySchema))
    query: ProductListQuery,
  ): Promise<ProductListResponse> {
    return this.productsService.list(ctx.companyId, query);
  }

  @RequirePermissions('products.read')
  @Get('lookup')
  lookup(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(productLookupQuerySchema))
    query: ProductLookupQuery,
  ): Promise<ProductLookupResponse> {
    return this.productsService.lookup(ctx.companyId, query);
  }

  @RequirePermissions('products.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<ProductDetailResponse> {
    const product = await this.productsService.getById(ctx.companyId, id);
    return { product };
  }

  @RequirePermissions('products.read')
  @Get(':id/history')
  history(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(productHistoryQuerySchema))
    query: ProductHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    return this.productsService.getHistory(ctx, id, query);
  }

  @RequirePermissions('products.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createProductSchema))
    body: CreateProductInput,
  ): Promise<ProductDetailResponse> {
    const product = await this.productsService.create(ctx, body);
    return { product };
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema))
    body: UpdateProductInput,
  ): Promise<ProductDetailResponse> {
    const product = await this.productsService.update(ctx, id, body);
    return { product };
  }

  @RequirePermissions('products.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<ProductDetailResponse> {
    const product = await this.productsService.deactivate(ctx, id);
    return { product };
  }

  @RequirePermissions('products.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<ProductDetailResponse> {
    const product = await this.productsService.reactivate(ctx, id);
    return { product };
  }

  // ---------- Variants ----------

  @RequirePermissions('products.update')
  @Post(':id/variants')
  async addVariant(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productVariantCreateInputSchema))
    body: ProductVariantCreateInput,
  ): Promise<ProductVariantResponse> {
    const variant = await this.productsService.addVariant(ctx, id, body);
    return { variant };
  }

  @RequirePermissions('products.update')
  @Patch(':id/variants/:variantId')
  async updateVariant(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(updateProductVariantSchema))
    body: UpdateProductVariantInput,
  ): Promise<ProductVariantResponse> {
    const variant = await this.productsService.updateVariant(
      ctx,
      id,
      variantId,
      body,
    );
    return { variant };
  }

  @RequirePermissions('products.update')
  @Post(':id/variants/:variantId/deactivate')
  @HttpCode(200)
  async deactivateVariant(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ): Promise<ProductVariantResponse> {
    const variant = await this.productsService.deactivateVariant(
      ctx,
      id,
      variantId,
    );
    return { variant };
  }

  @RequirePermissions('products.update')
  @Post(':id/variants/:variantId/reactivate')
  @HttpCode(200)
  async reactivateVariant(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
  ): Promise<ProductVariantResponse> {
    const variant = await this.productsService.reactivateVariant(
      ctx,
      id,
      variantId,
    );
    return { variant };
  }

  // ---------- Codes ----------

  @RequirePermissions('products.update')
  @Post(':id/variants/:variantId/codes')
  async addCode(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(productCodeInputSchema))
    body: ProductCodeInput,
  ): Promise<ProductCodeResponse> {
    const code = await this.productsService.addCode(ctx, id, variantId, body);
    return { code };
  }

  @RequirePermissions('products.update')
  @Patch(':id/variants/:variantId/codes/:codeId')
  async updateCode(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Param('codeId') codeId: string,
    @Body(new ZodValidationPipe(updateProductCodeSchema))
    body: UpdateProductCodeInput,
  ): Promise<ProductCodeResponse> {
    const code = await this.productsService.updateCode(
      ctx,
      id,
      variantId,
      codeId,
      body,
    );
    return { code };
  }

  @RequirePermissions('products.update')
  @Delete(':id/variants/:variantId/codes/:codeId')
  async removeCode(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Param('codeId') codeId: string,
  ): Promise<{ ok: true }> {
    await this.productsService.removeCode(ctx, id, variantId, codeId);
    return { ok: true };
  }
}
