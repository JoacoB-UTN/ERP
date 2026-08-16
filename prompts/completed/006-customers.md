# 006 — Customers

Status: DONE

## Implemented scope

`apps/api/src/customers`. First real business/master-data module.
Customer/CustomerAddress/CustomerContact/CustomerCategory, CUIT/document
validation, code sequencing, search, per-customer history. `apps/web`
renamed to `apps/gestion` in this prompt; `apps/facturacion` scaffolded
alongside it; `packages/auth-client` introduced as the shared TanStack
Query client both apps consume. Gestión: `/clientes` list/create/detail/
edit.

## Relevant docs

[docs/customers.md](../../docs/customers.md),
[docs/product-ui-principles.md](../../docs/product-ui-principles.md)
(the Gestión/Facturación split established in this prompt)

## Verification

`apps/api/test/customers.e2e-spec.ts`,
`apps/api/src/customers/tax-id.spec.ts`.
