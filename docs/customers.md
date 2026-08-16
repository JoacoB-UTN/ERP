# Customers (master data)

This document covers the customer master module: what it models, how
ownership/search/validation work, and what's deliberately deferred. Read
this before touching `apps/api/src/customers` or Gestión's `/clientes`.

See also [authorization.md](authorization.md) (the `customers.*`
permissions), [audit-architecture.md](audit-architecture.md) (how customer
mutations are audited, and the per-entity history query this module is the
first real consumer of), and the root [CLAUDE.md](../CLAUDE.md) for the two
permanent rules extracted from this doc.

## What this module is — and isn't

`Customer` is an ERP master record, not a CRM contact and not a ledger.
This task implements customer identity, tax/contact data, addresses,
contacts, and categories — enough for future sales/invoicing/AR modules to
build on. It deliberately does **not** implement:

- accounts receivable, customer balance, or any stored `balance` column
  (see CLAUDE.md — balance always derives from a future ledger)
- quotes, sales orders, invoices, credit notes, receipts, price lists,
  salespersons, payment terms
- ARCA/AFIP integration (CUIT is validated structurally, never looked up
  externally)
- leads/opportunities/pipeline/CRM activity tracking
- import/export, attachments, bulk operations

See "Deferred" at the end for the full list.

## Company ownership

