# Demo Guide

A script for the first serious product demonstration of the ERP,
against the data produced by `apps/api/prisma/seed.ts`. This is a
presentation aid, not a product doc — for what actually exists, see
[implementation-status.md](implementation-status.md); for the domain
rules the seed had to respect, see [sales.md](sales.md),
[pos.md](pos.md), [pricing.md](pricing.md), [inventory.md](inventory.md).

Every record named below (customer, product, price, warehouse, sale
number) comes from a fresh `db:reset` + seed run and was verified live
in the browser before this guide was written. If the seed ever changes,
re-verify this script — don't just re-read it.

## Before the meeting

From the repo root, with PostgreSQL and Redis running locally:

```bash
npm run db:reset
npm run dev
```

`db:reset` runs `prisma migrate reset` for `apps/api`, which connects
using `DATABASE_URL` — it drops and recreates whatever database that URL
points to, reapplies all migrations, and runs the seed automatically.
**Before confirming the reset, check `apps/api/.env`'s `DATABASE_URL`
yourself and make sure it points at your local dev database** (e.g.
`localhost:5432/erp_platform_dev`) — there is no code-level guard
preventing this command from running against whatever database is
configured, so a misconfigured `.env` pointed at a shared or production
database would be dropped too. If you only need to re-seed without
dropping the schema (e.g. you didn't touch migrations), `npm run
db:seed` alone is enough and is idempotent — safe to re-run, it will not
duplicate demo data.

`npm run dev` starts all three apps together:

| App | URL |
| --- | --- |
| Gestión (backoffice) | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Facturación (incl. POS at `/pos`) | http://localhost:3002 |

Open Gestión and Facturación in two browser tabs/windows before you
start talking — the "prove integration" step (section 7 below) depends
on switching between them quickly.

## Demo credentials

Local/dev only — never use these values outside a local database.

- **Email:** `admin@example.local`
- **Password:** `ChangeMe1234` (the seed's `DEV_ONLY_DEFAULT_PASSWORD`;
  overridable via `SEED_ADMIN_PASSWORD` in `apps/api/.env`, and
  *required* to be overridden if `NODE_ENV=production`)

This one admin user has access to both seeded companies. Use
**Distribuidora Horizonte S.R.L.** for the demo — the second company
("Second Demo Company") exists only for cross-company isolation tests
and has no realistic demo data.

## 10–15 minute presentation

Log into Gestión first, select **Distribuidora Horizonte S.R.L.** →
**Casa Central**, and confirm the URL bar shows `localhost:3000`.

### 1. Gestión Dashboard

Land on `/`. Point out **Ventas confirmadas hoy** and **Total operado
hoy** — these are real, live-computed aggregates
(`GET /dashboard/summary`), not placeholders. On a fresh `db:reset` +
seed, before you create any sale in this demo, this reads **2 confirmed
sales / ARS 28.900,00** — the seed's two `daysAgo: 0` sales (DEMO-SEED-01:
Ferretería El Puente, Yerba mate 1 kg ×2 + Resma A4 ×1 = ARS 23.500,00;
DEMO-SEED-02: Consumidor Final, Gaseosa cola 500 ml ×3 + Bolígrafo ×2 =
ARS 5.400,00). This baseline is what "today" happens to already contain —
it doesn't shift with when you seed, only the historical sales' relative
dates do (see "Determinism" below).

By the end of this script (after the Facturación sale in step 6 and both
POS sales in step 8), the same card should read **5 confirmed sales /
ARS 75.400,00** (28.900 + 22.000 + 22.000 + 2.500). Don't claim the
5/75.400 figure before those three sales actually exist — walk the
presenter through the baseline now, and circle back to the grown total
in step 7/8's "prove integration" moments.

### 2. Clientes

Go to `/clientes`. Search **"Ferretería"** — one hit, **Ferretería El
Puente** (code `000002`, Responsable Inscripto, CUIT
`30-71234567-1`). Open it to show the customer detail page (fiscal data,
contact info, address). Mention the roster: 16 customers, a mix of
companies, small businesses, and individuals, plus the mandatory
**Consumidor Final** (code `000001`) used by walk-in POS sales.

### 3. Productos

Go to `/productos`. Point out the catalog mix: **Café 1 kg**
(`CAFE-1KG`, stock-tracked, single-variant), **Bolígrafo**/**Buzo con
capucha** (multi-variant — Buzo has 4 variants across size/color
combinations: Negro/S, Negro/M, Negro/L, Gris/M), **Gaseosa cola 500 ml**
(has a valid EAN-13 barcode, `7790001000019`), and **Servicio de flete**
(type Servicio — no stock, no warehouse). 17 products, 21 sellable
variants total.

### 4. Inventario

Go to `/stock/existencias`. Filter by **Café 1 kg** — three rows, one
per warehouse (Depósito Central, Salón de Ventas, Depósito Sucursal
Norte), all with distinct on-hand quantities. This is the point to
mention that stock is a projection over an append-only `StockMovement`
ledger, never a mutable counter. Optionally filter to **Cargador USB-C**
to show it returns zero rows — a genuine, deliberate zero-stock example
for the negative-/edge-case story.

### 5. Precios

Go to `/listas-de-precios`. Three price lists exist — **Minorista**
(FIXED, the default), **Mayorista** (DERIVED, -10% off Minorista), and
**Distribuidor** (DERIVED, -15% off Minorista) — but the live demo only
needs to show **Minorista** and **Mayorista**; skip Distribuidor unless
asked. DERIVED lists are computed at read time from their base, never
materialized. Open **Café 1 kg** in Minorista to show its price:
**ARS 22.000,00**.

### 6. Facturación — Nueva venta

Switch to the Facturación tab. Confirm company **Distribuidora
Horizonte**, branch **Casa Central** — you'll be asked to pick a
warehouse explicitly here (Casa Central has two eligible warehouses,
Depósito Central and Salón de Ventas, so it won't auto-select). Choose
**Depósito Central**. Price list **Minorista** auto-selects (it's the
only eligible default).

Start a **Nueva venta**:
1. Customer: search **"Ferretería"**, select **Ferretería El Puente**.
2. Product: search **"Café"**, add **Café 1 kg** (qty 1).
3. Confirm the line total: **ARS 22.000,00**.
4. Click **Confirmar** — the sale moves to CONFIRMED, gets a number
   (continuing the `VTA-NNNNNN` sequence), and Depósito Central's Café 1
   kg stock decrements by 1. On a fresh `db:reset` + seed, exactly 11
   sales already exist (10 confirmed + 1 draft), so this sale will be
   **VTA-000012** — *unless* you or someone else already created sales
   in this database session, in which case just use whatever number
   appears; the total (ARS 22.000,00) is what matters for the story.

### 7. Prove integration

Switch back to the Gestión tab and refresh the dashboard (or revisit
`/ventas`). The sale you just confirmed appears immediately with the
same number, customer, and total — same `SalesService`, same database,
no separate "sync." This is the single most important beat of the demo:
Gestión and Facturación — including POS mode inside Facturación — share
the same sales/inventory/pricing core and database. There are only two
user-facing applications; POS is not a third app, it's a fast checkout
mode inside Facturación.

### 8. POS

Switch to Facturación → **POS** (`/pos`). This is the fast, keyboard-
first checkout mode:

1. Search/scan **"Café"**, press Enter to add **Café 1 kg** — total
   **ARS 22.000,00**.
2. Press **F2**, search **"Consumidor"**, select **Consumidor Final**.
3. Press **F10** to open the payment panel. **Efectivo** (cash) is the
   default tender.
4. Type **25000** into "Importe recibido." Vuelto (change) computes
   live: **ARS 3.000,00**.
5. Click **Confirmar y cobrar** — the success screen shows the sale
   number, total, method (Efectivo), amount received, and change.
   Following directly after the Facturación sale above, this will be
   **VTA-000013**.

Optionally repeat with a second, smaller item (e.g. **Cuaderno**, ARS
2.500,00) and select **Tarjeta** (card) instead (**VTA-000014**) — the
payment panel drops the received/change fields entirely for non-cash
tenders, since there's no cash to reconcile.

Return to Gestión's dashboard once more to show both POS sales landing
in the same recent-sales feed and today's totals updating again.

### 9. Closing message

**Working now**, end to end, across Gestión and Facturación (including
its POS mode): customers,
product catalog (with variants, barcodes, services), multi-warehouse
inventory on an auditable ledger, multi-list pricing (fixed and
derived), a real internal sales workflow (draft → confirm, with
inventory and pricing snapshotted atomically), point-of-sale checkout
with cash/card/transfer/other tenders, and — in Gestión only —
Purchases: suppliers, purchase orders (commercial intent, no stock
effect until received), and goods receipts (the only Purchases document
that moves inventory, including partial receiving across multiple
receipts against one order). All company-scoped and permission-gated
(RBAC + audit trail underneath, even though this demo doesn't dwell on
them).

**Not yet built — by design, not oversight:** fiscal invoicing / ARCA
integration, supplier current account / accounts payable, treasury
(bank/cash reconciliation), accounting (chart of accounts, journal
entries), and BI-style reporting. The current `SalesDocument` is an
internal transaction record, not a fiscal invoice — say this plainly if
asked. See [implementation-status.md](implementation-status.md) for the
exact, up-to-date boundary; don't improvise beyond what it says.

## Data notes (for whoever runs this demo)

- **Company:** Distribuidora Horizonte S.R.L. (CUIT `30-71876543-5`),
  branches Casa Central and Sucursal Norte. All seeded CUITs (company,
  customers, and suppliers) are fictional but carry a valid Argentine
  check digit — they're generated, never copied from a real entity (see
  `suppliers-seed-data.spec.ts` for the regression test guarding this for
  suppliers specifically).
- **Determinism:** all seeded data is deterministic except sale dates,
  which are computed relative to seed-run time (`Date.now() - N days`)
  so "today's" sales are always genuinely dated today, however long ago
  the seed was actually run. Re-running the seed without a reset is a
  no-op for existing data (idempotent upserts + a `notes` marker on
  seeded sales) — it will not create duplicates.
- **Historical sales:** 10 CONFIRMED sales spread across 8 distinct
  calendar-day offsets spanning today through 9 days ago (`daysAgo`:
  0, 0, 1, 1, 2, 3, 4, 6, 8, 9) — mixed customers, totals, and tender
  methods (CASH/CARD/TRANSFER/OTHER) — plus 1 DRAFT sale, so the
  "Borradores abiertos" dashboard card isn't always zero. These were
  built by mirroring `SalesService.confirm()`'s exact transaction shape
  directly in the seed script (Decimal-safe totals, atomic sequence
  numbering, atomic stock-out, tender atomicity) rather than through the
  real API, because `SalesService.confirm()` hardcodes `confirmedAt: new
  Date()` and can't be backdated through the real endpoint. See the
  comments above `seedHistoricalSale` in `seed.ts` for the full
  rationale.
