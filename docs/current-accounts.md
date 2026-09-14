# Current Accounts, Collections and Supplier Payments

Cuentas corrientes de clientes y proveedores, Cobros and Pagos.

This document is cited from roughly a hundred comments across
`apps/api/src/accounts`, `packages/shared` and the Prisma schema. It is the
written form of the rules those comments point at; the code and its tests
remain the source of truth.

## What this module is — and isn't

It is **two immutable ledgers** — one per customer, one per supplier — plus
the two documents that post to them: a **Cobro** (money in) and a **Pago**
(money out).

It is **not** treasury. Nothing here knows about a cash drawer, a bank
account or a reconciliation; a Cobro records that a customer paid, not where
the money landed. That is Fase 3 (see [roadmap.md](roadmap.md)), and the
`PaymentMethod` on a Cobro is a label on the document, never a posting to an
account of ours.

It is also **not** invoicing. `SalesDocument` is not a fiscal invoice (see
[sales.md](sales.md)), so what a customer owes here is what our own sales
documents say, not what ARCA has stamped.

## The ledgers

`CustomerAccountMovement` and `SupplierAccountMovement` are append-only. A
balance is **never stored** — every figure in this module is `SUM(movements)`
computed at read time, exactly as inventory derives stock from
`StockMovement` (see [inventory.md](inventory.md)).

That is the whole reason a balance can be trusted: there is no second copy to
drift, and the only way to change one is to add a movement that says why.

### Sign convention

Positive means **the counterparty owes us** on the customer side, and **we
owe them** on the supplier side.

| Customer movement | Sign | Posted when |
| --- | --- | --- |
| `SALE_CHARGE` | + total | A sale is confirmed |
| `TENDER_SETTLEMENT` | − total | That sale carried a tender (paid at the counter) |
| `COLLECTION` | − amount | A Cobro is confirmed |
| `COLLECTION_REVERSAL` | + amount | A **confirmed** Cobro is cancelled |

| Supplier movement | Sign | Posted when |
| --- | --- | --- |
| `PURCHASE_RECEIPT_ACCRUAL` | + total | A goods receipt is confirmed |
| `PURCHASE_RECEIPT_REVERSAL` | − total | A confirmed receipt is cancelled |
| `SUPPLIER_PAYMENT` | − amount | A Pago is confirmed |
| `SUPPLIER_PAYMENT_REVERSAL` | + amount | A confirmed Pago is cancelled |

`CREDIT_NOTE`, `DEBIT_NOTE`, `PURCHASE_INVOICE`, `PURCHASE_CREDIT_NOTE`,
`OPENING_BALANCE`, `ADJUSTMENT` and `WRITE_OFF` exist in the enum and are
**never written by this module**. They are reserved so a later feature (credit
notes, an opening-balance import) can add behaviour without a migration.

`TENDER_SETTLEMENT` always uses the sale's **total**, never
`amountReceived` — handing over a larger bill is change at the counter, not a
larger payment. The caller enforces that; the account service does not
re-derive it.

### Multi-currency

A balance is **per currency**. There is no exchange rate anywhere in this
system, so there is no single number that means "what this customer owes":
100.000 ARS owed and 200 USD in credit are two facts.

Every read that returns one figure — a statement, an open-documents list —
therefore **requires** a `currencyId`. The list endpoints return an array of
balances, one per currency, and Gestión renders one line each.

## The documents

A Cobro and a Pago are the same shape mirrored, and everything below applies
to both.

### State machine

```
DRAFT ──confirm──> CONFIRMED
  │                    │
  └─────cancel─────────┴──cancel──> CANCELLED
```

`CONFIRMED` is **not terminal.** This is a deliberate exception to the
convention `SalesDocument` and `PurchaseOrder` follow, and it matches
`PurchaseReceipt` (see [purchases.md](purchases.md)): money gets recorded
against the wrong customer, and the fix has to be possible.

Cancelling never deletes anything. A `DRAFT → CANCELLED` has **zero** ledger
effect, because a draft never posted. A `CONFIRMED → CANCELLED` posts a
compensating reversal, so the account shows both the payment and its
undoing — reversal instead of erasure, the same rule the rest of the system
follows.

Applications are **never deleted** on cancellation either. A cancelled Cobro
keeps its record of what it had been applied to.

### Applications, and the money that isn't applied

