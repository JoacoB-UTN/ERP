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
  createSupplierSchema,
  updateSupplierSchema,
  supplierListQuerySchema,
  supplierLookupQuerySchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type SupplierListQuery,
  type SupplierLookupQuery,
  type SupplierListResponse,
  type SupplierLookupResponse,
  type SupplierDetailResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SuppliersService } from './suppliers.service';

/** `GET /suppliers/lookup` must be declared before `GET /suppliers/:id` — same route-order note as CustomersController. */
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @RequirePermissions('purchases.suppliers.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(supplierListQuerySchema))
    query: SupplierListQuery,
  ): Promise<SupplierListResponse> {
    return this.suppliersService.list(ctx.companyId, query);
  }

  @RequirePermissions('purchases.suppliers.read')
  @Get('lookup')
  lookup(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(supplierLookupQuerySchema))
    query: SupplierLookupQuery,
  ): Promise<SupplierLookupResponse> {
    return this.suppliersService.lookup(ctx.companyId, query);
  }

  @RequirePermissions('purchases.suppliers.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.suppliersService.getById(ctx.companyId, id);
    return { supplier };
  }

  @RequirePermissions('purchases.suppliers.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createSupplierSchema))
    body: CreateSupplierInput,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.suppliersService.create(ctx, body);
    return { supplier };
  }

  @RequirePermissions('purchases.suppliers.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema))
    body: UpdateSupplierInput,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.suppliersService.update(ctx, id, body);
    return { supplier };
  }

  @RequirePermissions('purchases.suppliers.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.suppliersService.deactivate(ctx, id);
    return { supplier };
  }

  @RequirePermissions('purchases.suppliers.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<SupplierDetailResponse> {
    const supplier = await this.suppliersService.reactivate(ctx, id);
    return { supplier };
  }
}
