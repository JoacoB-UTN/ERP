import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  fiscalDraftInputSchema,
  fiscalDraftsQuerySchema,
  refreshFiscalIdentitySchema,
  saveFiscalDraftSchema,
  type FiscalDraftInput,
  type FiscalDraftsQuery,
  type RefreshFiscalIdentityInput,
  type SaveFiscalDraftInput,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FiscalService } from './fiscal.service';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}
  @Get('drafts')
  @RequirePermissions('sales.invoices.read')
  list(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(fiscalDraftsQuerySchema))
    query: FiscalDraftsQuery,
  ) {
    return this.fiscal.list(ctx.companyId, query);
  }
  @Get('drafts/:id')
  @RequirePermissions('sales.invoices.read')
  get(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fiscal.getById(ctx.companyId, id);
  }
  @Post('drafts/:id/refresh-identity')
  @RequirePermissions(
    'sales.invoices.read',
    'sales.invoices.create',
    'sales.documents.read',
  )
  refreshIdentity(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(refreshFiscalIdentitySchema))
    input: RefreshFiscalIdentityInput,
  ) {
    return this.fiscal.refreshIdentity(ctx, id, input);
  }
  @Get('sales/:saleId/draft')
  @RequirePermissions('sales.invoices.read')
  forSale(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
  ) {
    return this.fiscal.getForSale(ctx.companyId, saleId);
  }
  @Get('sales/:saleId/source')
  @RequirePermissions('sales.invoices.create', 'sales.documents.read')
  source(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
  ) {
    return this.fiscal.getSource(ctx.companyId, saleId);
  }
  @Post('sales/:saleId/preview')
  @RequirePermissions('sales.invoices.create', 'sales.documents.read')
  preview(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body(new ZodValidationPipe(fiscalDraftInputSchema))
    input: FiscalDraftInput,
  ) {
    return this.fiscal.preview(ctx.companyId, saleId, input);
  }
  @Post('sales/:saleId/draft')
  @RequirePermissions('sales.invoices.create', 'sales.documents.read')
  save(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('saleId', ParseUUIDPipe) saleId: string,
    @Body(new ZodValidationPipe(saveFiscalDraftSchema))
    input: SaveFiscalDraftInput,
  ) {
    return this.fiscal.save(ctx, saleId, input);
  }
}
