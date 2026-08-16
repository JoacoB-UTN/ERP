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
  createBrandSchema,
  updateBrandSchema,
  type CreateBrandInput,
  type UpdateBrandInput,
  type BrandsResponse,
  type BrandDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BrandsService } from './brands.service';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @RequirePermissions('products.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<BrandsResponse> {
    const brands = await this.brandsService.list(ctx.companyId);
    return { brands };
  }

  @RequirePermissions('products.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createBrandSchema))
    body: CreateBrandInput,
  ): Promise<BrandDetailResponse> {
    const brand = await this.brandsService.create(ctx, body);
    return { brand };
  }

  @RequirePermissions('products.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBrandSchema))
    body: UpdateBrandInput,
  ): Promise<BrandDetailResponse> {
    const brand = await this.brandsService.update(ctx, id, body);
    return { brand };
  }

  @RequirePermissions('products.update')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<BrandDetailResponse> {
    const brand = await this.brandsService.deactivate(ctx, id);
    return { brand };
  }
}
