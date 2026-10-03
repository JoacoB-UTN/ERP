# Demo Guide

A 13-minute presentation of customers, products, pricing, stock and sales
across Gestión and Facturación, including POS. The existing dataset comes
from [seed.ts](../apps/api/prisma/seed.ts); do not recreate it for this demo.
See [sales.md](sales.md), [pos.md](pos.md), [pricing.md](pricing.md),
[inventory.md](inventory.md) and [dashboard.md](dashboard.md) for domain rules.

**Evidence status:** reconciled by static inspection on 2026-10-03 against
`6dac59ffc89174f4ce6a9af5df08577e682e2da2`. The numbers below are expectations
calculated from that code. This revision has not been rehearsed against a
database or in a browser. Task 015 remains **PARTIAL — runtime verification
pending**; earlier browser checks do not validate this revised script.

## Before the meeting

Prepare and rehearse in a **new, disposable local database**, with dedicated
PostgreSQL and Redis, installed dependencies and the API's generated client
already available. Have the environment owner verify the effective
`DATABASE_URL` and `REDIS_URL` before any command, without publishing their
credentials. Do not inherit another installation's environment or reset an
existing database to obtain this baseline.

For a future authorized rehearsal, from the repository root:

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

In Gestión `/`, verify ANRAS and Casa Central. Point out **Ventas confirmadas
hoy** and **Total operado hoy**, computed by `GET /dashboard/summary` using
`confirmedAt` and the company's local day.

Expected starting point: **2 confirmed sales / ARS 28.900,00**:

- DEMO-SEED-01: Ferretería El Puente, Yerba mate 1 kg ×2 and Resma A4 ×1:
  2 × 8.500 + 6.500 = ARS 23.500,00.
- DEMO-SEED-02: Consumidor Final, Gaseosa cola 500 ml ×3 and Bolígrafo ×2:
  3 × 1.200 + 2 × 900 = ARS 5.400,00.

These expectations hold on the day those seed sales were first created.
Running the seed again on a later day does not move their dates forward.

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

Reload `/`: the expected daily aggregate is now **3 / ARS 50.900,00**.
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
   with one additional SALE movement, and the dashboard **4 / ARS 72.900,00**.

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

Only after this optional sale should the daily aggregate be
**5 / ARS 75.400,00**. Without it, the script ends at 4 / ARS 72.900,00.

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
- `DashboardService.getSalesToday` uses `confirmedAt` within the company's
  local calendar day. Its totals are grouped by currency. A baseline from
  another day or a previously used database requires fresh measurement.
- ANRAS uses CUIT placeholder `30-71876543-5`; company identifiers in this
  dataset are demonstration placeholders, not verified tax registrations.

## Rehearsal evidence — still pending

Record the tested SHA, local date/time and timezone, environment identity
without credentials, and actual observations alongside expectations:

1. After seed runs one and two, compare company-scoped IDs and counts for
   customers, products, variants, lists, price items/history, sales markers,
   numbers/dates/totals, stock movements and balances. Require no duplicates
   or extra inventory effect; do not require byte-for-byte equality of all
   rows, because upserts and password setup can write existing data.
2. Complete the timed walkthrough; record selected context, prices, sale
   numbers and totals, tender/change, and non-fiscal receipt wording.
3. For each confirmed tracked line, match the SALE movement and resulting
   stock delta; compare both apps and the daily aggregate. Record the
   optional sale separately and verify other warehouses are unchanged.
4. Keep browser observations, seed results and any separately run automated
   suites distinct. Do not label Task 015 DONE until this evidence exists.

No migrations, seed, application tests/build, servers or database
connections were executed for this documentation reconciliation.
