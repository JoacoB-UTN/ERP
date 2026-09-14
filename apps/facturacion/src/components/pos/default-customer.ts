import { CustomerStatus, CustomerTaxCondition } from '@erp/shared';
import type { CustomerLookupItem } from '@erp/shared';

/**
 * The code every company's walk-in "Consumidor Final" customer carries.
 *
 * This is a per-company code, not an id: `Customer.code` is unique per
 * company (see docs/customers.md), so the same literal resolves to a
 * different row in every company and nothing here is ever a hardcoded
 * UUID.
 *
 * **It is a convention, not a guarantee.** The demo seed pins it
 * (`prisma/seed.ts`: "000001 — required by POS/Facturación's default 'no
 * customer picked yet' fast path. Never renumbered."). A real
 * installation does NOT get it for free: `provision.ts` deliberately
 * creates zero customers — only the company, the administrator,
 * permissions, roles and currencies — so on a fresh install the row has
 * to arrive by hand or, later, through the migration from Tango.
 *
 * Until an exact match exists, POS simply starts with no customer and the
 * operator picks one, exactly as before this existed. That is a supported
 * state, not a degraded one.
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
 *   Note the endpoint also caps and orders its result (by `legalName`,
 *   not by code), so a match is not *guaranteed* to be in the page we
 *   asked for — see the caller. Missing it degrades to manual selection,
 *   which is why a capped search is acceptable here at all.
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
