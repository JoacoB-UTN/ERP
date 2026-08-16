import { Controller, Get } from '@nestjs/common';
import type { DashboardSummaryResponse } from '@erp/shared';
import { CompanyScoped } from '../company-context/decorators/company-scoped.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { DashboardService } from './dashboard.service';

/**
 * No single `@RequirePermissions(...)` gate — this aggregates several
 * domains at once and each block is independently permission-filtered
 * inside `DashboardService.getSummary` (see its own doc comment). Same
 * "authenticated + company-scoped, no blanket business permission"
 * pattern as `GET /context/current` (see `CompanyContextController`).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @CompanyScoped()
  @Get('summary')
  getSummary(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<DashboardSummaryResponse> {
    return this.dashboardService.getSummary(ctx);
  }
}
