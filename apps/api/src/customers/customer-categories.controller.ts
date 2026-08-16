import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  createCustomerCategorySchema,
  updateCustomerCategorySchema,
  type CreateCustomerCategoryInput,
  type UpdateCustomerCategoryInput,
  type CustomerCategoriesResponse,
  type CustomerCategoryDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomerCategoriesService } from './customer-categories.service';

@Controller('customer-categories')
export class CustomerCategoriesController {
  constructor(private readonly categoriesService: CustomerCategoriesService) {}

  @RequirePermissions('customers.read')
  @Get()
  async list(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<CustomerCategoriesResponse> {
    const categories = await this.categoriesService.list(ctx.companyId);
    return { categories };
  }

  @RequirePermissions('customers.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createCustomerCategorySchema))
    body: CreateCustomerCategoryInput,
  ): Promise<CustomerCategoryDetailResponse> {
    const category = await this.categoriesService.create(ctx, body);
    return { category };
  }

  @RequirePermissions('customers.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerCategorySchema))
    body: UpdateCustomerCategoryInput,
  ): Promise<CustomerCategoryDetailResponse> {
    const category = await this.categoriesService.update(ctx, id, body);
    return { category };
  }
}