`Customer`, `CustomerCategory`, and `CustomerCodeSequence` all carry
`tenantId` + `companyId` and are scoped by the validated
`RequestContext.companyId` on every read/write — never a client-supplied
value, never an `id`-only lookup (see CLAUDE.md's company-isolation rule).
`CustomerAddress`/`CustomerContact`/`CustomerCategoryAssignment` don't
carry their own `companyId` — they're scoped transitively by validating
the parent `Customer`/`CustomerCategory` belongs to the active company
first (`findScopedOrThrow` in `CustomersService`), then looking up the
child row by its own id *and* the now-validated parent id (never the
child's id alone).

## Customer type, status, document type, tax condition

Four small enums, chosen to be Argentina-complete without being
Argentina-only in naming:

```
CustomerType:          COMPANY | INDIVIDUAL | FINAL_CONSUMER | FOREIGN
CustomerStatus:        ACTIVE | INACTIVE
CustomerDocumentType:  CUIT | CUIL | DNI | PASSPORT | OTHER
CustomerTaxCondition:  RESPONSABLE_INSCRIPTO | MONOTRIBUTO | EXENTO |
                        CONSUMIDOR_FINAL | NO_RESPONSABLE | EXTERIOR | OTHER
```

Internal field names (`taxId`, `taxCondition`, `documentType`) are
generic; only the Gestión UI labels them in Argentina-specific Spanish
("CUIT", "Condición frente al IVA"). A future non-AR tenant could reuse
the same columns with different UI labels without a schema change.

Status is binary and never physically deletes a customer — see
"Deactivation" below.

## Names

`legalName` is "razón social" for a `COMPANY`, or the person's display
name for `INDIVIDUAL`/`FINAL_CONSUMER`. `tradeName` ("nombre comercial")
is optional and, when present, is what both the API (`displayName`) and
the UI show as primary — `legalName` shows secondarily. No first/middle/
last-name split for individuals; not needed at this stage (see CLAUDE.md's
anti-over-engineering guidance).

## Tax ID (CUIT/CUIL) normalization and validation

Implemented in `packages/shared/src/tax-id.ts`, shared by frontend and
backend so both validate identically:

- **Stored value is normalized digits only** (`"30712345671"`), never the
  dashed form. `formatCuit()` re-adds dashes for display
  (`"30-71234567-1"`). This is a deliberate, documented choice (see
  section 13 of the originating task) — normalize once at the boundary,
  format only for display.
- **Checksum validation** (`isValidCuitChecksum`) applies the standard
  mod-11 algorithm, but **only** when `documentType` is `CUIT` or `CUIL`
  (`validateTaxIdForDocumentType`) — a DNI or passport never gets CUIT-
  shaped validation. Enforced via a Zod `superRefine` on both
  `createCustomerSchema` and `updateCustomerSchema`
  (`packages/shared/src/customers.ts`), so the same rule runs client-side
  (fast feedback) and server-side (authoritative).
- **Uniqueness is per-company, among ACTIVE customers only** — see
  "Duplicate detection" below. This is a business-layer check
  (`CustomersService.assertTaxIdAvailable`), not a database unique
  constraint, precisely because a generic/final-consumer record may have
  no meaningful tax id, and a re-activated customer must be able to
  reclaim a tax id an inactive duplicate is still holding.
- No ARCA/AFIP lookup exists or is planned for this task. A future
  "Consultar datos fiscales" action after entering a CUIT is an
  architecturally reasonable next step, but no such button exists yet —
  don't add a non-functional one.

## Customer code

Human-friendly, company-scoped (`@@unique([companyId, code])` — two
companies may both have `"000001"`). Auto-generated sequentially via
`CustomerCodeSequence`, a one-row-per-company counter incremented with a
single atomic `upsert` (`UPDATE ... lastValue = lastValue + 1`, or
`INSERT` on first use) — safe under concurrency without explicit row
locking, and deliberately narrow (customer codes only, not a generalized
numbering framework — see CLAUDE.md). A manual code may still be supplied
on create; it's validated for uniqueness the same as an auto-generated one
would be, just without consuming a sequence value.

## Addresses

`CustomerAddress` supports multiple rows per customer, typed
(`FISCAL`/`BILLING`/`SHIPPING`/`OTHER`). At most one address may be
`isDefault: true` **per (customerId, type)** — a customer can have one
default `FISCAL` address and, independently, one default `SHIPPING`
address. Setting a new default transactionally unsets the previous one of
the same type (`tx.customerAddress.updateMany` inside the same
`$transaction` as the create/update) — never two defaults of the same type
momentarily or permanently.

Managed through dedicated sub-resource endpoints
(`POST/PATCH/DELETE /customers/:id/addresses(/:addressId)`), not folded
into the customer PATCH payload — this keeps the main customer update
payload flat and lets Gestión's address cards save independently (see
"API" below). Addresses may still be supplied inline on `POST /customers`
for the common "fill in everything and create" first-run flow.

## Contacts

`CustomerContact` supports multiple rows per customer; a customer needs
none at all (customer-level `email`/`phone` may be sufficient for small
accounts). At most one contact may be `isPrimary: true`, enforced the same
transactional way as address defaults. Same dedicated-endpoint /
inline-on-create pattern as addresses.

## Categories

`CustomerCategory` (company-scoped, `@@unique([companyId, name])`) and
`CustomerCategoryAssignment` (many-to-many join) let a customer belong to
multiple categories (`Mayorista`, `VIP`, ...). Category master CRUD
(`GET/POST/PATCH /customer-categories`) reuses `customers.read/create/
update` rather than introducing a `customers.categories.manage` permission
— a separate permission wasn't justified here (see CLAUDE.md's RBAC
anti-fragmentation guidance; the same call was made for
`administration.roles.*` vs. a hypothetical narrower permission in
Prompt #4). Assigning/unassigning categories to a specific customer goes
through `categoryIds` on `POST /customers` or `PATCH /customers/:id`,
which is also where the meaningful audit event lives (see "Audit" below).

## Deactivation, not deletion

`POST /customers/:id/deactivate` / `POST /customers/:id/reactivate` flip
`status` between `ACTIVE`/`INACTIVE`. There is no delete endpoint, and
none is planned — future transactional history (sales, invoices, AR
movements) must never point at a vanished customer. Both operations are
idempotent (calling deactivate on an already-inactive customer is a no-op,
no audit noise) and both are gated by `customers.deactivate` — see
"Permissions". Reactivating re-checks tax-id uniqueness (a newly-active
customer could reintroduce a conflict with another already-active
customer holding the same tax id).

## Duplicate detection

- **Code**: unique per company regardless of status — conflict returns
  409 `CUSTOMER_CODE_ALREADY_EXISTS`.
- **Tax ID**: unique per company **among ACTIVE customers only** —
  conflict returns 409 `CUSTOMER_TAX_ID_ALREADY_EXISTS`. An inactive
  duplicate never blocks a new active customer.
- **Name**: never validated for uniqueness — many legitimate customers
  share a name. No hard rule, no warning implemented in this task.

## Search

`GET /customers` and the lightweight `GET /customers/lookup` both search
case-insensitively across `code`, `legalName`, `tradeName`, `email`, and
`phone` (`contains`, `mode: 'insensitive'`), plus `taxId` — the search
term is normalized the same way stored tax ids are
(`normalizeTaxId(term)`), so `"30-12345678-9"` and `"30123456789"` both
match a customer regardless of how the user typed it. Indexes exist for
`companyId+code` (via the unique constraint), `companyId+taxId`, and
`companyId+legalName` — plain B-tree indexes are sufficient at this scale;
no full-text search engine is justified (see CLAUDE.md).

## API

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `GET /customers` | `customers.read` | Paginated, filterable (`search`, `status`, `customerType`, `taxCondition`, `categoryId`, `province`), sortable |
| `GET /customers/lookup` | `customers.read` | Lightweight, ACTIVE-only — for a future fast Facturación selector |
| `GET /customers/:id` | `customers.read` | Full detail incl. addresses/contacts/categories |
| `GET /customers/:id/history` | `customers.read` | Customer-scoped audit history — see "Audit" |
| `POST /customers` | `customers.create` | Accepts nested `addresses`/`contacts`/`categoryIds`; atomic |
| `PATCH /customers/:id` | `customers.update` | Explicit field mapping only, never a raw body spread; `categoryIds` replaces the assignment set |
| `POST /customers/:id/deactivate` | `customers.deactivate` | Idempotent |
| `POST /customers/:id/reactivate` | `customers.deactivate` | Idempotent, re-checks tax id |
| `POST/PATCH/DELETE /customers/:id/addresses(/:addressId)` | `customers.update` | Ownership-scoped by customerId |
| `POST/PATCH/DELETE /customers/:id/contacts(/:contactId)` | `customers.update` | Ownership-scoped by customerId |
| `GET/POST/PATCH /customer-categories(/:id)` | `customers.read`/`create`/`update` | Category master only |

Errors use the project-wide envelope (`{ error: { code, message, details? } }`)
with stable codes: `CUSTOMER_NOT_FOUND`, `CUSTOMER_CODE_ALREADY_EXISTS`,
`CUSTOMER_TAX_ID_ALREADY_EXISTS`, `CUSTOMER_CATEGORY_NOT_FOUND`,
`CUSTOMER_ADDRESS_NOT_FOUND`, `CUSTOMER_CONTACT_NOT_FOUND`,
`CUSTOMER_CATEGORY_ALREADY_EXISTS`. There is no dedicated `INVALID_TAX_ID`
exception — CUIT/CUIL structural and checksum validation happens in the
shared Zod schema before a request ever reaches `CustomersService`, so it
surfaces as a normal 400 validation error with a field-level message on
`taxId`, not a service-level business exception (a dedicated exception
class here would be unreachable dead code).

## Decimal handling

`creditLimit` (`NUMERIC(19,4)`) and `discountPercentage` (`NUMERIC(5,2)`,
validated `0–100`) are `Decimal` columns in Postgres. They cross the wire
as **strings** in both directions — never `number` — so JS floating-point
imprecision never touches them (`packages/shared/src/decimal.ts`). The
frontend formats them for display via `formatDecimalDisplay`, never by
parsing to a JS number and back.

## Audit

Every meaningful customer mutation writes one `AuditLog` row with
`entityType: 'Customer'`, `entityId: customer.id` — including address/
contact/category changes, which use the *same* `entityType`/`entityId`
(distinguished by `metadata.change`: `address_added`/`address_updated`/
`address_removed`/`contact_added`/`contact_updated`/`contact_removed`/
`categories_changed`) rather than their own audit entity types. This was
a deliberate simplification: it lets `GET /customers/:id/history` reuse
`AuditService.getEntityHistory('Customer', id, ...)` verbatim (Prompt #5's
reusable per-entity query, unmodified in its filtering logic) and keeps a
customer's full history — main-field changes and sub-resource changes
alike — in one chronological, one-query list. See CLAUDE.md's audit rules
for the general principles (meaningful events only, atomic with the
mutation, sanitized).

`AuditService.getEntityHistory` returns full per-row detail
(`AuditEntityHistoryResponse`, not the lean list summary the general
`/administration/audit` screen uses) specifically so a per-entity
"Historial" tab can render a readable inline diff — "Límite de crédito:
$100.000 → $250.000" — without an extra detail fetch per row. This is a
generic capability, not customer-specific; the same shape now backs the
general `/administration/audit/entity/:entityType/:entityId` route too.

### Historial permission: a documented decision

The generic admin audit screen requires `administration.audit.read`. A
customer's own "Historial" tab does **not** — it requires only
`customers.read`, via a dedicated `GET /customers/:id/history` route in
`CustomersController` (not the admin audit controller). Rationale: a
salesperson who can read a customer should reasonably see that specific
customer's change history without also holding full audit-administration
rights over the whole company. This is the "narrower permission" option
explicitly weighed and chosen for simplicity and product sense — the
underlying query is identical either way (`AuditService.getEntityHistory`),
only the route and its permission differ.

## Permissions

`customers.read`, `customers.create`, `customers.update`,
`customers.deactivate` (covers both deactivate and reactivate — modeled
as one "can change active/inactive status" capability, not two mirrored
permissions). An earlier `customers.delete` placeholder (registered but
never wired to any endpoint) was renamed to `customers.deactivate` when
this module was implemented, since no hard-delete behavior exists — see
CLAUDE.md's RBAC rules. Default role grants (see `apps/api/prisma/seed.ts`):

| Role | Grants |
| --- | --- |
| Administrador | all |
| Gerente | read, create, update, deactivate |
| Ventas | read, create, update (not deactivate) |
| Tesorería | read only |
| Contabilidad | read only |
| Solo lectura | read only |
| Depósito, Compras | none — no customer access needed |

## Gestión

`/clientes` (list), `/clientes/nuevo` (create), `/clientes/:id` (detail —
Datos/Domicilios/Contactos/Historial tabs), `/clientes/:id/editar` (edit
the main fields). Sidebar entry gated by `customers.read`, same as every
other permission-aware nav item. The create form uses progressive
disclosure (`<details>` sections) — only "Datos principales" is expanded
by default; a valid customer can be saved from that section alone.

## Facturación

No customer administration UI exists in Facturación, by design (see
CLAUDE.md — Gestión owns the complete customer master). `GET /customers/
lookup` backs Facturación's fast operational customer selector
(`CustomerPicker`, used by both `/ventas/nueva` and POS — see
[facturacion.md](facturacion.md) and [pos.md](pos.md)) — concise fields
only (`id`, `code`, `displayName`, `legalName`, `taxId`, `taxCondition`,
`status`), ACTIVE customers only, no new permission (`customers.read` is
sufficient — see CLAUDE.md, no security difference to justify a separate
one).

## Deferred

Explicitly out of scope for this module:

- Accounts receivable, customer balance/debt, receipts, `CustomerAccountMovement`
- Quotes, sales orders, delivery notes, invoices, credit/debit notes
- Price lists, salespersons, payment terms, currencies, tax engine
- ARCA/AFIP integration (fiscal data lookup)
- Customer import/export (belongs to a future general import/export epic)
- Attachments (no `Attachment` infrastructure exists yet)
- CRM behavior: leads, opportunities, pipeline, tasks, campaigns
- Bulk operations (bulk activate/deactivate/export/recategorize)
