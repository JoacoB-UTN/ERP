# Roadmap

Last updated: **2026-09-01**.

For the detailed shareable status note, see [project-status-roadmap.md](project-status-roadmap.md). For exact implemented behavior, [implementation-status.md](implementation-status.md) and the domain docs remain the technical source of truth.

## Product direction

> **Primero Local, pero Cloud-ready. Nunca Cloud-first si retrasa el producto local; nunca Local-only si obliga a reescribir el core después.**

The ERP is one product/core with multiple future deployment modalities:

1. **Local** — customer server + LAN clients + ERP.exe.
2. **Cloud** — same core/API/business modules hosted on managed infrastructure.
3. **Hybrid** — future combination of local operation and selected cloud services.

The near-term objective is a **vendable local ERP for Argentine SMBs**, not a premature SaaS platform.

## Current verified milestone

GitHub `main` currently contains the product through **Prompt #21 / PR #18 — Suppliers + Purchase Orders + Goods Receipts**.

Implemented foundations already include:

- auth, multi-company/branch context, RBAC, audit;
- customers, products, warehouses, inventory ledger, pricing;
- Sales core, Gestión sales UI, Facturación and POS;
- realistic demo data + operational dashboard;
- LAN realtime notifications;
- Electron thin client with runtime server configuration;
- Suppliers, Purchase Orders and Goods Receipts with partial receiving and concurrency protection.

**Prompt #22 — Current Accounts + Collections + Supplier Payments** has been worked on locally, but at the time of this roadmap update it is not yet represented by a remote branch/PR in GitHub and therefore is not counted as implemented in `main`.

---

## PHASE 1 — LOCAL OPERATIONAL ERP

**Status: mostly complete; deployment/operations remain.**

### Done

- [x] Architecture / modular monolith
- [x] Authentication
- [x] Multi-company and branch context
- [x] RBAC
- [x] Audit
- [x] Customers
- [x] Products/catalog
- [x] Pricing
- [x] Inventory ledger
- [x] Sales
- [x] Facturación
- [x] POS
- [x] LAN realtime
- [x] Electron thin client

### Remaining before calling the Local distribution fully productized

- [ ] ERP Server installer/service
- [ ] Stable service lifecycle for API/PostgreSQL/Gestión/Facturación
- [ ] Basic backup automation
- [ ] Restore workflow tested end-to-end
- [ ] Support diagnostics/log collection
- [ ] Safe upgrade/migration procedure for installed customers

---

## PHASE 2 — COMPLETE COMMERCIAL CIRCUIT

**Status: in progress.**

### Done

- [x] Suppliers
- [x] Purchase Orders
- [x] Goods Receipts
- [x] Partial receiving

### In progress / next

- [~] Customer current accounts — Prompt #22 local work
- [~] Supplier current accounts — Prompt #22 local work
- [~] Collections — Prompt #22 local work
- [~] Supplier payments — Prompt #22 local work
- [ ] Stock transfers
- [ ] Final commercial-flow polish

Permanent accounting-style rule: balances must be ledger-derived, never mutable authoritative `balance` columns.

---

## PHASE 3 — FINANCE / TREASURY

**Status: not started.**

- [ ] Cash / cashboxes
- [ ] Opening and closing cash registers
- [ ] Banks
- [ ] Mercado Pago
- [ ] Treasury movements
- [ ] Reconciliation
- [ ] Financial multicurrency
- [ ] Checks/values if commercially required

`SalesTender` remains an operational checkout snapshot; Treasury will be a distinct financial ledger.

---

## PHASE 4 — FISCAL / ARCA

**Status: not started.**

- [ ] Fiscal documents
- [ ] Electronic invoicing / CAE
- [ ] ARCA integration
- [ ] VAT/tax calculation
- [ ] Credit notes
- [ ] Debit notes
- [ ] Required fiscal reporting

The existing `SalesDocument` is an internal commercial transaction, not a fiscal invoice.

---

## PHASE 5 — ADVANCED MANAGEMENT

**Status: not started.**

- [ ] Costs
- [ ] Profitability / margins
- [ ] Lots / batches
- [ ] Traceability
- [ ] Advanced logistics
- [ ] Management reporting

---

## PHASE 6 — MEDIUM / INDUSTRIAL COMPANY

**Status: not started.**

- [ ] Accounting
- [ ] Chart of accounts / journal entries
- [ ] Cost centers
- [ ] Imports
- [ ] Production
- [ ] BOM / formulas
- [ ] Production orders
- [ ] Industrial costing

---

## PHASE 7 — AUTOMATION / ECOSYSTEM

**Status: not started.**

- [ ] AI/OCR document ingestion
- [ ] Mercado Libre
- [ ] External APIs/integrations
- [ ] Automations
- [ ] Improved bulk import/export

---

## PHASE 8 — CLOUD

**Status: architecture prepared; infrastructure not implemented.**

The current core already follows important Cloud-ready rules:

- one API as the business-data entry point;
- strict company isolation;
- runtime deployment configuration instead of fixed host assumptions;
- frontends and Electron do not connect directly to PostgreSQL;
- business domain is not coupled to Electron or a specific OS;
- reproducible migrations;
- realtime is an invalidation transport while REST + PostgreSQL stay authoritative.

Future work:

- [ ] Managed deployment
- [ ] HTTPS/domains
- [ ] Provisioning
- [ ] Managed backups
- [ ] Observability
- [ ] Multi-instance architecture only when required
- [ ] SaaS subscriptions/billing only when a real commercial need exists

Do **not** prematurely build Kubernetes/AWS-specific/autoscaling architecture.

---

## Recommended immediate sequence

1. Recover and inspect the local Prompt #22 working tree.
2. Commit/push it to `agent/claude-current-accounts` and open a draft PR.
3. Review and merge only after ledger/concurrency/backfill/isolation verification.
4. Build the ERP Server installer/runtime.
5. Add backup + restore + support diagnostics.
6. Add stock transfers if needed by the first customer profile.
7. Treasury.
8. Fiscal/ARCA.
9. Advanced management / accounting / industrial modules as demand justifies them.

## Positioning

> **ERP moderno para PyMEs argentinas, desde un comercio hasta una empresa mediana, con modalidad local primero y preparado para Cloud.**
