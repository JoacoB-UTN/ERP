# docs

Start with [AGENTS.md](../AGENTS.md) at the repository root for the
shared rules, then come back here for detail.

## Core

- [architecture.md](architecture.md) — stack, repository map, and what
  owns what, with a high-level diagram.
- [implementation-status.md](implementation-status.md) — what's actually
  DONE / PARTIAL / NOT IMPLEMENTED, verified against code. Read this
  before assuming a module exists.
- [roadmap.md](roadmap.md) — the demo-first milestone plan and the
  high-level full-ERP roadmap.
- [development-workflow.md](development-workflow.md) — real commands
  (install/dev/test/build/migrate/seed), branch naming, PR/merge
  strategy.
- [multi-agent-workflow.md](multi-agent-workflow.md) — how Claude Code,
  Codex, and humans coordinate parallel work safely.

## Domain modules

- [multi-company-architecture.md](multi-company-architecture.md) —
  tenant/company/branch model, request company context, `X-Company-Id`/
  `X-Branch-Id`, frontend company selection and cache isolation.
- [authorization.md](authorization.md) — RBAC model (Role/Permission/
  RolePermission/UserRole), effective permissions, permission guards,
  system roles, application-access permissions, frontend permission
  awareness.
- [audit-architecture.md](audit-architecture.md) — business audit trail
  (AuditLog), difference from application logs, sanitization, transaction
  semantics, company isolation, entity history, Gestión's Auditoría UI.
- [customers.md](customers.md) — customer master (Customer/CustomerAddress/
  CustomerContact/CustomerCategory), CUIT normalization/validation, code
  sequencing, duplicate detection, search, permissions, audit, Gestión's
  `/clientes`, and the lookup contract Facturación's `CustomerPicker`
  consumes.
- [products.md](products.md) — product catalog (Product/ProductVariant/
  ProductCode/ProductCategory/Brand/UnitOfMeasure), the "default variant"
  pattern, SKU/barcode uniqueness, inventory *configuration* vs. stock,
  search/lookup ranking, permissions, audit, Gestión's `/productos`, and
  the future Facturación/POS lookup contract.
- [inventory.md](inventory.md) — warehouses, the `StockMovement` ledger,
  the `InventoryBalance` projection, concurrency-safe stock mutation,
  reservations, initial balances, stock adjustments, permissions, audit,
  Gestión's `/stock`, and the Facturación warehouse-selection foundation.
- [pricing.md](pricing.md) — price lists (Currency/PriceList/
  PriceListItem/PriceHistory), FIXED vs. DERIVED resolution, Decimal-safe
  arithmetic, effective-date/overlap rules, bulk adjustment, permissions,
  audit, Gestión's `/listas-de-precios`, and the Facturación price-list
  selection foundation.
- [sales.md](sales.md) — the demo Sales Core (SalesDocument/
  SalesDocumentLine, document type `SALE` — not a fiscal invoice),
  DRAFT/CONFIRMED/CANCELLED state machine, price snapshotting via
  PricingService, atomic + idempotent confirmation and inventory
  decrement via InventoryService, permissions, audit, Gestión's
  `/ventas`, and what's deferred (fiscal invoicing, AR, ...).
- [facturacion.md](facturacion.md) — the Facturación MVP: a fast
  operational sales UI over the exact same Sales domain sales.md
  describes (zero new endpoints/tables), customer/product/barcode
  lookup, pricing/inventory integration, draft/confirm lifecycle,
  keyboard shortcuts, permissions, company isolation, and current
  limitations (payments, fiscal invoicing, ... still deferred).
- [pos.md](pos.md) — POS mode inside Facturación: the same Sales domain
  and shared infrastructure, plus its one new concept — an optional,
  purely operational `SalesTender` on confirm (cash/card/transfer/other,
  never a Treasury/AR ledger). Keyboard-first checkout flow, payment
  panel, company isolation, Gestión integration, and current limitations
  (cash drawer, payment gateways, refunds, ... still deferred).
- [dashboard.md](dashboard.md) — Gestión's home dashboard: the read-only
  `GET /dashboard/summary` aggregate, permission-based per-field
  omission, currency-safe sales-today aggregation, and how the frontend
  renders it (loading/empty/error states, company isolation).
- [purchases.md](purchases.md) — Suppliers, Purchase Orders (commercial
  intent, never touches stock), and Goods Receipts (the only Purchases
  document that moves inventory), partial receiving and its lock-based
  concurrency guarantee against over-receipt, ARS/USD currency support,
  permissions, audit, Gestión's `/compras`, and what's deferred (accounts
  payable, fiscal purchase invoices, ...).

## Product direction

- [product-ui-principles.md](product-ui-principles.md) — Gestión vs.
  Facturación, POS as a Facturación mode, shared backend, UX direction.

More design docs land here as the platform grows, one file per domain
module — see [architecture.md](architecture.md) for the pattern to
follow.
