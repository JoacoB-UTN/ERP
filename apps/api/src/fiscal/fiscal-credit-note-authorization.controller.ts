import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  authorizeFiscalDraftSchema,
  type AuthorizeFiscalDraftInput,
} from '@erp/shared';
import { z } from 'zod';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FiscalCreditNoteAuthorizationService } from './fiscal-credit-note-authorization.service';
@Controller('fiscal')
export class FiscalCreditNoteAuthorizationController {
  constructor(private readonly service: FiscalCreditNoteAuthorizationService) {}
  @Get('credit-notes/:id/authorization')
  @RequirePermissions('sales.invoices.read')
  latest(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.latest(ctx, id);
  }
  @Post('credit-notes/:id/authorize')
  @RequirePermissions('sales.invoices.read', 'sales.invoices.create')
  authorize(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(authorizeFiscalDraftSchema))
    input: AuthorizeFiscalDraftInput,
  ) {
    return this.service.authorize(ctx, id, input);
  }
  @Post('credit-note-authorizations/:id/reconcile')
  @RequirePermissions('sales.invoices.read', 'sales.invoices.create')
  reconcile(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({}).strict()))
    _input: Record<string, never>,
  ) {
    return this.service.reconcile(ctx, id);
  }
}
