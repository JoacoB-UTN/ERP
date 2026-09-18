# Deployment model — a server in each shop, a central in the cloud

**Decision, 2026-09-18.** This replaces the open question "does the server
move to the cloud?" that had put task 018 (PR #40) on hold. The answer is
**no for selling, yes for sharing**: every shop keeps its own server, and a
central in the cloud shares the little that the shops have in common.

Read this before touching anything that crosses a shop boundary, and before
task 020 (`prompts/planned/020-central-and-branch-sync.md`).

## The constraints, as the business stated them

1. **A shop must never depend on internet to sell.** If the connection
   drops, invoicing and POS keep working.
2. **One database per company.** Each shop is its own legal entity (its own
   razón social and CUIT), so its sales, stock, cash and current accounts
   belong to it alone.
3. **No dedicated server machine in each shop.**
4. **What the shops share:** price lists and customers — "at most" — plus
   being able to look up the stock of another shop and of their own.
5. **Shared data is edited by whoever holds the permission**, not by
   location. Shop users simply do not get those permissions.
6. **The central lives in the cloud.**
7. Today they run Tango with its central-and-branches module.

## What that means

Constraints 1 and 3 only fit together one way: the database has to be in
the shop, on a machine that is already there. So **the ERP Server installs
on the shop's own PC** (the till, or one of the PCs if there are several),
not on a separate box. That is what `ERPServerSetup.exe` already does
([server-installer.md](server-installer.md)); it was validated on a
Windows 10 Home VM for exactly this. It is also what Tango's
central-and-branches setup does — a full installation per branch that
exchanges data with the central.

```
   Shop A (CUIT A)            Shop B (CUIT B)            Factory (CUIT F)
 ┌───────────────────┐      ┌───────────────────┐      ┌───────────────────┐
 │ ERP Server on the │      │ ERP Server on the │      │ ERP Server        │
 │ till PC           │      │ till PC           │      │                   │
 │ DB: company A     │      │ DB: company B     │      │ DB: company F     │
 │ sells offline     │      │ sells offline     │      │                   │
 └─────────┬─────────┘      └─────────┬─────────┘      └─────────┬─────────┘
           │   HTTPS, when there is a connection; never in the path of a sale
           └──────────────────────────┼──────────────────────────┘
                              ┌───────┴────────┐
                              │ Central (cloud)│  shared masters, edited here
                              │ Linux VM       │  stock snapshots of every shop
                              └────────────────┘
```

## What crosses a shop boundary — and what never does

| Data                                     | Direction                         | Nature in the shop                           |
| ---------------------------------------- | --------------------------------- | -------------------------------------------- |
| Product catalog                          | central → shops                   | replicated, read-only                        |
| Price lists (and their history)          | central → shops                   | replicated, read-only                        |
| Customers (master data only)             | central → shops                   | replicated, read-only                        |
| Stock on hand, per product and warehouse | each shop → central → other shops | a dated snapshot for lookup, never inventory |

**The product catalog is on this list although nobody asked for it**:
a price list is a list of prices _for products_, so sharing price lists
means the shops must agree on what the products are. It is replicated the
same way, and nothing else is possible without it.

**Never shared:** sales, stock movements, adjustments, transfers, purchases,
cash and bank movements, current-account ledgers, balances, users, roles.
Each is owned by one legal entity. A customer's _balance_ in shop A says
nothing about shop B, and must not appear there.

## Rules that follow

- **One owner per record.** Shared masters are owned by the central and
  edited only there — through Gestión connected to the central, by any user
  with the permission, from anywhere. A shop never edits a replicated
  record, **whatever the user's permissions**: the shop's API refuses the
  write. Permissions alone are not enough, because a local administrator
  exists in every installation.
- **No two writers, so no conflict resolution.** Multi-master sync (two
  shops editing the same record offline and merging later) is explicitly
  not built. It is where synchronisation projects go to die, and the
  business did not ask for it.
- **A sale never waits for the central.** Sync runs in the background agent
  (`apps/server-agent`, which already runs scheduled jobs) and only ever
  reads or writes replicated data. If the central is down, or the shop is
  offline, the shop sells with the last prices it received.
- **Stale data says it is stale.** Another shop's stock is shown with the
  time of its snapshot ("Local B, 14:32"), never as a live number.
- **Snapshots are not inventory.** A remote stock snapshot never becomes a
  `StockMovement` or an `InventoryBalance`; the ledger invariant in
  AGENTS.md is untouched. Moving goods between shops of different legal
  entities is a commercial operation between companies, not a stock
  transfer.
- **The existing invariants hold across the wire.** A replicated price
  change arrives as new `PriceListItem`/`PriceHistory` rows, never as an
  edit of history; a sale's price stays the snapshot taken at confirmation.
- **The central is the same code.** One backend, as AGENTS.md requires: the
  central is a deployment of `apps/api` and Gestión with its own database,
  not a second system. "Cloud-ready" was always meant to make this possible.

## Consequences

- **The Windows installer stays the primary deployment**, per shop. Task
  018 is no longer on hold for the cloud question; the installer was
  validated and merged in PR #51.
- **The central needs what a LAN install could skip**: HTTPS with a real
  certificate, a secure session cookie (`AUTH_COOKIE_SECURE`), login rate
  limiting, the database never exposed, and a way to deploy on Linux
  (Docker). The desktop client accepts `https://` but assumes fixed ports
  (`apps/desktop/src/config.ts`); that suits the shops and needs revisiting
  only if people open the central from `ERP.exe`.
- **Fiscal invoicing will need internet anyway.** Getting a CAE from ARCA is
  an online call. For a shop that must invoice offline, ARCA's contingency
  mechanism is the **CAEA** (codes requested in advance and reported
  afterwards). The fiscal task has to be designed around it; this decision
  does not solve it.
- **Migrating from Tango is separate work**, whichever way the servers are
  deployed.

## Rejected alternatives

- **One server in the cloud for everyone.** Simplest to run, and violates
  constraint 1: a dropped connection stops the till.
- **One server for the group (e.g. in the factory), shops over a VPN.**
  Same problem — the shops depend on the link — plus someone's PC has to
  stay on.
- **Full two-way sync of everything.** Not needed, since the shops are
  separate companies, and far harder than the rest of this put together.
