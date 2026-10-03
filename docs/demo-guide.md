# Demo Guide

A 13-minute presentation of customers, products, pricing, stock and sales
across Gestión and Facturación, including POS. The existing dataset comes
from [seed.ts](../apps/api/prisma/seed.ts); do not recreate it for this demo.
See [sales.md](sales.md), [pos.md](pos.md), [pricing.md](pricing.md),
[inventory.md](inventory.md) and [dashboard.md](dashboard.md) for domain rules.

**Evidence status:** on 2026-10-03, a disposable database and browser rehearsal
verified the double seed, a normal sale and a cash POS sale against base
`1c2e7e8`. See [acceptance evidence](acceptance-2026-10-03.md). The full timed
tour, optional card sale and receipt dialog/physical printing were not
performed. Task 015 remains **PARTIAL**; observed results and untested
expectations are distinguished below.

## Before the meeting

Prepare and rehearse in a **new, disposable local database**, with dedicated
PostgreSQL and Redis, installed dependencies and the API's generated client
already available. Have the environment owner verify the effective
`DATABASE_URL` and `REDIS_URL` before any command, without publishing their
credentials. Do not inherit another installation's environment or reset an
existing database to obtain this baseline.

For another rehearsal in that disposable environment, from the repository root:

```bash
npm run db:migrate:deploy --workspace=apps/api
npm run db:seed
```

The first command applies existing migrations to the disposable database;
it does not generate new migrations. Record the first seed's counts,
identities, sales numbers/dates/totals, price history and inventory movements
and balances. Then run `npm run db:seed` a second time and compare them as
described under **Rehearsal evidence** below. Re-seeding is not universally a
no-op: some upserts update fields and the administrator password is set
again. It must not be used to refresh an existing installation for a demo.

After those checks, `npm run dev` starts the API and both frontends:

| App | Default local URL |
| --- | --- |
| Gestión | http://localhost:3000 |
| API | http://localhost:3001/api/v1 |
| Facturación, including `/pos` | http://localhost:3002 |

Open Gestión and Facturación in separate tabs and log in before starting
the timer. Finish the seed and presentation on the same calendar day in
ANRAS's timezone, `America/Argentina/Buenos_Aires`, without crossing midnight
or allowing concurrent operators. If the observed baseline differs, record
and investigate it before presenting; do not force the data to match.

## Demo login and company

