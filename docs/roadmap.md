# Roadmap

Two layers: a near-term **demo milestone** (a small, real, end-to-end
vertical slice — now complete, see below) and a **full ERP roadmap** kept
intentionally high-level and NOT yet implemented. See
[implementation-status.md](implementation-status.md) for the verified,
current state of every module.

## Why demo-first

The immediate product objective is **not** to implement every Tango-like
ERP feature before showing the product. It's to reach a small,
demonstrable, end-to-end slice that a prospective user can actually
interact with: create a customer and a product in Gestión, see it priced
and in stock, then go into Facturación and complete a simple sale that
visibly moves inventory and shows up back in Gestión. Everything else
(accounting, fiscal/ARCA, treasury, purchasing, reporting) comes after
that slice works and looks good.

## Demo milestone

Target flow:

```
Gestión
  └── Customer  (exists)
  └── Product   (exists)
  └── Inventory (exists)
  └── Price     (exists)

Facturación
  └── Select customer
  └── Search/scan product
  └── See price and availability
  └── Build a sale
  └── Confirm a simulated/real internal sale
  └── Inventory changes
  └── Operation visible in Gestión

Then, as a follow-up:

POS mode (inside Facturación)
  └── Fast product entry
  └── Cart
  └── Payment method
  └── Confirm
```

