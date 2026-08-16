import { Controller, Get } from '@nestjs/common';
import type { EffectivePermissionsResponse } from '@erp/shared';
import { CompanyScoped } from '../company-context/decorators/company-scoped.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { AuthorizationService } from './authorization.service';

/**
 * Lives under /context (alongside company-context's own endpoints) rather
 * than requiring its own permission — knowing your own effective
 * permissions can't itself require a permission, or no one could ever
 * discover what they're missing. Guarded only by @CompanyScoped(): valid
 * session + valid company context, nothing more.
 */
@Controller('context')
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @CompanyScoped()
  @Get('permissions')
  async permissions(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<EffectivePermissionsResponse> {
    const permissions = await this.authorizationService.getUserPermissions(
      ctx.userId,
      ctx.companyId,
    );
    return { permissions };
  }
}
