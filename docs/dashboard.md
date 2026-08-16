# Dashboard (Gestión home summary)

This document covers `GET /dashboard/summary`, `DashboardService`, and
Gestión's home route (`/`). Read this before touching
`apps/api/src/dashboard` or `apps/gestion/src/app/(app)/page.tsx`.

## What this module is — and isn't

The dashboard is a **read-only aggregation view** over already-implemented
modules (Sales, Customers, Products, Inventory). It owns no business rule
and no persisted state of its own — every value is derived at read time
from data those modules already own. It exists to answer three questions
on Gestión's home screen: what needs attention, what happened recently,
and where to go next — not to become a second source of truth for any of
the domains it summarizes.

It is explicitly **not** a general-purpose reporting/BI layer: no
historical trend comparisons, no fabricated growth percentages, no
configurable widgets. See [product-ui-principles.md](product-ui-principles.md)
for the product rationale.

## `GET /dashboard/summary`

Guarded by `@CompanyScoped()` only — the same "authenticated + resolved
company context, no single blanket permission" pattern
`CompanyContextController` uses for `GET /context/current`. A route-level
permission would be wrong here because the response is a *composite* of
several domains the caller may have different access to; instead,
`DashboardService.getSummary()` calls
`AuthorizationService.getUserPermissions(userId, companyId)` once (the
same Redis-cached lookup `PermissionGuard` itself uses) and independently
gates each field:

| Field                    | Requires permission        | Delegates to                                    |
| ------------------------ | --------------------------- | ------------------------------------------------ |
| `salesToday`              | `sales.documents.read`      | new `groupBy` aggregation (see below)             |
| `openDraftSales`          | `sales.documents.read`      | `SalesService.list({ status: 'DRAFT' })`          |
| `recentSales`             | `sales.documents.read`      | `SalesService.list({ status: 'CONFIRMED' })`      |
| `activeCustomers`         | `customers.read`            | `prisma.customer.count()`                         |
| `activeProducts`          | `products.read`             | `prisma.product.count()`                          |
| `belowMinimumStockCount`  | `inventory.stock.read`      | `InventoryService.listStock({ belowMinimum: true })` |

A field the caller can't see is `null`, never `0` and never omitted from
the response shape — the frontend renders `null` as "not shown," and must
never coerce it to zero. This is why every field on
`DashboardSummaryResponse` (`packages/shared/src/dashboard.ts`) is
independently nullable.

Every block that has an existing owning service call goes through that
service (`SalesService.list`, `InventoryService.listStock`) rather than a
duplicate query — in particular, `belowMinimumStockCount` reuses
Inventory's existing `AVAILABLE < Product.minimumStock` rule verbatim.
There is no dashboard-specific "low stock" threshold; if a company hasn't
set `Product.minimumStock`, that product simply never counts here, matching
`InventoryService`'s own behavior.

`salesToday` is the one genuinely new aggregation, because no existing
endpoint returns a currency-safe sum of confirmed sales for "today." It is
computed via a single Prisma `groupBy`:

```ts
prisma.salesDocument.groupBy({
  by: ['currencyId'],
  where: { companyId, status: 'CONFIRMED', confirmedAt: { gte: start, lt: end } },
  _sum: { total: true },
  _count: { _all: true },
});
```

Grouped **by currency** — if a company ever has confirmed sales in more
than one currency on the same day, they are never blended into one
misleading total. Each group's `_sum.total` is a Prisma `Decimal`,
converted with `.toString()`; the frontend renders it with the shared
`formatMoney()` helper and must never do `Number(total)` /
`parseFloat(total)` / floating-point summation on it.

### "Hoy" means `confirmedAt`, in the company's own timezone

Two things anchor "Ventas confirmadas hoy," both deliberate:

1. **The field is `confirmedAt`, never `occurredAt`.** `occurredAt` is a
   sale's editable business/backdating date (see [sales.md](sales.md)) —
   a draft created yesterday and confirmed today must count as confirmed
   today; a sale dated today but actually confirmed on a different day
   must not. Filtering on `occurredAt` would get both of those wrong.
2. **"Today" is the calendar day in the active `Company.timezone`
   (an IANA zone, e.g. `America/Argentina/Buenos_Aires`), never the API
   server's own process/OS timezone.** A server process running in UTC
   must report the same "today" a person in Buenos Aires would mean by
   it — company data must respect company context, the same rule that
   governs every other company-scoped read in this codebase.

The day boundary is computed **in Postgres**, not hand-rolled in JS,
because Node has no built-in authority to convert an arbitrary IANA
zone's wall-clock midnight back into a UTC instant — Postgres's `AT TIME
ZONE` operator does, and is DST-aware for any real zone:

```sql
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
```

`c.timezone` is bound as an ordinary query parameter — `AT TIME ZONE`
takes a text expression, so this carries no injection risk and no zone is
ever hardcoded. The boundaries come back as explicit-UTC ISO-8601 strings
(`to_char(... AT TIME ZONE 'UTC', ...)`), not as raw `timestamptz` values,
and `DashboardService` parses them itself with `new Date(...)` — **not**
by trusting the pg driver's default `$queryRaw` DateTime parsing. That
parsing is only reliable when the database session's own `TimeZone` GUC
is UTC; under a non-UTC session timezone (this project's dev database
defaults to `America/Argentina/Buenos_Aires`) it silently drops the row's
offset instead of applying it, corrupting the returned instant by exactly
that offset. Formatting to an explicit-UTC string server-side and parsing
it in JS sidesteps that behavior entirely, regardless of session
timezone — do not revert to returning bare `timestamptz` columns from
this query without re-verifying against a non-UTC session.

Server timezone is irrelevant to any of this — the whole point is that it
never enters the calculation.

## Wording

Sales here are **internal commercial sales**, not fiscal invoices — see
[sales.md](sales.md). Dashboard copy must never imply fiscal revenue,
invoiced tax revenue, or accounting-recognized income. Use "Ventas
confirmadas hoy" / "Total operado hoy" / "Ventas recientes"; never
"Facturación fiscal" / "Ingresos contables" / "IVA facturado."

## Frontend

`useDashboardSummary()` (`packages/auth-client/src/dashboard-hooks.ts`)
fetches once per active company, keyed `['company', companyId,
'dashboard', 'summary']` — the standard company-scoped TanStack Query key
shape, so switching companies never shows stale data from the previous
one. Gestión's home page (`apps/gestion/src/app/(app)/page.tsx`) renders:

- A compact summary grid (only the fields the caller's permissions
  produced a non-null value for), with loading skeletons while the query
  is in flight — the page never flashes `0` / `$0` before data arrives.
- A recent confirmed sales table, each row linking to the existing sale
  detail page.
- A small set of permission-gated quick actions, each linking to a screen
  that already exists (no links to unimplemented modules).

Because the whole page is backed by one aggregate request, a failed
request is handled as one retryable error state (a compact "no pudimos
cargar el resumen" box with a retry button) rather than per-widget partial
failure — deliberately, to avoid overengineering a single-request page.
