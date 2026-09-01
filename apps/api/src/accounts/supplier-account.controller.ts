import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  supplierAccountListQuerySchema,
  supplierStatementQuerySchema,
  supplierOpenReceiptsQuerySchema,
  type SupplierAccountListQuery,
  type SupplierAccountListResponse,
  type SupplierAccountSummary,
  type SupplierStatementQuery,
  type SupplierStatementResponse,
  type SupplierOpenReceiptsQuery,
  type SupplierOpenReceiptsResponse,
  type PurchaseReceiptOutstandingResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { SupplierAccountService } from './supplier-account.service';

@Controller('supplier-accounts')
export class SupplierAccountController {
  constructor(private readonly supplierAccountService: SupplierAccountService) {}

  @RequirePermissions('accounts.payable.read')
  @Get()
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(supplierAccountListQuerySchema)) query: SupplierAccountListQuery,
  ): Promise<SupplierAccountListResponse> {
    return this.supplierAccountService.list(ctx.companyId, query);
  }

  @RequirePermissions('accounts.payable.read')
  @Get(':supplierId')
  getSummary(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('supplierId') supplierId: string,
  ): Promise<SupplierAccountSummary> {
    return this.supplierAccountService.getSummary(ctx.companyId, supplierId);
  }

  @RequirePermissions('accounts.payable.read')
  @Get(':supplierId/statement')
  getStatement(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('supplierId') supplierId: string,
    @Query(new ZodValidationPipe(supplierStatementQuerySchema)) query: SupplierStatementQuery,
  ): Promise<SupplierStatementResponse> {
    return this.supplierAccountService.getStatement(ctx.companyId, supplierId, query);
  }

  @RequirePermissions('accounts.payable.read')
  @Get(':supplierId/open-receipts')
  getOpenReceipts(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('supplierId') supplierId: string,
    @Query(new ZodValidationPipe(supplierOpenReceiptsQuerySchema)) query: SupplierOpenReceiptsQuery,
  ): Promise<SupplierOpenReceiptsResponse> {
    return this.supplierAccountService.getOpenReceipts(ctx.companyId, supplierId, query.currencyId);
  }
}

@Controller('purchase-receipts/:purchaseReceiptId/outstanding')
export class PurchaseReceiptOutstandingController {
  constructor(private readonly supplierAccountService: SupplierAccountService) {}

  @RequirePermissions('accounts.payable.read')
  @Get()
  getOutstanding(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('purchaseReceiptId') purchaseReceiptId: string,
  ): Promise<PurchaseReceiptOutstandingResponse> {
    return this.supplierAccountService.getReceiptOutstanding(ctx.companyId, purchaseReceiptId);
  }
}
