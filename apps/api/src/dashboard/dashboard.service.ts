import { Injectable } from '@nestjs/common';
import type { DashboardSummaryResponse } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { InventoryService } from '../inventory/inventory.service';
import { SalesService } from '../sales/sales.service';
import type { RequestContext } from '../company-context/types';

/**
 * A read-only aggregation over already-implemented modules — see
 * docs/dashboard.md. This service owns NO business rule: every number is
 * either a direct company-scoped count/sum against already-persisted
 * data, or delegated to the owning service (`SalesService.list` for
 * recent sales/open drafts, `InventoryService.listStock` for the
 * existing AVAILABLE < Product.minimumStock rule — never a re-implemented
 * threshold, see docs/inventory.md).
 *
 * Every block is independently gated by the caller's own effective
 * permissions (via `AuthorizationService`, the same source
 * `PermissionGuard` uses) — a user who can't read a domain never causes
 * this service to query it, matching every other module's authorization
 * rule (see CLAUDE.md).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly inventoryService: InventoryService,
    private readonly salesService: SalesService,
  ) {}

  async getSummary(ctx: RequestContext): Promise<DashboardSummaryResponse> {
    const permissions = await this.authorizationService.getUserPermissions(
      ctx.userId,
      ctx.companyId,
    );
    const has = (code: string) => permissions.includes(code);

    const [
      salesToday,
      openDraftSales,
      recentSales,
      activeCustomers,
      activeProducts,
      belowMinimumStockCount,
    ] = await Promise.all([
      has('sales.documents.read')
        ? this.getSalesToday(ctx.companyId)
        : Promise.resolve(null),
      has('sales.documents.read')
        ? this.getOpenDraftCount(ctx.companyId)
        : Promise.resolve(null),
      has('sales.documents.read')
        ? this.getRecentConfirmedSales(ctx.companyId)
        : Promise.resolve(null),
      has('customers.read')
        ? this.getActiveCustomerCount(ctx.companyId)
        : Promise.resolve(null),
      has('products.read')
        ? this.getActiveProductCount(ctx.companyId)
        : Promise.resolve(null),
      has('inventory.stock.read')
        ? this.getBelowMinimumStockCount(ctx.companyId)
        : Promise.resolve(null),
    ]);

    return {
      salesToday,
      openDraftSales,
      recentSales,
      activeCustomers,
      activeProducts,
      belowMinimumStockCount,
    };
  }

  /**
   * "Today" for a company means the current calendar day in *that
   * company's own* IANA timezone (`Company.timezone`), never the API
   * server's process timezone — a server running in UTC must not report
   * a different "today" than the same instant would mean in Buenos
   * Aires. Computed entirely in Postgres (`AT TIME ZONE`, which is
   * DST-aware for any real IANA zone) rather than hand-rolled in JS,
   * since Node has no reliable way to convert a wall-clock day boundary
   * in an arbitrary IANA zone back to a UTC instant without a timezone
   * database of its own. The zone name is bound as a query parameter —
   * `AT TIME ZONE` accepts a text expression, so this is fully
   * parameterized and carries no injection risk. See docs/dashboard.md.
   */
  private async getCompanyLocalDayRange(
    companyId: string,
  ): Promise<{ start: Date; end: Date }> {
    // The two boundaries are returned as `to_char`-formatted UTC ISO-8601
    // strings (explicit "Z"), not as raw `timestamptz` values — the pg
    // driver's default DateTime parsing for `$queryRaw` results is only
    // reliable when the database session's own `TimeZone` GUC is UTC;
    // under a non-UTC session timezone (this one runs
    // America/Argentina/Buenos_Aires) it silently drops the row's offset
    // instead of applying it, corrupting the instant by exactly that
    // offset. Formatting to an unambiguous UTC string server-side and
    // parsing it with `new Date()` ourselves sidesteps that driver
    // behavior entirely, regardless of session timezone.
    const rows = await this.prisma.$queryRaw<
      Array<{ start: string; end: string }>
    >`
      SELECT
        to_char(
          (date_trunc('day', now() AT TIME ZONE c.timezone) AT TIME ZONE c.timezone) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS start,
        to_char(
          ((date_trunc('day', now() AT TIME ZONE c.timezone) + interval '1 day') AT TIME ZONE c.timezone) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) AS "end"
      FROM companies c
      WHERE c.id = ${companyId}::uuid
    `;
    const [range] = rows;
    if (!range) {
      throw new Error(
        `Company ${companyId} not found while computing dashboard day range`,
      );
    }
    return { start: new Date(range.start), end: new Date(range.end) };
  }

  /**
   * "Confirmadas hoy" is anchored to `confirmedAt` — the moment the sale
   * was actually confirmed — never `occurredAt` (the sale's editable
   * business/backdating date, see docs/sales.md). A draft created
   * yesterday and confirmed today belongs in today's confirmed count; a
   * sale merely dated today but confirmed a different local day does
   * not.
   *
   * Prisma `groupBy` + `_sum` — a real SQL SUM over Decimal columns,
   * never JS-number accumulation. Grouped by currency so sales in
   * different currencies are never blended into one misleading figure.
   */
  private async getSalesToday(companyId: string) {
    const { start, end } = await this.getCompanyLocalDayRange(companyId);
    const groups = await this.prisma.salesDocument.groupBy({
      by: ['currencyId'],
      where: {
        companyId,
        status: 'CONFIRMED',
        confirmedAt: { gte: start, lt: end },
      },
      _sum: { total: true },
      _count: { _all: true },
    });
    if (groups.length === 0) return { count: 0, totalsByCurrency: [] };

    const currencies = await this.prisma.currency.findMany({
      where: { id: { in: groups.map((g) => g.currencyId) } },
      select: { id: true, code: true },
    });
    const codeById = new Map(currencies.map((c) => [c.id, c.code]));

    return {
      count: groups.reduce((sum, g) => sum + g._count._all, 0),
      totalsByCurrency: groups.map((g) => ({
        currencyCode: codeById.get(g.currencyId) ?? '?',
        total: (g._sum.total ?? 0).toString(),
      })),
    };
  }

  private async getOpenDraftCount(companyId: string): Promise<number> {
    const result = await this.salesService.list(companyId, {
      status: 'DRAFT',
      page: 1,
      pageSize: 1,
    });
    return result.pagination.total;
  }

  private async getRecentConfirmedSales(companyId: string) {
    const result = await this.salesService.list(companyId, {
      status: 'CONFIRMED',
      page: 1,
      pageSize: 5,
    });
    return result.items;
  }

  private getActiveCustomerCount(companyId: string): Promise<number> {
    return this.prisma.customer.count({
      where: { companyId, status: 'ACTIVE' },
    });
  }

  private getActiveProductCount(companyId: string): Promise<number> {
    return this.prisma.product.count({
      where: { companyId, status: 'ACTIVE' },
    });
  }

  private async getBelowMinimumStockCount(companyId: string): Promise<number> {
    const result = await this.inventoryService.listStock(companyId, {
      belowMinimum: true,
      page: 1,
      pageSize: 1,
    });
    return result.pagination.total;
  }
}
