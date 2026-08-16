# Products (catalog master data)

This document covers the product catalog module: what it models, how
ownership/search/validation work, and what's deliberately deferred. Read
this before touching `apps/api/src/products` or Gestión's `/productos`.

See also [authorization.md](authorization.md) (the `products.*`
permissions), [audit-architecture.md](audit-architecture.md) (how product
mutations are audited), [customers.md](customers.md) (the sibling master
module this one deliberately mirrors), and the root
[CLAUDE.md](../CLAUDE.md) for the permanent rules extracted from this doc.

## What this module is — and isn't

`Product` describes **what** the company sells, buys, manufactures, or
manages. It is not inventory, not a price, and not a cost:

- **No stock balance.** `stock`/`availableStock`/`reservedStock` do not
  exist as columns on `Product` or `ProductVariant`, now or ever — see
  CLAUDE.md. A future Inventory module will compute stock from a ledger
  of movements/reservations. `minimumStock`/`maximumStock`/`reorderPoint`
  are the one exception: they're stock *policy*, not a stock *balance*.
- **No authoritative price.** No `price`/`salePrice`/`wholesalePrice`
  column — a future Price List module will hold that, because the same
  product can have several simultaneous prices (retail, wholesale,
  e-commerce...).
- **No cost.** No `averageCost`/`lastCost` — that belongs to future
  Inventory valuation/Purchases.
- **No tax calculation.** Product doesn't know how to compute invoice
  taxes; that's a future Tax/Fiscal module's job.

This task implements product identity, classification (category/brand/
unit), inventory *configuration* (not quantities), variants, and alternate
codes (SKU/barcode/supplier/etc.) — enough for future Stock, Price List,
Purchases, and Sales/POS modules to build on. See "Deferred" at the end
for the full list of what's intentionally not here yet.

## Company ownership

`Product`, `ProductCategory`, `Brand`, `UnitOfMeasure`, and
`ProductCodeSequence` all carry `tenantId` + `companyId` and are scoped by
the validated `RequestContext.companyId` on every read/write — never a
client-supplied value, never an `id`-only lookup (see CLAUDE.md).
`ProductVariant` doesn't carry its own `companyId` — company ownership is
validated transitively through its parent `Product` first
(`findScopedOrThrow` in `ProductsService`), then the variant is looked up
by its own id *and* the now-validated parent id. `ProductCode` **does**
carry `companyId` directly (denormalized from its variant's product) —
that's a deliberate exception, made because barcode/SKU lookups are
explicitly performance-sensitive (a future POS scanning a barcode) and a
company-scoped index directly on `ProductCode` avoids a join on that hot
path.

Units of measure are **always company-scoped** (no nullable-`companyId`
"system unit" rows) — every other master entity in this codebase is
company-scoped, and a null-company row would need a one-off isolation
rule for little benefit at this stage. The dev seed creates the same
standard 8-unit set (UN, KG, G, L, ML, M, M², M³) for every company
instead. This was an explicit choice between two designs the task spec
allowed; documented here per its request.

## Product type and status

```
ProductType:   PRODUCT | SERVICE | KIT | MANUFACTURED
ProductStatus: ACTIVE | INACTIVE
```

`KIT` and `MANUFACTURED` exist as machine values only — no BOM/kit
composition, no manufacturing recipes exist yet (see "Deferred"). Status
is never physically deleted; `deactivate`/`reactivate` endpoints flip
`status` instead, so future Stock/Sales references never dangle.

## Product code and auto-generation

Every product has a human-readable, company-scoped code
(`@@unique([companyId, code])`), auto-generated via `ProductCodeSequence`
— one row per company, incremented with a single atomic Prisma `upsert`
(`INSERT ... ON CONFLICT DO UPDATE`), the exact same safe pattern
established for `CustomerCodeSequence` in Prompt #6. This is a **separate
table**, not a shared one with Customer — product and customer code
spaces are independent (a product and a customer can both legitimately be
"000001" in the same company), so reusing `CustomerCodeSequence` would
have conflated two unrelated numbering domains. What's reused is the
*pattern* (atomic upsert, no `MAX(code)+1` race), not the table.

## Variants and the "default variant" pattern

Every `Product` has **at least one** `ProductVariant`, always — this is
how SKU and alternate codes stay attached to something even for a simple
product like "Agua mineral 500 ml" that has no real variation:

- A **simple product** gets exactly one auto-created variant with
  `name: null`. The UI never exposes this as a "variant" — SKU and codes
  just look like plain fields on the product.
- A **variant product** (e.g. "Remera clásica") gets one explicitly named
  `ProductVariant` per combination ("Negro / M", "Negro / L", ...), each
  with its own optional SKU and alternate codes.

`ProductSummary.hasVariants` is computed as "at least one variant has a
non-null `name`" — this single rule is what the API and UI both use to
decide whether to render the flat "SKU + Códigos" UI or the full variant
list, without a separate boolean flag to keep in sync.

`ProductVariant.attributes` is a plain flat JSONB string map (e.g.
`{"color": "Negro", "talle": "M"}`) — deliberately not a formal
attribute-definition engine. It's validated for basic shape (string
keys/values, a small size cap) but nothing more. A real attribute catalog
can be introduced later if requirements justify it.

