import { Controller, Get, Query } from '@nestjs/common';
import {
  dashboardSalesSeriesQuerySchema,
  type DashboardSalesSeriesQuery,
  type DashboardSalesSeriesResponse,
  type DashboardSummaryResponse,
} from '@erp/shared';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { CompanyScoped } from '../company-context/decorators/company-scoped.decorator';
import { CurrentRequestContext } from '../company-context/decorators/current-request-context.decorator';
import type { RequestContext } from '../company-context/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { DashboardService } from './dashboard.service';
import { SalesSeriesService } from './sales-series.service';

/**
 * No single `@RequirePermissions(...)` gate — this aggregates several
 * domains at once and each block is independently permission-filtered
 * inside `DashboardService.getSummary` (see its own doc comment). Same
 * "authenticated + company-scoped, no blanket business permission"
 * pattern as `GET /context/current` (see `CompanyContextController`).
 */
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly salesSeriesService: SalesSeriesService,
  ) {}

  @CompanyScoped()
  @Get('summary')
  getSummary(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<DashboardSummaryResponse> {
    return this.dashboardService.getSummary(ctx);
  }

  /**
   * Unlike the summary above, this one IS a single-domain read, so it
   * carries the ordinary sales permission rather than filtering blocks
   * internally.
   */
  @RequirePermissions('sales.documents.read')
  @Get('sales-series')
  getSalesSeries(
    @CurrentRequestContext() ctx: RequestContext,
    @Query(new ZodValidationPipe(dashboardSalesSeriesQuerySchema))
    query: DashboardSalesSeriesQuery,
  ): Promise<DashboardSalesSeriesResponse> {
    return this.salesSeriesService.getSeries(ctx.companyId, query.period);
  }
}
