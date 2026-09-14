import { CustomerStatus, CustomerTaxCondition } from '@erp/shared';
import type { CustomerLookupItem } from '@erp/shared';

/**
 * The code every company's walk-in "Consumidor Final" customer carries.
 *
 * This is a per-company code, not an id: `Customer.code` is unique per
 * company (see docs/customers.md), so the same literal resolves to a
 * different row in every company and nothing here is ever a hardcoded
 * UUID. The seed pins it (`prisma/seed.ts`: "000001 — required by
 * POS/Facturación's default 'no customer picked yet' fast path. Never
 * renumbered.") and `provision.ts` follows the same numbering for a real
 * installation.
 *
 * A company that does not have this customer is a supported case: POS
 * then simply starts with no customer and the operator picks one, exactly
 * as before this existed.
 */
export const DEFAULT_POS_CUSTOMER_CODE = '000001';

/**
 * Picks the walk-in customer POS should start a sale with, or `null`.
 *
 * Deliberately strict, because getting this wrong means a counter sale is
 * silently invoiced to the wrong account:
 *
 * - **Both** the code and the tax condition must match. `GET
 *   /customers/lookup` searches `code` with a `contains`, so the response
 *   is a superset of what we want; the exact comparison happens here.
 * - `displayName` is never consulted. It is free text an administrator can
 *   rename, and "Consumidor Final S.R.L." is a perfectly plausible real
 *   company.
 * - Status is re-checked even though the endpoint already filters to
 *   ACTIVE server-side (`CustomersService.lookup`). Cheap, and it keeps
 *   the rule "never auto-select an inactive customer" true in this
 *   function rather than only in a caller far away.
 * - More than one match returns `null` rather than picking one. Two rows
 *   cannot normally collide (`code` is unique per company), so an
 *   ambiguous result means an assumption broke — and guessing which
 *   customer gets charged is the one thing this must not do.
 */
export function pickDefaultPosCustomer(
  items: CustomerLookupItem[] | undefined,
): CustomerLookupItem | null {
  if (!items) return null;
  const matches = items.filter(
    (item) =>
      item.code === DEFAULT_POS_CUSTOMER_CODE &&
      item.taxCondition === CustomerTaxCondition.CONSUMIDOR_FINAL &&
      item.status === CustomerStatus.ACTIVE,
  );
  return matches.length === 1 ? matches[0] : null;
}