## SKU and alternate codes (`ProductCode`)

`ProductVariant.sku` is a plain optional string field, unique **within
the company among ACTIVE variants** — enforced in `ProductsService`
(`assertSkuAvailable`), not a DB constraint, since an inactive/retired
variant must not block a new one from reusing its SKU, and multiple
variants may simply have no SKU at all.

`ProductCode` holds every *other* lookup code — barcode, supplier code,
internal code, marketplace code:

```
ProductCodeType: BARCODE | SUPPLIER | INTERNAL | MARKETPLACE | OTHER
```

Barcodes are stored as plain trimmed strings, **never** converted to a
numeric type — leading zeros matter, and formats vary (EAN-13, EAN-8,
UPC, Code 128, internal). Active-barcode uniqueness is enforced the same
way as SKU: unique within the company among **active** `ProductCode` rows
of type `BARCODE` (`assertBarcodeAvailable`) — a deactivated/removed
barcode can be reused. Non-barcode code types have no uniqueness
constraint (a supplier code, for instance, isn't expected to be globally
unique).

## Categories

`ProductCategory` is self-relational (`parentId`), supporting an
arbitrary-depth hierarchy. Cycle prevention (direct self-parent AND
indirect cycles like `A → B → C → A`) is enforced in
`ProductCategoriesService.assertNoCycle` by walking the proposed new
parent's ancestor chain — Postgres has no way to express "no cycles" as a
constraint. Unlike `Brand`, category **names are not required to be
unique** — real catalogs commonly reuse a name under different parents
(e.g. two different "Accesorios" subcategories), and the task spec didn't
request category name uniqueness the way it did for Brand. Categories are
never physically deleted — `deactivate` only.

## Brands

`Brand` enforces `companyId + normalizedName` uniqueness
(`normalizedName` = trimmed, lowercased `name`, stored alongside the
display-cased `name`) — "Acme" and "acme" collide, "Acme" and "Acme "
collide, but the original casing is preserved for display.

## Units of measure

`UnitOfMeasure.decimalPlaces` is informational configuration for a future
Inventory module's quantity precision (e.g. 0 for Unidad, 3 for
Kilogramo) — nothing in this task performs quantity arithmetic yet.
Deactivating a unit never invalidates existing `Product` references —
only the "pick a unit for a *new* product" dropdown filters to active
units.

## Inventory configuration (not inventory)

`Product` carries `trackInventory`, `trackLots`, `trackSerials`,
`allowNegativeStock`, and the `minimumStock`/`maximumStock`/
`reorderPoint` policy fields — all **configuration**, never a quantity.
No stock movement, lot, or serial-number record is created anywhere in
this task (see "Deferred").

Three validation rules, enforced both in the shared Zod schema (create,
via `superRefine`) and in `ProductsService` (update, against the merged
existing+patch state, since a PATCH may only touch one of the
interacting fields):

