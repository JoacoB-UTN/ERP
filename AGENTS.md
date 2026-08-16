# AGENTS.md

Shared instructions for every coding agent working in this repository —
Claude Code, OpenAI Codex, and any future agent that reads `AGENTS.md`.
Human contributors should read it too. `CLAUDE.md` supplements this file
with Claude-specific guidance and must not contradict it.

## Project identity

This is **erp-platform**, a multi-tenant, multi-company ERP. The backend
is a single modular monolith (`apps/api`) shared by **two separate
frontend products**:

- **Gestión** (`apps/gestion`) — the ERP backoffice/administration app.
- **Facturación** (`apps/facturacion`) — the fast operational sales app.
  **POS is a mode inside Facturación**, not a separate app or backend —
  see `docs/pos.md` and `docs/implementation-status.md`.

Both frontends call the same API, the same database, the same users,
companies, Customers, Products, Inventory, and Pricing. Never create a
duplicate/parallel business system for Facturación — see
`docs/product-ui-principles.md` for the full product boundary and UX
direction. The product may be functionally inspired by mature ERP
software (e.g. Tango) but must never visually clone it — no copied
branding, layout, or visual identity.

## Source of truth

The repository — code, migrations, tests, and documentation — is the
source of truth. Do not rely on previous chat history from any agent
session. Before changing a module, inspect the existing implementation
and the relevant docs under `docs/`; do not assume a module's state from
a prior conversation or from this file's own descriptions if the code
says otherwise. If documentation and code disagree, **code wins** — fix
the documentation.

Start here, in order:

1. `docs/implementation-status.md` — what actually exists right now.
2. `docs/architecture.md` — how the system is put together.
3. The specific `docs/<module>.md` for whatever you're touching.
4. `docs/roadmap.md` — what's planned next and why.

## Architecture invariants

These rules are permanent. Violating them is a defect, not a style
choice.

- **Modular monolith.** One backend (`apps/api`), one database. Business
  logic belongs in application/domain services (`apps/api/src/<module>/*.service.ts`);
  controllers stay thin (validation + delegation, no business rules).
- **All company-owned data is company-scoped.** Every lookup of a
  company-owned entity is scoped by the validated `companyId` from
  `RequestContext` — never `findUnique({ where: { id } })` alone.
- **Never trust company ownership from request payloads.** `companyId`/
  `tenantId` sent by a client is never authorization by itself; it's
  always re-validated against the authenticated user's active
  membership.
- **Authentication, company context, and authorization are separate
  concepts.** Authentication answers "who." Company context answers
  "which company, right now." Authorization answers "what they may do
  there." Don't fold one into another.
- **Roles are permission bundles. Authorize using permissions, not role
  names.** Never `if (role === 'ADMIN')`. Always
  `@RequirePermissions('module.resource.action')`.
- **Financial values use Decimal-safe arithmetic.** `Prisma.Decimal`
  everywhere money or a pricing-adjustment magnitude is involved. Never
  floating point, never `Math.round(x * 100) / 100`.
- **Inventory is ledger-based.** `StockMovement` is the only
  authoritative source of physical inventory. `InventoryBalance` is a
  rebuildable projection, never a second source of truth. Never store
  authoritative stock on `Product`/`ProductVariant`/`Warehouse`.
  Reservations affect `RESERVED`/`AVAILABLE`, never `ON_HAND`.
- **Products do not own authoritative sale prices.** Sale prices belong
  to `PriceList`/`PriceListItem`/`ProductVariant`, resolved only through
  `PricingService`. A missing price is never silently zero.
- **A confirmed sale (`SalesDocument`) is immutable through normal
  editing**, and each confirmed, inventory-tracked line produces a real
  `StockMovement` (never a hardcoded projection). A line's price/
  description is a snapshot taken at confirmation time — never
  re-resolved from the current `Product`/`PriceListItem` afterward. There
  is one sales domain (`SalesService`); Facturación/POS call it, never
  duplicate it.
- **`SalesTender` (POS/Facturación payment metadata) is an operational
  snapshot, not a Treasury ledger.** Confirming a sale with a tender
  never updates a cash balance, bank balance, or customer account — see
  `docs/pos.md`. Do not wire it into any future Treasury/AR module
  without a deliberate, separate design decision.