An application says "this much of this Cobro pays down that sale". The sum of
a document's applications is **not required to equal its amount**, and the
remainder is a real, supported outcome: unapplied money is a credit on the
account.

That matters because it is the ordinary case, not an edge case. A customer
hands over money before there is anything to put it against; a round payment
covers three invoices and change. Forcing the numbers to reconcile at entry
time would make the screen lie about what happened.

The consequence to understand: **unapplied money moves the account balance
but no document's outstanding.** A 5.000 Cobro with no applications lowers
what the customer owes overall while every individual sale stays exactly as
outstanding as it was. Both figures are correct and they are answering
different questions.

### What is refused

| Code | Why |
| --- | --- |
| `*_NOT_EDITABLE` | Only a `DRAFT` can be edited |
| `*_ALREADY_CONFIRMED` / `*_ALREADY_CANCELLED` | The transition already happened |
| `*_APPLICATION_*_MISMATCH` | The target document belongs to a different customer/supplier |
| `*_APPLICATION_*_NOT_CONFIRMED` | Cannot pay down a draft or cancelled document |
| `*_APPLICATION_CURRENCY_MISMATCH` | The target is in another currency |
| `*_APPLICATIONS_EXCEED_AMOUNT` | The applications sum to more than the document itself |
| `*_OVER_APPLICATION` | The target would end up more than fully paid |
| `PURCHASE_RECEIPT_HAS_ACTIVE_PAYMENTS` | A receipt cannot be cancelled while confirmed payments still point at it |

Duplicated targets inside one request are rejected by the shared Zod schema
before the service sees them; the database's own unique constraint on
`(document, target)` is the authoritative guard.

## Concurrency

`confirm()` guards its own `DRAFT → CONFIRMED` transition **first** — a
conditional `UPDATE ... WHERE status = 'DRAFT'` — and only then locks the
target documents, in deterministic id order, before recomputing their
outstanding.

That ordering is the point. Two concurrent confirms of the same Cobro: only
one wins the status flip, so only one posts. Two different Cobros racing to
pay the same sale: both pass their own status guard, then serialize on the
sale's row lock, and the second recomputes outstanding against the first's
result and is refused with `OVER_APPLICATION`. Locking in id order is what
keeps two documents touching the same pair of sales from deadlocking.

Posting is also guarded at the database: every movement carries
`@@unique([companyId, sourceType, sourceId, movementType])`. A double-confirm
that somehow got past the status guard fails loudly on that constraint
instead of silently charging twice.

## Integration with Sales and Purchases

`SalesService.confirm()` calls `CustomerAccountService.postSaleConfirmation()`
**inside its own transaction**, alongside the stock movement and the status
change. `PurchaseReceiptsService` does the same on confirm and cancel.

They are one transaction on purpose: a confirmed sale that moved stock but
did not charge the account would be a silent accounting hole, and it must not
be possible for one to succeed without the other.

## Permissions

Reading a balance and moving money are different jobs, so they are different
permissions (see [authorization.md](authorization.md)).

| Permission | Covers |
| --- | --- |
| `accounts.receivable.read` | Customer balances, statements, open sales |
| `accounts.payable.read` | Supplier balances, statements, open receipts |
| `treasury.receipts.read/create/update/confirm/cancel` | Cobro documents |
| `treasury.payments.read/create/update/confirm/cancel` | Pago documents |

The Cobro/Pago codes reuse the pre-existing `treasury.*` namespace, reserved
before this module existed, rather than a parallel `accounts.collections.*`.
`confirm` and `cancel` are separate from `create` because approving money is
a different level of trust from drafting it.

## API