Every piece on the Gestión side of that flow already exists (Customers,
Products, Inventory, Pricing — see implementation-status.md), and the
sale itself exists (Prompt #10, see [sales.md](sales.md)). The Facturación
side of the same flow is implemented too (Prompt #11, see
[facturacion.md](facturacion.md)): select customer, search/scan a
product, see its real price and warehouse availability, build a sale,
confirm it, watch inventory actually change, see it back in Gestión.
**POS mode is now implemented as well** (Prompt #12, see
[pos.md](pos.md)) — fast counter-sale entry with a payment method
(cash/card/transfer/other), all inside Facturación, calling the same
Sales domain. The full demo milestone described above is complete and
has been hardened end to end (Prompt #13, see
[implementation-status.md](implementation-status.md)) — integration
tests and manual verification confirm Gestión, Facturación, and POS all
share one Sales domain, one pricing engine, and one inventory ledger, and
one real frontend defect (a swallowed confirm-failure error message) was
found and fixed in the process. **Demo dashboard/UX polish is now
complete as well** (Prompt #14, see [dashboard.md](dashboard.md)) —
Gestión's home page is a real permission-aware operational dashboard
backed by one small read-only aggregate endpoint, replacing the stale
placeholder home page; stale foundation-era copy and a real date-format
inconsistency across several history/audit screens were fixed in the
process. **Warehouse transfers are now implemented too** (Prompt #16, PR
#33 — see [inventory.md](inventory.md)): moving stock between two
warehouses is one document with an atomic OUT/IN pair and a compensating
cancellation, rather than two unrelated adjustments.

**That closed the commercial circuit.** Suppliers, purchase orders, goods
receipts, customer and supplier current accounts, collections, payments and
warehouse transfers are all in `main`, so the internal buy/sell/stock/
account loop a PyME runs day to day is complete — see
[implementation-status.md](implementation-status.md) for what each of those
does and does not cover.

**Current priority (2026-10-03): review the catalog adoption diagnostic.**
The clean Windows validation is already recorded as DONE in PR #51, and
current-account backfill already runs on API startup. They are not open
prerequisites for this work; see [server-installer.md](server-installer.md)
and [implementation-status.md](implementation-status.md).

PR #62 integrated account/statement/transfer screens against the existing
ledger and corrective-deficit recovery. A subsequent core browser rehearsal
passed; see [acceptance evidence](acceptance-2026-10-03.md). POS settlement, reconciliation, cheques and FX are separate
future decisions, not implied by these screens.

Task 026 implements a read-only catalog adoption diagnostic on the review
branch; see [central-sync-diagnostics.md](central-sync-diagnostics.md).
Whether the first shop starts empty or preserves existing data
is not yet decided; the diagnostic can cover both without enabling replication
or changing local records. Identity/ownership and actual replication follow
in separate reviewed changes. Tango migration and fiscal work remain later stages.
Demo task 015 has passed double-seed and core sale/POS rehearsal; the timed
presentation, optional card sale and print checks remain pending.

### Suggested upcoming milestones

Planning suggestions only, except #10-#13 which are now implemented —
not committed to this exact scope or order for the rest. See
`prompts/planned/`/`prompts/completed/` for the actual task record of
each.

```
10  Demo Sales Core           — DONE (see prompts/completed/, docs/sales.md).
                                 SalesDocument/SalesDocumentLine, DRAFT/
                                 CONFIRMED/CANCELLED, price snapshot via
                                 PricingService, inventory decrement via
                                 InventoryService, Gestión /ventas UI.
11  Facturación MVP           — DONE (see prompts/completed/, docs/facturacion.md).
                                 Customer/product/barcode search, cart, draft/
                                 confirm, calling the SAME SalesService from
                                 #10 — zero new endpoints or tables.
12  POS MVP                   — DONE (see prompts/completed/, docs/pos.md).
                                 Keyboard-first checkout mode inside
                                 Facturación; one new table (SalesTender, an
                                 operational payment snapshot, never Treasury)
                                 and one optional field on the existing
                                 confirm endpoint — still the same SalesService.
13  End-to-end integration    — DONE (see prompts/completed/, docs/implementation-status.md).
                                 Hardening across Gestión/Facturación/POS sale
                                 confirmation, pricing resolution, and inventory
                                 effect — new integration/concurrency tests, one
                                 real frontend defect found and fixed (a
                                 swallowed confirm-failure error message).
14  Demo Dashboard / UX polish   — DONE (see prompts/completed/, docs/dashboard.md).
                                 Real Gestión home dashboard (GET
                                 /dashboard/summary, permission-gated,
                                 zero duplicated business rules), stale
                                 copy fixes, and a real date-formatting
                                 consistency fix across five screens.
15  Demo data + presentation flow   — PARTIAL: dataset and guide exist;
                                       core runtime rehearsal passed; timed/optional checks pending.
16  Warehouse transfers      — DONE (see prompts/completed/, docs/inventory.md).
                                 StockTransfer/StockTransferLine, DRAFT/
                                 CONFIRMED/CANCELLED, TRANSFER_OUT+TRANSFER_IN
                                 written in one transaction (OUT first), and a
                                 cancellation that ADDS a compensating pair
                                 instead of editing the ledger. Closes the
                                 internal commercial circuit.
17  Clean Windows VM install — DONE (PR #51, docs/server-installer.md).
                                 Install, upgrade, reinstall over kept data
                                 and uninstall, on a Spanish Windows 10 Home
                                 VM, from the compiled .exe.
20  Central + branch sync     — PLANNED (prompts/planned/020-central-and-branch-sync.md).
                                 A server in each shop, a central in the
                                 cloud that owns catalog, price lists and
                                 customers and collects stock snapshots.
                                 See docs/deployment-model.md.
```

Do not begin any of these from this document — each needs its own task
specification under `prompts/planned/` (see
[prompts/README.md](../prompts/README.md)) before an agent or developer
starts it.

## Full ERP roadmap (high-level, no implementation order implied)

```
Sales
  Sales orders / quotes, delivery notes, sales invoices, credit/debit notes

Accounts Receivable
  Customer balances (ledger-derived — never a stored column), collections

Purchases
  Suppliers, purchase orders, goods receipts — DONE, see docs/purchases.md.
  Remaining: fiscal purchase invoices, ARCA purchase integration.

Accounts Payable
  Supplier balances, payment scheduling

Treasury
  Cash boxes, bank accounts and the movement ledger — PARTIAL, see
  docs/treasury.md. The ledger, accounts, opening balance and statement
  exist, plus transfers between accounts and automatic posting/reversals
  from Cobros/Pagos. POS settlement remains deliberately excluded.
  Gestión screens are integrated in PR #62 with core browser acceptance; cheques, reconciliation and FX are not started.

Fiscal / ARCA — PARTIAL
  Persisted preparation drafts from confirmed ARS sales with explicit IVA
  breakdown, declared issuer/test-PV settings and a public availability probe
  now exist; see docs/fiscal.md. Next: secure credentials, authenticated fiscal
  profile/catalog validation, WSAA/WSFE authorization and reconciliation, CAE/QR.
  No authorized electronic invoicing yet.

Taxes
  Explicit draft VAT breakdown implemented; PriceList.includesTax remains
  metadata. Automatic tax determination and live fiscal validation pending.

Accounting
  Chart of accounts, journal entries, ledger posting from business events

Reporting
  Dashboards, exports, business intelligence

Imports/Exports
  Bulk data import/export tooling

Integrations
  Third-party/e-commerce integrations
```

Each of these, when actually started, gets its own `docs/<module>.md`
(see the pattern already established by customers.md/products.md/
inventory.md/pricing.md) and its own entry in
[implementation-status.md](implementation-status.md).
