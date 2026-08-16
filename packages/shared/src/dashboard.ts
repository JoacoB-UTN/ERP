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