All routes are company-scoped (see [multi-company-architecture.md](multi-company-architecture.md)).

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/customer-accounts` | `accounts.receivable.read` |
| GET | `/customer-accounts/:customerId` | `accounts.receivable.read` |
| GET | `/customer-accounts/:customerId/statement?currencyId=` | `accounts.receivable.read` |
| GET | `/customer-accounts/:customerId/open-sales?currencyId=` | `accounts.receivable.read` |
| GET | `/sales-documents/:id/outstanding` | `accounts.receivable.read` |
| GET/POST | `/customer-collections` | `treasury.receipts.read` / `.create` |
| GET | `/customer-collections/:id` | `treasury.receipts.read` |
| PATCH | `/customer-collections/:id` | `treasury.receipts.update` |
| POST | `/customer-collections/:id/confirm` | `treasury.receipts.confirm` |
| POST | `/customer-collections/:id/cancel` | `treasury.receipts.cancel` |

The supplier side mirrors this exactly: `/supplier-accounts`,
`/supplier-accounts/:supplierId/open-receipts`,
`/purchase-receipts/:id/outstanding` and `/supplier-payments`.

## Gestión

`/cuentas-corrientes/clientes` and `/cuentas-corrientes/proveedores` — list
with per-currency balances and last movement; detail with the statement
(debit / credit / running balance) and the documents still outstanding.

`/cobros` and `/pagos` — list with a status filter, create, and a detail
screen with Confirmar and Anular.

Two rules the UI follows and should keep following:

- **The running balance comes from the API and is never recomputed in the
  browser.** Recalculating it would mean adding money with JavaScript
  numbers, and it would disagree with the API the moment a filter changed the
  visible window.
- **Debit and credit are separate columns**, not one signed amount. That is
  how a statement is read here, and it makes each line's direction obvious
  without decoding a sign.

## The historical backfill

`npm run db:backfill-current-accounts --workspace=apps/api` posts movements
for sales and receipts that were confirmed **outside** the live service
path — genuinely historical data from before this module existed, or demo
fixtures inserted directly by the seed.

It is **idempotent by construction, not by a flag**: every insert is
`createMany({ skipDuplicates: true })` against the same unique constraint the
live path uses. Running it twice, or after new sales have been confirmed
normally, inserts nothing the second time.

Semantics it applies:

- Sale `CONFIRMED` → `SALE_CHARGE`, plus `TENDER_SETTLEMENT` if it has a
  tender. `DRAFT`/`CANCELLED` → nothing; a cancelled sale never charged.
- Receipt `CONFIRMED` → accrual. `CANCELLED` **but previously confirmed**
  (`confirmedAt` set) → accrual **and** reversal, so the history shows both.
  `CANCELLED` without ever confirming, or `DRAFT` → nothing.

### It runs on API startup — decision taken

The gap this section used to describe is closed. `CurrentAccountsBackfillService`
(`apps/api/src/accounts/current-accounts-backfill.service.ts`) runs the backfill
on `onApplicationBootstrap`, so an installation that upgrades into this module
posts its historical movements the first time the API comes up, with nobody
needing to know the script exists. The CLI still works and is still the way to
do it by hand.

**Why a startup check, and not the other two options.**

- **Not a migration.** A Prisma migration is SQL, and the semantics above are
  not mechanical: a confirmed sale posts `SALE_CHARGE` *plus* `TENDER_SETTLEMENT`
  only when it has a tender, and a receipt `CANCELLED` after being confirmed
  posts an accrual *and* its reversal while one cancelled straight from draft
  posts nothing. Restating that in SQL would create a second copy of the rules
  to keep in step with the TypeScript one. A migration also runs exactly once,
  so the planned Tango data migration would land historical rows it would never
  see.
- **Not an installer step.** It would fix the Windows `.exe` path and leave
  Docker, manual upgrades and development alone with the same empty ledger.

**Why running it on every boot is safe.** The backfill is idempotent by
construction (above), and it only ever *inserts* — it never updates or deletes
a movement, so it cannot damage a ledger that is already correct. A cheap
`EXISTS` probe runs first, so a healthy installation pays one query per boot
and loads nothing.

**How it behaves:**

- The probe runs outside any transaction or lock. If the ledger is complete,
  that single query is the whole cost and nothing else happens.
- When there is work, everything runs inside one `$transaction` holding a
  **transaction-scoped** advisory lock (`pg_try_advisory_xact_lock`). Several
  API instances can boot at once on a LAN; one does the work and the others
  move on. A session-scoped lock would be wrong here: Prisma gives each
  standalone query whichever pooled connection is free, so the lock and its
  release can land on different connections — the release then fails silently
  and the lock is held until that connection dies, which on a long-lived API
  process means the backfill never runs again.
- It re-probes inside the lock, in case another instance finished in between.
- Documents are read in batches (`BACKFILL_BATCH_SIZE`), so an installation
  with years of history does not load all of it into memory at boot.
- It never blocks or crashes startup. A failure is logged with the command to
  run by hand, and the API serves anyway: a ledger still missing rows is bad,
  an API that will not boot is worse.
- It writes one `AuditLog` row, in the same transaction as the movements, and
  only when it actually posted something. The row carries no `companyId`,
  `tenantId` or `userId` — the backfill spans every company and has no actor,
  and inventing one would be a lie (see the comment above `model AuditLog`).

**Turning it off.** `ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT=false` skips the
load, for an operator who would rather run
`npm run db:backfill-current-accounts --workspace=apps/api` themselves. It
turns off the **write**, not the question: the cheap `EXISTS` probe still
runs at boot, so an installation whose ledger the operator already loaded is
recognised as complete instead of being refused. Nothing is posted either
way.

That distinction is the whole difference between a flag and a trap. Without
the probe, `disabled` is terminal — nothing else ever revisits it — and the
module answers 503 for the life of the process even once the ledger is
loaded, which would make the documented recovery below impossible.

### The module refuses to answer until the ledger is loaded

A balance here is derived from the ledger, so a ledger still missing its
history does not answer *wrong* in any visible way — it answers **zero**,
confidently. An installation that has just upgraded would show every
customer owing nothing, and "no debe nada" is indistinguishable from "we
have not loaded the history yet".

So `CurrentAccountsReadyGuard` sits on every Current Accounts controller and
refuses with **503 `CURRENT_ACCOUNTS_NOT_READY`** unless the backfill state
is `complete`. 503 rather than 500 or an empty list: the request is not
wrong, the server is not ready to answer it, and it will be shortly.

The states, and why each is or is not served:

| State | Served? | Meaning |
|---|---|---|
| `complete` | yes | A pass finished and the probe says nothing is outstanding |
| `pending` | no | Nothing has finished yet, or a pass ended with work still outstanding |
| `running` | no | A pass is in flight |
| `failed` | no | A pass threw; the reason is kept for the operator panel |
| `disabled` | no | Turned off by configuration **and** the probe found work outstanding |

`disabled` is **not** `complete`. Turning the automatic load off hands the
responsibility to an operator; it does not make the ledger correct, and the
gate must not imply that it did. But the flag does not decide the state on
its own either — with it off, a ledger the probe finds nothing outstanding
in reports `complete` and is served. So an installation that runs the script
by hand and restarts really does get `complete` on the next boot, with the
flag still off. (If the probe itself cannot run, the state is `disabled`:
nothing was established, so nothing is claimed.)

**`pending` is re-checked, not trusted.** On a LAN two API instances boot
together; the one that loses the advisory lock skips its own pass and
records `pending`, which is true at that moment — and nothing else would
ever revisit it, so that process would refuse current accounts for its whole
life over a ledger that is in fact loaded. The guard calls
`refreshIfPending()`, one cheap `EXISTS` per request while pending and never
again once it resolves.

### What the operator sees

Gestión's **Estado del sistema** panel reads the state from `GET /health`
and shows one row: **Al día**, **Ejecutando…**, **Falló**, **Desactivado**
or **Pendiente**. While it is anything but *Al día*, the panel's overall
verdict says *Cuentas corrientes no disponibles* rather than *Sistema
operativo* — the infrastructure being healthy is not the same as the ERP
being able to answer, and saying otherwise would contradict the screen the
operator just hit.

The row is a **state word and nothing else**: no counts, no company names,
no amounts. `GET /health` is unauthenticated.

The backfill state deliberately does not move `/health`'s own `status`,
which stays a statement about infrastructure liveness. A backfill that has
not finished does not make the server unhealthy; it makes one module unable
to answer, and that is enforced where it matters, by the gate.

## Deferred

- **No UI for editing a draft.** `PATCH` exists and is wired, but from
  Gestión a draft can only be confirmed or cancelled.
- **No date filters in the UI**, though the statement and list endpoints
  accept `dateFrom`/`dateTo`.
- **No UI tests** for any of the ten screens.
- **Nothing in Facturación/POS.** A cashier cannot take a payment against an
  account; the POS's own tender path posts `TENDER_SETTLEMENT` and stops
  there.
- **No credit limit enforcement.** `Customer` has no balance column by design
  (see [customers.md](customers.md)) and nothing blocks a sale to a customer
  over their limit.
- **No aging report** (saldos por antigüedad), which is the first thing an
  administrator will ask for after this.
