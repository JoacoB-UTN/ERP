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
import { FiscalAuthorizationService } from './fiscal-authorization.service';
@Controller('fiscal')
export class FiscalAuthorizationController {
  constructor(private readonly service: FiscalAuthorizationService) {}
  @Get('drafts/:id/authorization')
  @RequirePermissions('sales.invoices.read')
  latest(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.latest(ctx, id);
  }
  @Post('drafts/:id/authorize')
  @RequirePermissions('sales.invoices.read', 'sales.invoices.create')
  authorize(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(authorizeFiscalDraftSchema))
    input: AuthorizeFiscalDraftInput,
  ) {
    return this.service.authorize(ctx, id, input);
  }
  @Post('authorizations/:id/reconcile')
  @RequirePermissions('sales.invoices.read', 'sales.invoices.create')
  reconcile(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(z.object({}).strict()))
    _input: Record<string, never>,
  ) {
    return this.service.reconcile(ctx, id);
  }
  @Post('settings/authentication')
  @RequirePermissions('configuration.manage')
  authenticate(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(z.object({}).strict()))
    _input: Record<string, never>,
  ) {
    return this.service.authenticate(ctx);
  }
}
