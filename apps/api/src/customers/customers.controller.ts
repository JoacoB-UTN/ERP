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
  createCustomerSchema,
  updateCustomerSchema,
  customerAddressInputSchema,
  updateCustomerAddressSchema,
  customerContactInputSchema,
  updateCustomerContactSchema,
  customerListQuerySchema,
  customerLookupQuerySchema,
  customerHistoryQuerySchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
  type CustomerAddressInput,
  type UpdateCustomerAddressInput,
  type CustomerContactInput,
  type UpdateCustomerContactInput,
  type CustomerListQuery,
  type CustomerLookupQuery,
  type CustomerHistoryQuery,
  type CustomerListResponse,
  type CustomerLookupResponse,
  type CustomerDetailResponse,
  type CustomerAddressResponse,
  type CustomerContactResponse,
  type AuditEntityHistoryResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomersService } from './customers.service';

/**
 * Note on route order: `GET /customers/lookup` must be declared before
 * `GET /customers/:id` — both are one path segment after `/customers`, so
 * Nest/Express matches by declaration order, same as
 * `GET /administration/audit/entity/...` vs `GET /administration/audit/:id`.
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @RequirePermissions('customers.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(customerListQuerySchema))
    query: CustomerListQuery,
  ): Promise<CustomerListResponse> {
    return this.customersService.list(ctx.companyId, query);
  }

  @RequirePermissions('customers.read')
  @Get('lookup')
  lookup(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(customerLookupQuerySchema))
    query: CustomerLookupQuery,
  ): Promise<CustomerLookupResponse> {
    return this.customersService.lookup(ctx.companyId, query);
  }

  @RequirePermissions('customers.read')
  @Get(':id')
  async getById(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.customersService.getById(ctx.companyId, id);
    return { customer };
  }

  @RequirePermissions('customers.read')
  @Get(':id/history')
  history(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(customerHistoryQuerySchema))
    query: CustomerHistoryQuery,
  ): Promise<AuditEntityHistoryResponse> {
    return this.customersService.getHistory(ctx, id, query);
  }

  @RequirePermissions('customers.create')
  @Post()
  async create(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(createCustomerSchema))
    body: CreateCustomerInput,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.customersService.create(ctx, body);
    return { customer };
  }

  @RequirePermissions('customers.update')
  @Patch(':id')
  async update(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomerSchema))
    body: UpdateCustomerInput,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.customersService.update(ctx, id, body);
    return { customer };
  }

  @RequirePermissions('customers.deactivate')
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.customersService.deactivate(ctx, id);
    return { customer };
  }

  @RequirePermissions('customers.deactivate')
  @Post(':id/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<CustomerDetailResponse> {
    const customer = await this.customersService.reactivate(ctx, id);
    return { customer };
  }

  // ---------- Addresses ----------

  @RequirePermissions('customers.update')
  @Post(':id/addresses')
  async addAddress(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customerAddressInputSchema))
    body: CustomerAddressInput,
  ): Promise<CustomerAddressResponse> {
    const address = await this.customersService.addAddress(ctx, id, body);
    return { address };
  }

  @RequirePermissions('customers.update')
  @Patch(':id/addresses/:addressId')
  async updateAddress(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body(new ZodValidationPipe(updateCustomerAddressSchema))
    body: UpdateCustomerAddressInput,
  ): Promise<CustomerAddressResponse> {
    const address = await this.customersService.updateAddress(
      ctx,
      id,
      addressId,
      body,
    );
    return { address };
  }

  @RequirePermissions('customers.update')
  @Delete(':id/addresses/:addressId')
  async removeAddress(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('addressId') addressId: string,
  ): Promise<{ ok: true }> {
    await this.customersService.removeAddress(ctx, id, addressId);
    return { ok: true };
  }

  // ---------- Contacts ----------

  @RequirePermissions('customers.update')
  @Post(':id/contacts')
  async addContact(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(customerContactInputSchema))
    body: CustomerContactInput,
  ): Promise<CustomerContactResponse> {
    const contact = await this.customersService.addContact(ctx, id, body);
    return { contact };
  }

  @RequirePermissions('customers.update')
  @Patch(':id/contacts/:contactId')
  async updateContact(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body(new ZodValidationPipe(updateCustomerContactSchema))
    body: UpdateCustomerContactInput,
  ): Promise<CustomerContactResponse> {
    const contact = await this.customersService.updateContact(
      ctx,
      id,
      contactId,
      body,
    );
    return { contact };
  }

  @RequirePermissions('customers.update')
  @Delete(':id/contacts/:contactId')
  async removeContact(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ): Promise<{ ok: true }> {
    await this.customersService.removeContact(ctx, id, contactId);
    return { ok: true };
  }
}
