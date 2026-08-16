# 008 — Inventory

Status: DONE

## Implemented scope

`apps/api/src/inventory` + `src/warehouses`. Ledger-based stock:
`StockMovement` (authoritative) + `InventoryBalance` (rebuildable
projection), concurrency-safe atomic-upsert balance mutation,
`StockReservation` (service-level, no public API), `StockAdjustment`
(draft/confirm/cancel), initial balances. Gestión: `/stock`
(Existencias/Movimientos/Ajustes/Depósitos + Carga inicial). Facturación:
warehouse-selection foundation (selector only, no sale flow).

## Relevant docs

[docs/inventory.md](../../docs/inventory.md)

## Verification

`apps/api/test/inventory.e2e-spec.ts` (concurrency, reconciliation/rebuild,
negative-stock policy).