- `productType: SERVICE` may not explicitly request `trackInventory: true`
  — a service should never accidentally participate in physical
  inventory. If omitted, `SERVICE` defaults `trackInventory` to `false`
  and every other type defaults it to `true`.
- `trackLots: true` requires the *effective* `trackInventory` to be
  `true`.
- `trackSerials: true` requires the *effective* `trackInventory` to be
  `true`.

A CREATE violation surfaces as a normal Zod `400` with `fieldErrors`. An
UPDATE violation (only detectable after merging with the existing record)
surfaces as `PRODUCT_INVALID_INVENTORY_CONFIG` (`400`).

## Effective availability

If a `Product` is `INACTIVE`, its variants are not individually forced
`INACTIVE` too — a variant may already be independently inactive, or stay
active on a record that's simply not sold right now. Effective
availability for a future Sales/POS check is meant to be computed as
**`product.status === 'ACTIVE' AND variant.active === true`**, not stored
redundantly. This is a documented decision, not yet exercised by any
endpoint (see "Deferred" — nothing sells yet).

## Search

Product search (`GET /products`, filtered/paginated) matches
case-insensitively (Postgres `ILIKE` via Prisma's `contains` +
`mode: 'insensitive'`) across internal code, name, description, brand
name, variant SKU, and alternate codes — the same approach already used
for Customer search. Accent-folding (`unaccent`) and trigram indexes were
deliberately **not** added: they'd require a new Postgres extension
migration and raw SQL bypassing Prisma's typed query builder for a
"where practical" nice-to-have the task spec explicitly allowed skipping.
No external search engine (Elasticsearch, Meilisearch) was introduced —
see CLAUDE.md's general preference for the simplest implementation that
satisfies the requirement.

`GET /products/lookup` is the lean, sellable-**variant**-granularity
search meant for a future Facturación/POS selector (see "Facturación").
It never returns a full `Product` object. Two paths:

- **`?barcode=...`** — an exact-match-only fast path (no fuzzy fallback):
  scan a barcode, get exactly the active variant it identifies, or
  nothing. Never second-guessed by a text search.
- **`?search=...`** — a simple two-query ranking: an exact pass first
  (code/SKU/barcode equality), then a fuzzy `ILIKE` pass filling any
  remaining `limit` slots, excluding what the exact pass already found.
  This satisfies "exact barcode > exact SKU > exact code > text" without
  building a real scoring engine.

## Permissions

```
products.read
products.create
products.update
products.deactivate   (covers both deactivate AND reactivate — one
                        "can change active/inactive status" capability,
                        same modeling as customers.deactivate)
```

`ProductCategory`, `Brand`, and `UnitOfMeasure` management reuse these
same three permissions (`read`/`create`/`update` — no dedicated
`products.catalog.manage`) — the same anti-fragmentation decision made
for `CustomerCategory` in Prompt #6.

Default role grants: ADMIN gets everything. MANAGER (Gerente) gets
read/create/update/deactivate. SALES (Ventas) and WAREHOUSE (Depósito)
get read-only. PURCHASES (Compras) gets read/create/update (no
deactivate). TREASURY (Tesorería) gets no product access by default.
ACCOUNTING (Contabilidad) and VIEWER (Solo lectura) get read-only.

## Audit

