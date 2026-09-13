import { z } from 'zod';

import type { SalesDocumentSummaryDto } from './sales';

/**
 * A read-only aggregation over already-implemented modules — see
 * docs/dashboard.md and AGENTS.md. Never a new source of truth: every
 * number here is derived from persisted Sales/Customers/Products/
 * Inventory data at read time, the same way the modules' own list
 * endpoints already compute it.
 *
 * Every field is independently nullable: a caller only sees the blocks
 * their own effective permissions allow (`sales.documents.read` for
 * `salesToday`/`openDraftSales`/`recentSales`, `customers.read` for
 * `activeCustomers`, `products.read` for `activeProducts`,
 * `inventory.stock.read` for `belowMinimumStockCount`) — the backend
 * never queries a domain the caller can't read, and the frontend must
 * treat `null` as "not shown," never as zero.
 */
export interface DashboardCurrencyTotal {
  currencyCode: string;
  total: string;
}

export interface DashboardSalesTodayDto {
  count: number;
  totalsByCurrency: DashboardCurrencyTotal[];
}

export interface DashboardSummaryResponse {
  salesToday: DashboardSalesTodayDto | null;
  openDraftSales: number | null;
  recentSales: SalesDocumentSummaryDto[] | null;
  activeCustomers: number | null;
  activeProducts: number | null;
  /** Reuses InventoryService's existing AVAILABLE < Product.minimumStock rule — never an invented threshold. */
  belowMinimumStockCount: number | null;
}

// ---------- Sales series (dashboard chart) ----------

export const dashboardSalesPeriodValues = ['D7', 'D30', 'M12'] as const;
export type DashboardSalesPeriod = (typeof dashboardSalesPeriodValues)[number];

export const dashboardSalesSeriesQuerySchema = z.object({
  period: z.enum(dashboardSalesPeriodValues).default('D30'),
});
export type DashboardSalesSeriesQuery = z.infer<typeof dashboardSalesSeriesQuerySchema>;

export const DASHBOARD_SALES_PERIOD_LABELS: Record<DashboardSalesPeriod, string> = {
  D7: '7 días',
  D30: '30 días',
  M12: '12 meses',
};

/** One bucket of the chart: a company-local day or month. */
export interface DashboardSalesBucketDto {
  /** Start of the bucket, as an instant. */
  startsAt: string;
  /** `YYYY-MM-DD` for a day bucket, `YYYY-MM` for a month one — already in company-local time. */
  key: string;
  total: string;
  count: number;
}

/**
 * Amount and count for one window, plus the average ticket.
 *
 * `averageTicket` is computed server-side with Decimal, not as
 * `amount / count` in the browser — dividing two money strings by
 * casting them to JS numbers is exactly the rounding the money rules
 * exist to prevent (see AGENTS.md).
 */
export interface DashboardSalesTotalsDto {
  amount: string;
  count: number;
  averageTicket: string;
}

/**
 * The chart's data, plus the same window immediately before it so each
 * figure can show how it moved.
 *
 * Single-currency on purpose: `currencyCode` is whichever currency has the
 * most confirmed sales in the window, and `otherCurrencyCodes` names the
 * ones left out. Adding up sales in different currencies would produce a
 * number that means nothing, and silently charting only one without
 * saying so would be worse (see docs/dashboard.md).
 *
 * `changePercent` is null rather than 0 when the previous window had
 * nothing: "no change" and "nothing to compare against" are different
 * facts, and a 0% next to a first-ever sale would be a lie.
 */
export interface DashboardSalesSeriesResponse {
  period: DashboardSalesPeriod;
  currencyCode: string | null;
  otherCurrencyCodes: string[];
  buckets: DashboardSalesBucketDto[];
  current: DashboardSalesTotalsDto;
  previous: DashboardSalesTotalsDto;
  change: {
    amountPercent: number | null;
    countPercent: number | null;
    averageTicketPercent: number | null;
  };
}
