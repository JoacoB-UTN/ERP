import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  saveFiscalSettingsSchema,
  type SaveFiscalSettingsInput,
} from '@erp/shared';
import { z } from 'zod';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FiscalSettingsService } from './fiscal-settings.service';
import { ArcaConnectivityService } from './arca-connectivity.service';

@Controller('fiscal/settings')
export class FiscalSettingsController {
  constructor(
    private readonly settings: FiscalSettingsService,
    private readonly connectivity: ArcaConnectivityService,
  ) {}

  @Get()
  @RequirePermissions('configuration.manage')
  get(@CurrentRequestContext() ctx: RequestContext) {
    return this.settings.get(ctx);
  }

  @Put()
  @RequirePermissions('configuration.manage')
  save(
    @CurrentRequestContext() ctx: RequestContext,
    @Body(new ZodValidationPipe(saveFiscalSettingsSchema))
    input: SaveFiscalSettingsInput,
  ) {
    return this.settings.save(ctx, input);
  }

  @Post('connectivity')
  @RequirePermissions('configuration.manage')
  check(
    @Body(new ZodValidationPipe(z.object({}).strict()))
    _input: Record<string, never>,
  ) {
    return this.connectivity.check();
  }
}
