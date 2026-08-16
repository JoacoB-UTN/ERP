# Roadmap

Two layers: a near-term **demo milestone** (a small, real, end-to-end
vertical slice), and a **full ERP roadmap** kept intentionally
high-level. See [implementation-status.md](implementation-status.md) for
what already exists — nothing in this document is implemented yet.

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
Products, Inventory, Pricing — see implementation-status.md). Nothing on
the Facturación/sale side exists yet: no cart, no sale confirmation, no
inventory-affecting checkout. That gap is the actual next milestone.

### Suggested upcoming milestones

Planning suggestions only — not started, not committed to this exact
scope or order. See `prompts/planned/` for any of these once a task
specification actually exists for it.

```
10  Demo Sales Core           — minimal SalesOrder/sale model, backend only
11  Facturación MVP           — select customer/product, build a sale, confirm
12  POS MVP                   — fast entry, cart, payment method, confirm (POS mode)
13  End-to-end integration    — sale confirmation reliably moves inventory,
                                 resolves price, and is visible in Gestión
14  Demo Dashboard / UX polish
15  Demo data + presentation flow
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
  Suppliers, purchase orders, goods receipts

Accounts Payable
  Supplier balances, payment scheduling

Treasury
  Bank accounts, cash management, checks, payment methods

Fiscal / ARCA
  Argentine tax authority integration, electronic invoicing

Taxes
  VAT calculation (PriceList.includesTax is metadata only today — no
  calculation engine exists)

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
