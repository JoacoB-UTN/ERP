# 009 — Pricing

Status: DONE

## Implemented scope

`apps/api/src/pricing`. `Currency` (global reference data) + `PriceList`
+ `PriceListItem` + `PriceHistory`. FIXED vs. DERIVED price-list
resolution (recursive, cycle-safe at write time via `PriceListsService`,
defensive depth guard at read time), Decimal-safe arithmetic throughout,
auto-close validity-range rule, bulk adjustment (preview writes nothing,
confirm is transactional with one parent audit event), `PriceHistory`
explicitly distinct from `AuditLog`. Gestión: `/listas-de-precios`
list/create/detail (fixed price table with inline batch editing +
per-row history, derived read-only resolved view), bulk-update flow,
Product detail "Precios" tab. Facturación: price-list-selection
foundation (selector only, no sale flow consumes it).

## Relevant docs

[docs/pricing.md](../../docs/pricing.md)

## Verification

`apps/api/test/pricing.e2e-spec.ts` (28 tests: FIXED/DERIVED resolution,
percentage/fixed-amount adjustment, decimal precision, cycle rejection,
currency mismatch, atomic default switch, missing-price handling,
historical boundary lookup, overlap rejection, PriceHistory content,
audit/history separation, batch-set rollback, bulk-adjust preview+confirm,
company isolation, all 7 `pricing.*` permissions).
