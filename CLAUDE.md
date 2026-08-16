# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) before making changes.** AGENTS.md contains
the shared repository rules used by all coding agents (Claude Code,
Codex, and humans) — project identity, architecture invariants, required
verification, documentation links, parallel-work rules, and code review
rules. Repository code, tests, and docs are the source of truth, not any
agent's chat history. The instructions below supplement AGENTS.md for
Claude Code specifically and must not contradict it.

This file used to hold the full architecture rulebook; that content now
lives in AGENTS.md (the cross-agent contract) so there's one canonical
copy instead of two. What remains here is implementation detail worth
keeping close at hand — concrete code shapes and gotchas — indexed by the
same modules AGENTS.md covers at a higher level. When in doubt about a
rule's exact wording, AGENTS.md wins.

## Frontend products: Gestión and Facturación

Full detail and rationale: [docs/product-ui-principles.md](docs/product-ui-principles.md)
(read before any frontend UI task). AGENTS.md states the product
boundary; the one thing worth adding here: Facturación (and POS within
it) must optimize for speed and keyboard usage specifically — minimal
navigation/clicks, keyboard shortcuts as first-class, immediate feedback.
Gestión favors progressive disclosure over dense do-everything screens.

## Company context and isolation

[docs/multi-company-architecture.md](docs/multi-company-architecture.md).
The concrete shape of the company-scoping rule:

```
BAD:  prisma.someEntity.findUnique({ where: { id } })
GOOD: prisma.someEntity.findFirst({ where: { id, companyId: ctx.companyId } })
```

Prefer a response that doesn't reveal whether a company/branch the caller
can't access even exists (`CompanyAccessDeniedException` /
`BranchAccessInvalidException`) over one that distinguishes "not found"
from "not yours." Frontend company-scoped queries key their TanStack
Query cache by the active company, e.g. `['company', companyId,
'customers']`, never bare `['customers']`.

## Authorization (RBAC)

[docs/authorization.md](docs/authorization.md). Declare permissions at
the route: `@RequirePermissions('module.resource.action')` in
`apps/api/src/authorization`. Frontend checks
(`usePermissions()`/`can()`/`canAny()`/`canAll()` from `@erp/auth-client`)
are UX only — every real operation is independently gated server-side.

## Audit trail

[docs/audit-architecture.md](docs/audit-architecture.md). Pattern:
`AuditService.record(...)`/`recordFromContext(...)` inside the same
`prisma.$transaction` as the business write (see `RolesService` for the
canonical example). Pre-company-context auth events like LOGIN are the
deliberate exception — best-effort, not transactional (see the doc for
why). Audit describes meaningful domain actions, not raw SQL changes: one
save that changes a role's permission set is one `PERMISSIONS_CHANGE`
record with `permissionsAdded`/`permissionsRemoved`, never N rows for N
join-table changes.

## Customers (master data)

[docs/customers.md](docs/customers.md). No `balance`/`currentBalance`
column on `Customer` — a balance always derives from a future Accounts
Receivable ledger, computed at read time. `Customer.code`/`taxId` are
unique per company, never globally.

## Products (catalog master data)

[docs/products.md](docs/products.md). `Product` answers "what is the
item," never "how many," "how much," or "at what cost" —
`minimumStock`/`maximumStock`/`reorderPoint` are the one allowed
exception (policy configuration, not a balance). Gestión administers the
full catalog; Facturación/POS only ever consume it through `GET
/products/lookup`.

## Inventory (ledger, stock, warehouses)

[docs/inventory.md](docs/inventory.md). The concurrency-safe write shape:
a single atomic upsert-increment (`update: { onHand: { increment: delta } }`),
never read-modify-write — Postgres serializes concurrent writers to the
same row; validate the negative-stock policy against the value Postgres
actually returned, inside the same transaction. `InventoryService.rebuildInventoryBalances()`
is the documented recovery path if a balance and the ledger ever
disagree (the ledger always wins).

## Pricing (price lists, resolution, price history)

[docs/pricing.md](docs/pricing.md). `PricingService.getPrice` returns
`null`/`PRICE_NOT_FOUND` rather than zero. Setting a new price never
edits a historical `PriceListItem` row in place — it creates a new row +
`PriceHistory` row and closes the previous validity range via the
documented auto-close rule. `PRICE_LIST_CYCLE` is rejected at write time
in `PriceListsService`; a DERIVED list's price is always computed at read
time from its base, never materialized.
