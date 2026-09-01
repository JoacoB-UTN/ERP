import { z } from 'zod';
import type { PaginationMeta } from './api';

/**
 * Customer Current Account (Accounts Receivable) — read model over the
 * immutable CustomerAccountMovement ledger. See docs/current-accounts.md.
 *
 * Sign convention (documented once, applied everywhere): a POSITIVE
 * balance means the customer owes the company money. SALE_CHARGE is
 * always +, TENDER_SETTLEMENT/COLLECTION are always -, COLLECTION_REVERSAL
 * is always +. Never sum two different currencies into one number — every
 * balance/statement is always scoped to exactly one currency.
 */

export const customerAccountListQuerySchema = z.object({
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerAccountListQuery = z.infer<typeof customerAccountListQuerySchema>;

export const customerStatementQuerySchema = z.object({
  currencyId: z.string().uuid('Elegí una moneda.'),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});
export type CustomerStatementQuery = z.infer<typeof customerStatementQuerySchema>;

export const customerOpenSalesQuerySchema = z.object({
  currencyId: z.string().uuid('Elegí una moneda.'),
});
export type CustomerOpenSalesQuery = z.infer<typeof customerOpenSalesQuerySchema>;

// ---------- Response DTOs ----------

/** One party's balance in ONE currency — never combined with any other currency's balance. */
export interface CurrencyBalance {
  currencyId: string;
  currencyCode: string;
  /** Signed — see the module doc comment's sign convention. */
  balance: string;
}

export interface CustomerAccountSummary {
  customerId: string;
  code: string;
  legalName: string;
  displayName: string;
  taxId: string | null;
  taxIdFormatted: string | null;
  balances: CurrencyBalance[];
  lastMovementAt: string | null;
}

export interface CustomerAccountListResponse {
  items: CustomerAccountSummary[];
  pagination: PaginationMeta;
}

/**
 * `debit`/`credit` are always non-negative display columns derived
 * server-side from the signed `amount` — see docs/current-accounts.md's
 * "Debe/Haber" convention: Debe = a movement that increases the signed
 * balance (positive amount), Haber = one that decreases it (negative
 * amount). The frontend never re-derives this from the sign itself.
 */
export interface CustomerAccountMovementDto {
  id: string;
  occurredAt: string;
  movementType: string;
  sourceType: string;
  sourceId: string;
  description: string | null;
  debit: string;
  credit: string;
  amount: string;
  runningBalance: string;
}

export interface CustomerStatementResponse {
  customer: { id: string; code: string; legalName: string; displayName: string };
  currencyId: string;
  currencyCode: string;
  openingBalance: string;
  closingBalance: string;
  items: CustomerAccountMovementDto[];
}

export interface CustomerOpenSaleDto {
  id: string;
  number: string;
  occurredAt: string;
  total: string;
  outstanding: string;
}

export interface CustomerOpenSalesResponse {
  currencyId: string;
  currencyCode: string;
  items: CustomerOpenSaleDto[];
}

export interface SalesDocumentOutstandingResponse {
  salesDocumentId: string;
  currencyCode: string;
  total: string;
  outstanding: string;
}