Unlike `CustomerCategory` (which isn't separately audited),
`ProductCategory` and `Brand` **are** audited under their own
`entityType` (`'ProductCategory'`, `'Brand'`) — both have a real,
dedicated management screen and (for categories) cycle-prevention logic
worth tracking independently of any one product.

Everything that happens *through* a product — the product's own fields,
its variants, their codes, and which category/brand it's assigned to —
is recorded under `entityType: 'Product'`, `entityId: product.id`, with
`metadata.change` as a discriminator
(`variant_added`/`variant_updated`/`variant_deactivated`/
`variant_reactivated`/`code_added`/`code_updated`/`code_removed`/
`category_changed`/`brand_changed`). This exactly mirrors Customer's
address/contact/category-assignment pattern from Prompt #6, and is what
lets `GET /products/:id/history` reuse `AuditService.getEntityHistory`
verbatim — the same reasoning is spelled out in
[customers.md](customers.md). `category_changed`/`brand_changed` resolve
and store the *name* (not the raw id) of the previous and new
category/brand, so the Historial tab never has to show a bare UUID.

`PRODUCT_INACTIVE` is registered in the exception catalog for forward
compatibility but is **not thrown anywhere in this task** — no
sales/POS operation exists yet that would need to reject an inactive
product. Same documented decision as `CUSTOMER_INACTIVE` in
[customers.md](customers.md).

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/products` | `products.read` |
| GET | `/products/lookup` | `products.read` |
| GET | `/products/:id` | `products.read` |
| GET | `/products/:id/history` | `products.read` |
| POST | `/products` | `products.create` |
| PATCH | `/products/:id` | `products.update` |
| POST | `/products/:id/deactivate` | `products.deactivate` |
| POST | `/products/:id/reactivate` | `products.deactivate` |
| POST | `/products/:id/variants` | `products.update` |
| PATCH | `/products/:id/variants/:variantId` | `products.update` |
| POST | `/products/:id/variants/:variantId/deactivate` | `products.update` |
| POST | `/products/:id/variants/:variantId/reactivate` | `products.update` |
| POST | `/products/:id/variants/:variantId/codes` | `products.update` |
| PATCH | `/products/:id/variants/:variantId/codes/:codeId` | `products.update` |
| DELETE | `/products/:id/variants/:variantId/codes/:codeId` | `products.update` |
| GET/POST | `/product-categories` | `products.read` / `products.create` |
| PATCH/POST `:id/deactivate` | `/product-categories/:id` | `products.update` |
| GET/POST | `/brands` | `products.read` / `products.create` |
| PATCH/POST `:id/deactivate` | `/brands/:id` | `products.update` |
| GET/POST | `/units` | `products.read` / `products.create` |
| PATCH/POST `:id/deactivate` | `/units/:id` | `products.update` |

Create/update never accept `companyId`/`tenantId` from the request body —
company ownership always comes from the validated `RequestContext` (see
CLAUDE.md). Update handlers explicitly map each writable field; nothing
is ever spread directly from the request body onto a Prisma update call.

## Gestión

`/productos` — list (search/estado/tipo/categoría filters, "N variantes"
indicator instead of expanding every variant inline). `/productos/nuevo`
— progressive-disclosure create form (Datos principales → Clasificación →
Inventario → Variantes y códigos → Notas), with a plain "¿Este producto
tiene variantes?" toggle deciding whether the simple SKU+códigos fields
or the repeatable variant list renders. `/productos/:id` — detail with
Resumen/Variantes y códigos/Configuración/Historial tabs; a simple
product's SKU/codes are edited inline in the Variantes tab without any
"variant" framing. `/productos/:id/editar` — dedicated edit page for
product-level fields (variants/codes are managed from the detail page's
tabs, mirroring how Customer addresses/contacts live on its detail page,
not its edit form). `/productos/categorias`, `/productos/marcas`,
`/productos/unidades` — lightweight catalog-configuration screens reached
via a small secondary nav, not separate sidebar entries.

## Facturación / future POS

Facturación has **no product administration UI** — by design, matching
the same decision made for Customers. It will eventually consume
`GET /products/lookup` for a fast selector (scan barcode, or type SKU/
description) that resolves to a `productId`/`variantId` pair, plus
display name/SKU/barcode — and, once those modules exist, price and
available stock. No UI wiring was added in this task; only the shared
backend/client foundation (`useProductLookup` in `@erp/auth-client`)
exists, unused by any screen yet. There is exactly one product catalog —
Gestión administers it, Facturación/POS only ever read it.

## Deferred

Out of scope for this task, intentionally: warehouses, stock movements,
stock quantities/reservations, inventory valuation, inventory counts,
stock transfers, price lists, authoritative sale prices, purchase costs,
sales orders, invoices, purchase orders, tax calculation, ARCA
integration, Lot/Serial as real inventory instances (only the
`trackLots`/`trackSerials` *configuration* flags exist), KIT
composition/BOM, MANUFACTURED recipes/production orders, marketplace
integrations, product import/export, and full product image/media
management.
