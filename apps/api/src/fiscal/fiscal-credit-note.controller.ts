import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  saveFiscalCreditNoteSchema,
  type SaveFiscalCreditNoteInput,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FiscalCreditNoteService } from './fiscal-credit-note.service';
@Controller('fiscal/authorizations/:originalId/credit-note-draft')
export class FiscalCreditNoteController {
  constructor(private readonly service: FiscalCreditNoteService) {}
  @Get()
  @RequirePermissions('sales.invoices.read')
  get(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('originalId', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(ctx, id);
  }
  @Post()
  @RequirePermissions('sales.invoices.read', 'sales.invoices.create')
  save(
    @CurrentRequestContext() ctx: RequestContext,
    @Param('originalId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveFiscalCreditNoteSchema))
    input: SaveFiscalCreditNoteInput,
  ) {
    return this.service.save(ctx, id, input);
  }
}
