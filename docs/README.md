# docs

- [product-ui-principles.md](product-ui-principles.md) — Gestión vs.
  Facturación, POS as a Facturación mode, shared backend, UX direction.
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
  `/clientes`, and the future Facturación lookup contract.
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

More design docs/ADRs will land here as the platform grows (domain module
contracts, accounting/inventory ledger design, etc.).