The seed's local defaults are `admin@example.local` and `ChangeMe1234`.
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` can override them; use the values
chosen by the rehearsal environment owner. The default password is for
local development only.

The administrator has access to **ANRAS**, **CABACO** and **BLANCO BAHIA**.
Use **ANRAS → Casa Central** in both apps. ANRAS has the illustrative
customers, catalog, stock, price lists and sales. The other two companies
support selection/isolation scenarios, not this sales demo. A separate
other-tenant fixture also exists but is not granted to this administrator;
three accessible companies does not mean three company rows in the database.

## Presentation: 13 minutes, or 15 with the optional sale

All expected numbers assume the complete seed in the new database described
above, unchanged prices and no other operations. Capture actual sale
numbers rather than promising a sequence number on a reused database.

### 1. Dashboard — 0:00–1:00

In Gestión `/`, verify ANRAS and Casa Central. The **Ventas** panel defaults
to **30 días**, with sales amount, confirmed count and average ticket from
`GET /dashboard/sales-series?period=D30`.

Observed fresh starting point: **11 confirmed sales / ARS 657.400,00**, with
**ARS 59.763,64** average ticket. The numbered draft is excluded. These totals
include the seeded historical sales within the selected period.

The API also exposes today's aggregate through `/dashboard/summary`, but
those daily cards are not the current dashboard UI. Do not present its
**2 / ARS 28.900,00** seed-day aggregate as the visible 30-day baseline.
Re-seeding later does not move existing sale dates forward; a later rehearsal
must check which dates remain inside the selected period.

### 2. Clientes — 1:00–2:00

Go to `/clientes`, search **Ferretería**, and open **Ferretería El Puente**
(code `000002`, legal name **Ferretería El Puente S.R.L.**, CUIT
`30-71234567-1`). Show its detail. There are **16 customers total**, including
**Consumidor Final** (`000001`) and one inactive customer; the active count
is therefore 15. Do not add Consumidor Final to the total a second time.

### 3. Productos — 2:00–3:30

Go to `/productos`. Show **Café 1 kg** (SKU `CAFE-1KG`, one variant, tracked
inventory), **Buzo con capucha** (Negro/S, Negro/M, Negro/L and Gris/M),
**Gaseosa cola 500 ml** (barcode `7790001000019`) and **Servicio de flete**
(no inventory movement).

The catalog contains **17 products and 21 variants**, including three
services and one inactive product, Cinta adhesiva. There are 16 active
products; do not describe every catalog variant as currently sellable.

### 4. Existencias — 3:30–5:00

Go to **`/stock`**, search **Café**, and select **Todos los depósitos**.
The expected current physical balances after the complete seed are:

| Warehouse | Calculation from seeded movements | Expected Café stock |
| --- | --- | --- |
| Depósito Central | 90 initial − 1 − 5 sold + 40 + 35 received | 159 |
| Salón de Ventas | 15 initial − 1 sold | 14 |
| Depósito Sucursal Norte | 20 initial − 4 sold | 16 |

Record the Central balance for the next steps. Initial quantities alone
are not current stock: seeded receipts and confirmed sales also contribute.
The receipt quantities explain the baseline; Purchases is not part of this
walkthrough. Stock is derived from the movement ledger. `/stock/movimientos`
provides the supporting movements.

If time allows, search **Cargador USB-C**: no stock rows are expected in the
fresh fixture because it has no seeded movements. This is an expectation to
check during rehearsal, not a claim about an existing installation.

### 5. Precios — 5:00–6:00

Go to `/listas-de-precios`. Show **Minorista** (fixed, default) with Café at
**ARS 22.000,00**, then **Mayorista** (derived, 10% lower) at **ARS 19.800,00**.
**Distribuidor** is also derived, 15% below Minorista; it can be skipped.
Derived prices are resolved from the base list rather than materialized as
independent prices. Use Minorista for the sales below.

The seed supplies an **INITIAL** price-history entry per priced variant in
Minorista. Do not promise a sequence of historical price increases: that is
not in this fixture.

### 6. Facturación — 6:00–8:30

Switch to Facturación `/ventas/nueva`. Verify **ANRAS → Casa Central →
Depósito Central → Minorista**. Explicitly choose the warehouse when needed;
Casa Central has two eligible warehouses. Check the price-list selection
before adding a line.

1. Search **Ferretería** and select **Ferretería El Puente**.
2. Search **Café** and add **Café 1 kg**, quantity 1.
3. Check the total: **ARS 22.000,00**.
4. Select **Confirmar venta** and complete its confirmation dialog.
5. Record the displayed sale number. **VTA-000013** is expected only on this
   fresh baseline: the seed already creates 11 confirmed sales and one
   numbered draft. Creating the draft allocates the number; confirmation
   changes its status and applies the inventory movement.

### 7. Prove integration — 8:30–10:00

Return to Gestión `/ventas`, reload, and open that same sale number. Compare
customer, total and confirmed status. At `/stock`, Café in Depósito Central
should decrease from **159 to 158**; verify the associated **SALE** movement.
The other two warehouses should remain unchanged. Re-reading the confirmed
sale must not create another movement.

Reload `/` with **30 días** selected: the expected aggregate after this sale
is **12 / ARS 679.400,00**. The normal sale and stock change were observed;
the separately recorded dashboard observations are the fresh baseline and
the result after both required sales.
Both applications use the same sales, pricing and inventory domain and
database. This demonstration does not require a synchronization process
between Gestión and Facturación.

### 8. POS — 10:00–12:30

In Facturación `/pos`, verify the same company, branch, warehouse and list.

1. Check that **Consumidor Final** is selected by default. If missing, select
   it manually; **F2** is available to change the customer.
2. Search **Café**, select the result and press Enter to add quantity 1.
   Check **ARS 22.000,00**.
3. Press **F10** to open checkout; verify **Efectivo**.
4. Enter **25000** in **Importe recibido** and check **ARS 3.000,00** change.
5. Select **Confirmar y cobrar**. Record the number (expected **VTA-000014**)
   and inspect the total, method, received amount and change.
6. Reload Gestión and compare the sale. Café in Central should now be **157**
   with one additional SALE movement. The observed **30 días** dashboard after
   both sales was **13 / ARS 701.400,00**, with **ARS 53.953,85** average ticket.

A tender is operational payment metadata, not a Treasury cash or bank
posting. The optional printed receipt says **Documento interno. No
constituye comprobante fiscal.** Do not present it as an ARCA invoice.

### 9. Closing — 12:30–13:00

Show the matching sale in both apps. The demonstrated circuit is customer,
product, resolved price, physical stock movement and confirmed internal
sale. POS is a mode inside Facturación. Keep this presentation within that
circuit; other modules are outside the walkthrough, not necessarily absent
from the product. For their current status, consult
[implementation-status.md](implementation-status.md).

### Optional card sale — 13:00–15:00

Start **Nueva venta** in POS, add **Cuaderno ×1** at **ARS 2.500,00**, and
select **Tarjeta**. Received/change fields do not apply; this records a
method, not an integration with a card terminal. Confirm and record the
number (expected **VTA-000015**). Compare the sale in Gestión and verify a
Cuaderno SALE movement of −1 in Central. Café remains 157.

**Expected, not observed:** after this optional sale, the **30 días**
aggregate would be **14 / ARS 703.900,00**. Without it, the observed script
ends at **13 / ARS 701.400,00**. The optional sale was not rehearsed.

## Data notes and static sources

- `seedDemoCustomers` and `seedDemoProducts` define the catalog counts;
  `seedWarehousesAndStock`, `seedDemoSales` and `seedDemoPurchases` explain
  the Café balances. These are existing fixtures, not new data to generate.
- `seedDemoPricing` defines the three lists and amounts; `ensureInitialPrice`
  inserts an initial item/history only when no item exists for that
  company/list/variant.
- `seedDemoSales` defines **11 CONFIRMED + 1 DRAFT**. Confirmed markers 01–11
  have `daysAgo` values **0, 0, 1, 1, 2, 3, 4, 6, 8, 9, 2**, spanning eight
  distinct offsets. Ten have CASH/CARD/TRANSFER/OTHER tenders; marker 11 has
  no tender. The draft has no stock effect.
- `seedHistoricalSale` creates dates relative to its first execution and
  returns an existing sale by company and marker on subsequent runs.
  Existing historical sales keep their dates, numbers and totals. The seed
  constructs fixtures directly rather than proving the live confirmation
  path; the rehearsal must exercise that path through the UI.
- `SalesOverview` selects `D30` by default. `SalesSeriesService.windowTotals`
  counts confirmed sales in the company's local period, scoped by company
  and currency; average ticket uses Decimal with two-decimal half-up rounding.
  `DashboardService.getSalesToday` still serves the separate daily summary.
  A previously used database or a later period requires fresh measurement.
- ANRAS uses CUIT placeholder `30-71876543-5`; company identifiers in this
  dataset are demonstration placeholders, not verified tax registrations.

## Rehearsal evidence — core flow verified, full tour pending

See [acceptance evidence](acceptance-2026-10-03.md) for the environment and
observations. On the disposable database, seed runs one and two preserved
IDs and compared fields, excluding `updatedAt`, for **4 companies,
16 customers, 17 products, 21 variants, 3 price lists, 21 price items,
21 price-history rows, 12 sales, 22 sale lines, 10 tenders,
49 stock movements and 23 inventory balances**. This does not claim every
row in the database is immutable under a repeated seed.

The browser flow confirmed **VTA-000013**, Ferretería + Café ×1 at Minorista,
for **ARS 22.000,00**, then **VTA-000014**, Consumidor Final + Café ×1,
with cash received **ARS 25.000,00** and change **ARS 3.000,00**. Central Café
stock changed **159 → 158 → 157**; the other warehouses remained **16 and 14**.
The fresh and final visible 30-day dashboard totals matched those above.
A database comparison confirmed exactly one new SALE movement of -1 linked
to each confirmed sale (14 sales and 51 stock movements afterward).

Remaining before closing Task 015:

1. Run and time the complete customer/product/pricing presentation, including
   the receipt dialog and verification of its non-fiscal wording. Physical
   printing was not tested; verify it separately if part of the presentation.
2. Rehearse the optional card sale if it will be demonstrated; its results
   above remain expectations, not observations.
3. Keep browser, seed and automated-test evidence separate. The successful
   core flow does not establish the duration or completion of the full tour.
