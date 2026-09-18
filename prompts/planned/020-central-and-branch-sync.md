# Task 020 — Central in the cloud and branch sync

Status: PLANNED
Depends on: — (the per-shop installer is already in `main`, PR #51)
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

Before making changes:

- Read AGENTS.md — in particular "one backend", company scoping, the
  pricing invariant (history is never edited) and the ledger invariant.
- Read **`docs/deployment-model.md` first**. It is the decision this task
  implements, with the business constraints behind it; this file does not
  repeat them.
- Read `docs/multi-company-architecture.md`, `docs/products.md`,
  `docs/pricing.md`, `docs/customers.md`, `docs/inventory.md`,
  `docs/backups.md` (the agent this task extends) and
  `docs/server-installer.md`.
- Inspect the current implementation — treat repository state as source
  of truth, not this file or any prior conversation.

## Objective

Each shop is its own legal entity with its own ERP Server, and must keep
selling without internet. What the shops share — the product catalog,
price lists and customers — is today typed into each installation by
hand, and nobody can see another shop's stock.

This task adds a **central**, deployed in the cloud, that owns the shared
master data and hands it down to every shop, and collects a periodic stock
snapshot from each shop so any shop can look up the others.

## Scope

It is large enough to land as several PRs. A suggested order, each one
useful on its own:

1. **Identity and ownership.** A stable, global identity for a replicated
   record, independent of each database's own ids, and a marker that says
   "this row is owned by the central". A shop's API refuses writes to such
   rows — create, update, deactivate — with a clear error, **regardless of
   the caller's permissions**. Decide and document how one shared record
   maps into each shop's company, given that `Customer.code`/`taxId` and
   product codes are unique per company.
2. **Central deployment.** The same `apps/api` + Gestión, deployed on a
   Linux VM with Docker, behind a reverse proxy with a real certificate.
   `AUTH_COOKIE_SECURE` on, login rate-limited, PostgreSQL never exposed.
   A documented, repeatable deploy and its own backups (the agent's
   offsite copy already supports S3/B2/R2).
3. **Branch registration and authentication.** Each shop's server
   authenticates to the central with its own credential — a machine
   identity, not a user's session — issued when a shop is registered and
   revocable per shop. It only grants the sync endpoints, and only for that
   shop's company.
4. **Masters down: catalog, then price lists, then customers.**
   The agent pulls changes since its last cursor and applies them in one
   transaction per batch. The catalog comes first, with whatever it
   references (product lines, units, categories — whatever the schema
   requires). Price changes arrive as new `PriceListItem`/`PriceHistory`
   rows, never as edits of existing ones; DERIVED lists replicate their
   definition and stay computed at read time. Customers carry master data
   only — never a balance or a ledger entry.
5. **Stock up, and the lookup screen.** Each shop sends a dated snapshot
   of on-hand stock per product and warehouse; the central keeps the latest
   per shop and serves the others. A "Stock en otros locales" view, in
   Gestión and as a quick lookup in Facturación, shows each shop's number
   **with the snapshot's time**, and the shop's own stock live.

## Acceptance criteria

1. A shop with its network cable unplugged confirms sales, POS tickets and
   stock operations exactly as before, with the prices it last received.
   Sync failures are logged and retried, and never surface as an error in
   a sale.
2. A price changed in the central reaches a connected shop within the sync
   interval, as new history rows; the previous price is still in the shop's
   history, and sales confirmed before the change keep their snapshot.
3. In a shop, editing a replicated product, price list or customer is
   refused by the API — tested with a user who holds every permission.
4. Nothing transactional crosses: no `SalesDocument`, `StockMovement`,
   treasury movement or current-account entry is ever sent, received or
   created by sync. A remote snapshot never writes `InventoryBalance`.
5. Another shop's stock is shown with its snapshot time, and marked as not
   current when it is older than a threshold.
6. One shop's credential cannot read or write another shop's company data
   at the central (e2e test).
7. Re-applying the same batch twice changes nothing (idempotent), and a
   shop that was offline for days catches up from its cursor.
8. The central deploy is documented step by step, reaches HTTPS with a
   valid certificate, and survives a VM reboot.
9. `docs/deployment-model.md`, `docs/implementation-status.md` and each
   touched module doc are updated in the same PRs.

## Out of scope

- **Two-way or multi-master sync.** Shops never edit shared data; there is
  no conflict resolution to build. See the decision doc.
- Sharing anything transactional: sales, stock movements, purchases,
  treasury, current accounts, users or roles.
- Moving goods between shops of different legal entities. That is a
  commercial operation between companies, not a stock transfer, and needs
  its own design.
- Fiscal invoicing and ARCA's CAEA contingency — the fiscal task has to
  handle offline invoicing on its own terms.
- Migrating data out of Tango.
- Opening the central from `ERP.exe` on a domain without a port — the
  desktop client assumes fixed ports today (`apps/desktop/src/config.ts`),
  and the shops do not need it for this task.

## Open questions to settle before step 1

- **Which records are shared.** The decision doc assumes every product,
  price list and customer in the central goes to every shop. If some are
  per shop (a list only one shop uses, a customer only one shop serves),
  step 1 needs a way to target them.
- **Which company in the central owns the masters.** Today every master is
  owned by one company (`companyId`). The central needs a clear owner for
  records that belong to the group rather than to any one legal entity.