- **Confirmed financial/inventory transactions are not physically
  deleted.** Corrections are new, reversing entries — never an edit or
  delete of history (`StockMovement`, confirmed `StockAdjustment`,
  historical `PriceListItem`/`PriceHistory` rows).
- **Critical mutations should be auditable**, and never place secrets,
  passwords, or tokens in `AuditLog`.
- **Gestión and Facturación share domain logic.** Never duplicate
  backend/domain logic inside a frontend application — both call the
  same shared packages (`packages/shared`, `packages/auth-client`)
  against the same API.
- **Do not visually clone Tango** or any existing ERP's branding/layout.
  Prefer simple UX and progressive disclosure over dense,
  do-everything screens.

For the full rationale and detail behind each of these, see the relevant
`docs/*.md` — this file states the rule, the docs explain why.

## Required verification

Before considering meaningful changes complete, run what's relevant to
what you touched (see `docs/development-workflow.md` for exact commands):

```
lint
typecheck
tests (unit + e2e where relevant)
production build
```

Run migrations and the seed when you changed the Prisma schema. Do not
report a task as done without having actually run these — "should work"
is not verification.

## Documentation links

Do not duplicate module documentation into this file. Point to it
instead:

- `docs/architecture.md` — stack, structure, high-level diagram.
- `docs/implementation-status.md` — what's DONE / PARTIAL / NOT
  IMPLEMENTED, verified against code.
- `docs/roadmap.md` — demo-first milestone plan and full ERP roadmap.
- `docs/development-workflow.md` — real commands for install/dev/test/build.
- `docs/multi-agent-workflow.md` — how Claude Code and Codex coordinate.
- `docs/<module>.md` — one per implemented domain module (customers,
  products, inventory, pricing, authorization, audit trail, multi-company).

## Parallel-work rules

Summarized here; full detail and examples in
`docs/multi-agent-workflow.md`.

- Parallel agent work is fine when task scopes are genuinely independent.
- Never assign two agents simultaneous ownership of the same core
  implementation area without explicit coordination.
- Sensitive shared files/areas — coordinate before touching them from two
  branches at once: Prisma schema, database migrations, the seed script,
  the lockfile, authentication, `RequestContext`, RBAC, audit
  infrastructure, shared API contracts (`packages/shared`), shared UI
  packages, root configuration.
- A task must not start from `main` if it depends on another task that's
  still unmerged — branch from that task's branch instead, or wait for
  merge. Don't develop against a repository state you know is stale.
- Work on a dedicated branch (`feature/<name>`, `fix/<name>`,
  `agent/codex-<task>`, `agent/claude-<task>`), open a Pull Request, run
  verification, and let a human merge. Don't develop directly on `main`.

## Code Review Rules

When reviewing a PR (agent or human), prioritize, in order:

1. Company/tenant isolation regressions.
2. Permission bypasses (role-name checks, missing `@RequirePermissions`).
3. Money/Decimal bugs (floating point, wrong rounding, silent
   truncation).
4. Inventory ledger integrity (anything writing a stock number outside
   `StockMovement`/`InventoryService`).
5. Pricing history corruption (an in-place edit of a historical price
   row instead of a new row + closed validity range).
6. Transaction atomicity (a mutation and its audit/history/balance
   update not sharing one `$transaction`).
7. Migration safety (destructive changes to columns with data, missing
   backfill).
8. Secret leakage (in code, logs, `AuditLog`, or committed files).
9. Missing tests for a critical business rule.
10. Duplicated Gestión/Facturación domain logic.

Also verify business mutations respect audit requirements where
applicable (see `docs/audit-architecture.md`).

### Critical red flags — reject on sight

- Updating `Product.stock` or `ProductVariant.stock` directly.
- Treating `InventoryBalance` as authoritative history instead of a
  rebuildable projection.
- Storing `product.price` (or similar) as authoritative pricing.
- Floating point for monetary calculations.
- Querying a company-owned entity without company scoping.
- Authorizing with a role-name check instead of a permission check.
- Trusting `companyId`/`tenantId` from a request body.
- Destructively deleting a confirmed financial/inventory record.
- Storing a password/token/secret in `AuditLog`.
- Duplicating backend business rules inside Facturación instead of
  calling the shared API/domain layer.

## Human collaboration

Agents may implement and review code, but humans remain responsible for
merging PRs, resolving ambiguous business decisions, reviewing
destructive migrations, managing production secrets, and approving
production deployment. Never make an irreversible production decision
silently.
