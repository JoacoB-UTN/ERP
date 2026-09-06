import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  customerAccountListQuerySchema,
  customerStatementQuerySchema,
  customerOpenSalesQuerySchema,
  type CustomerAccountListQuery,
  type CustomerAccountListResponse,
  type CustomerAccountSummary,
  type CustomerStatementQuery,
  type CustomerStatementResponse,
  type CustomerOpenSalesQuery,
  type CustomerOpenSalesResponse,
  type SalesDocumentOutstandingResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CustomerAccountService } from './customer-account.service';

@Controller('customer-accounts')
export class CustomerAccountController {
  constructor(private readonly customerAccountService: CustomerAccountService) {}

  @RequirePermissions('accounts.receivable.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(customerAccountListQuerySchema)) query: CustomerAccountListQuery,
  ): Promise<CustomerAccountListResponse> {
    return this.customerAccountService.list(ctx.companyId, query);
  }

  @RequirePermissions('accounts.receivable.read')
  @Get(':customerId')
  getSummary(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('customerId') customerId: string,
  ): Promise<CustomerAccountSummary> {
    return this.customerAccountService.getSummary(ctx.companyId, customerId);
  }

  @RequirePermissions('accounts.receivable.read')
  @Get(':customerId/statement')
  getStatement(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(customerStatementQuerySchema)) query: CustomerStatementQuery,
  ): Promise<CustomerStatementResponse> {
    return this.customerAccountService.getStatement(ctx.companyId, customerId, query);
  }

  @RequirePermissions('accounts.receivable.read')
  @Get(':customerId/open-sales')
  getOpenSales(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(customerOpenSalesQuerySchema)) query: CustomerOpenSalesQuery,
  ): Promise<CustomerOpenSalesResponse> {
    return this.customerAccountService.getOpenSales(ctx.companyId, customerId, query.currencyId);
  }
}

@Controller('sales-documents/:salesDocumentId/outstanding')
export class SalesDocumentOutstandingController {
  constructor(private readonly customerAccountService: CustomerAccountService) {}

  @RequirePermissions('accounts.receivable.read')
  @Get()
  getOutstanding(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('salesDocumentId') salesDocumentId: string,
  ): Promise<SalesDocumentOutstandingResponse> {
    return this.customerAccountService.getSalesDocumentOutstanding(ctx.companyId, salesDocumentId);
  }
}
