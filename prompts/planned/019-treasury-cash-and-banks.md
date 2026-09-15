# Task 019 — Treasury: cash boxes, bank accounts and the movement ledger

Status: PLANNED
Depends on: — (see "Relationship to the installer" below)
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

Before making changes:

- Read AGENTS.md, in particular the `SalesTender` invariant, the
  ledger invariant and the Decimal invariant.
- Read `docs/implementation-status.md`, `docs/current-accounts.md`
  ("Cobros" and "Pagos"), `docs/inventory.md` (the ledger/projection
  pattern this task copies) and `docs/pos.md` (why `SalesTender` is not
  Treasury).
- Inspect the current implementation — treat repository state as source
  of truth, not this file or any prior conversation.

**Relationship to the installer.** `docs/roadmap.md` says the clean
Windows VM install is next and "everything else waits on it". That
sequencing is about *shipping*, not about this task: nothing here touches
`infrastructure/windows/**`, the payload, or the installer workflow, and
the module is deployment-agnostic by the Local-first / Cloud-ready rule.
It can be specified and built in parallel; it must not be presented as
unblocking the installer, and it does not close Fase 1.

## Objective

**The ERP records how people paid and never records where the money
went.** Three places in the codebase capture a payment method today:

- `SalesTender` — a POS sale's cash/card/transfer snapshot.
- `CustomerCollection.paymentMethod` — a Cobro.
- `SupplierPayment.paymentMethod` — a Pago.

All three are descriptive strings against a `SalesTenderMethod` enum. The
schema says so out loud, twice, in the comment above `paymentMethod`:
*"purely descriptive, never touches a cash/bank balance (Treasury is out
of scope for this task)"*. So a business can confirm a Cobro of
$500.000 in cash and a Pago of $300.000 by transfer, and the system holds
no answer whatsoever to "how much is in the drawer" or "what is the bank
balance" — not a wrong answer, no answer at all.

This task creates the missing home: **treasury accounts and an immutable
ledger of the movements that hit them.**

There is a second, quieter reason to do it now. The permission catalogue
already reserves `treasury.read`, and the seed already ships a
**"Tesorería" role** whose description is *"Gestiona cobros y pagos"*.
The vocabulary exists, the role exists, and there is no module behind
either. Anyone reading `system-roles.ts` would reasonably conclude
Treasury is implemented.

## The design decision this task must make deliberately

AGENTS.md states, as a permanent invariant:

> **`SalesTender` … is an operational snapshot, not a Treasury ledger.**
> Confirming a sale with a tender never updates a cash balance, bank
> balance, or customer account. **Do not wire it into any future
> Treasury/AR module without a deliberate, separate design decision.**

**The decision taken: this task does NOT wire `SalesTender` into
Treasury.** It wires the two *documents* — Cobro and Pago — and leaves
POS for its own task. The reasons, in order of weight:

1. **A tender does not know which drawer it went into.** `SalesTender`
   has no treasury account, no terminal and no till; `SalesDocument.branchId`
   is optional. Posting POS cash to a balance requires first deciding
   *which* cash box a given terminal feeds, which is a modelling and a
   Facturación UX change — not a side effect to slip into this task.
2. **POS must stay fast and keyboard-first** (`docs/product-ui-principles.md`).
   Adding a required "caja" selection to the checkout path is a product
   decision about the fastest screen in the system, and it deserves to be
   made on its own, not as the tail of a backend task.
3. **Cobro and Pago are already the right seam.** They are explicit
   documents with DRAFT/CONFIRMED/CANCELLED, an operator who already
   chooses a payment method, and a schema comment that literally marks
   the spot where Treasury was expected to plug in.

**The cost of that decision, which must not be hidden.** A cash box fed
by a POS terminal will report a balance that excludes POS cash — a number
that is *wrong for the drawer*, not merely incomplete. Criterion 9 below
requires that to be visible in the product, not only in a doc. The
precedent is the Current Accounts readiness gate: a derived number that
cannot yet be trusted must say so where it is read, because a confident
wrong number is worse than a refusal.

## Acceptance criteria

1. **Ledger-based, exactly like inventory.** `TreasuryMovement` is the
   single authoritative record of money entering or leaving an account.
   `TreasuryAccountBalance` is a **rebuildable projection**, never a
   second source of truth, with a documented rebuild path equivalent to
   `InventoryService.rebuildInventoryBalances()`. If a balance and the
   ledger ever disagree, the ledger wins. No authoritative balance column
   on `TreasuryAccount`.

2. **`TreasuryAccount`**, company-scoped, with:
   - a `type` of `CASH_BOX` or `BANK_ACCOUNT`;
   - exactly **one currency** (`currencyId`), never mixed — a business
     holding pesos and dollars has two accounts, not one bilingual one;
   - an optional `branchId`, because a cash box belongs to a location
     while a bank account usually does not;
   - bank-only descriptive fields (bank name, account number/CBU/alias)
     that are **metadata**, never used to move money;
   - `active`, so an account can be retired without deleting history.

   `code` and `name` are unique **per company**, never globally — the
   same rule as `Customer.code` (see `docs/customers.md`).

3. **`TreasuryMovement`**, immutable, with a signed or typed amount, an
   `occurredAt`, the account it hits, and a **source reference**
   (`sourceType` + `sourceId`) naming the document that caused it.
   Never physically deleted, never edited after creation.

4. **Idempotent by construction.** A `@@unique` constraint over
   `(companyId, sourceType, sourceId, movementType)` — the same shape
   `CustomerAccountMovement` already uses — so a retried or concurrent
   confirm cannot post twice. Insertion uses that constraint, not a
   read-then-check.

5. **Concurrency-safe balance updates.** A single atomic
   upsert-increment (`update: { balance: { increment: delta } }`), never
   read-modify-write; Postgres serializes concurrent writers to the same
   row. The sign policy below is validated **against the value Postgres
   actually returned, inside the same transaction** — the shape
   `docs/inventory.md` documents for negative stock.

6. **A cash box cannot go negative; a bank account can.** A physical
   drawer holding minus five thousand pesos does not exist, so a movement
   that would take a `CASH_BOX` below zero is rejected with a domain
   exception. A `BANK_ACCOUNT` may go negative (overdraft is a real
   thing), governed by an explicit per-account flag rather than a
   hardcoded `if type === ...`.

7. **Cobro and Pago post to Treasury on confirm, inside the same
   transaction** as the status change and the existing current-accounts
   movement — one `$transaction`, the pattern `SalesService.confirm()`
   and `RolesService` already establish. Confirming a Cobro increases a
   treasury account; confirming a Pago decreases one.
   - The target account becomes a **required field** on both documents.
     A Cobro that does not say where the money landed is the problem this
     task exists to fix.
   - The document's currency and the account's currency **must match**;
     mismatch is a rejection, not a conversion. No exchange rates exist
     in this task.
   - **Existing rows need a migration decision.** Confirmed Cobros and
     Pagos already in the database have no account. Do not invent one and
     do not back-post them into a balance that an operator never counted:
     make the column nullable for history, required for new documents,
     and state the rule in `docs/treasury.md`. Historical documents
     remain visible and remain excluded from balances, and the module
     must say so rather than quietly under-reporting.

8. **Cancelling adds a compensating movement; it never deletes one.**
   Exactly the `StockTransfer` cancellation shape (`docs/inventory.md`):
   the inverse pair is appended and history is preserved. A cancelled
   Cobro must not leave its money in the drawer.

9. **The gap is visible in the product, not just in the docs.** Because
   POS cash does not reach any account (see the decision above), a
   `CASH_BOX` balance can be wrong for a business running POS. The UI
   that shows a cash balance must state that POS sales are not included,
   as a plain sentence next to the number. A tooltip is not enough and a
   line in `docs/treasury.md` is not enough.

10. **Transfers between treasury accounts** — the daily "deposit the
    till at the bank" move. One document, both movements written in one
    transaction (the OUT first), cancellation by compensating pair: the
    same shape as `StockTransfer`, which already solved this problem for
    warehouses. Source and target must differ, belong to the same
    company, and share a currency.
    - Take the deadlock lesson with it: two simultaneous transfers A→B
      and B→A must not deadlock. `InventoryService.lockBalancesInStableOrder`
      is the existing precedent — a stable global lock order, with
      advisory locks rather than `SELECT ... FOR UPDATE` because the
      balance row may not exist yet.

11. **Permissions, without colliding with what exists.** `treasury.receipts.*`
    and `treasury.payments.*` are **already taken** by Cobros and Pagos in
    `src/accounts` (see the comment above them in
    `packages/shared/src/permissions.ts`, which documents exactly this
    kind of collision for `purchases.goods-receipts`). Use
    `treasury.accounts.*`, `treasury.movements.*` and `treasury.transfers.*`.
    Add `RESOURCE_LABELS` entries, register every code in the catalogue,
    and extend the seeded **"Tesorería"** role — whose description
    ("Gestiona cobros y pagos") should now match what it can actually do.
    Every endpoint is gated server-side; frontend `can()` checks are UX
    only.

12. **Audited.** `AuditService.record(...)`/`recordFromContext(...)`
    inside the same transaction as the business write. One record per
    meaningful domain action — opening an account, confirming a transfer
    — never one row per ledger insert.

13. **Company-scoped, strictly.** Every lookup goes through
    `findFirst({ where: { id, companyId: ctx.companyId } })`. Prefer a
    response that does not reveal whether an account the caller cannot
    reach exists at all.

14. **Gestión UI.** Account list and detail, an account statement
    (movements with a running balance), and the transfer flow. Follow
    progressive disclosure, not a dense do-everything screen. Company-scoped
    TanStack Query keys (`['company', companyId, 'treasury', ...]`) and
    `keepPreviousCompanyData`, never bare `keepPreviousData` — see the
    defect corrected in PR #39. No Treasury UI in Facturación.

15. **Tests.** Unit coverage for the sign policy and the
    currency-mismatch rejection; e2e for the confirm path, the
    cancellation compensation, idempotency under a retried confirm,
    multi-company isolation, and permissions. **Concurrency tested by
    invariant, not by sleeps**: simultaneous confirms against one account
    must leave the balance equal to the sum of the ledger, and opposing
    simultaneous transfers must not deadlock.

16. **Delete `apps/api/src/modules/treasury/`.** It is a README-only
    placeholder that says "no business logic lives here yet", and
    `docs/implementation-status.md` already flags these folders for
    deletion once a domain is implemented for real. The real module is
    `apps/api/src/treasury`.

17. **Docs in the same PR.** A new `docs/treasury.md` following the
    pattern of `inventory.md`/`current-accounts.md` — the ledger rule,
    the rebuild path, the sign policy, the currency rule, the historical
    Cobros/Pagos rule from criterion 7, and the POS gap from the decision
    section. Plus the `docs/implementation-status.md` entry, the
    `docs/roadmap.md` line, and a `docs/current-accounts.md` update
    replacing "Treasury is out of scope" with what is now true.

## Out of scope

Each of these is a real Fase 3 item and each deserves its own task. Named
here so that "Treasury" is not read as "all of Fase 3 is done".

- **POS / `SalesTender` integration.** The deliberate decision above.
  This is the most likely next task, and it is the one that makes a cash
  box balance trustworthy for a business running POS.
- **Cheques** — cheques de terceros, propios, diferidos, e-cheq. A
  cheque has its own lifecycle (received → deposited → cleared →
  rejected) and is a subdomain, not a movement type.
- **Bank reconciliation.** Needs statement import and a matching
  engine.
- **Mercado Pago** or any payment-processor integration.
- **Multi-currency with exchange rates.** Accounts are single-currency
  and no conversion happens anywhere. Revaluation, FX gain/loss and
  cross-currency transfers are all deferred.
- **Accounting.** No chart of accounts, no journal entries, no posting.
  A treasury movement is not an accounting entry.
- **Cash-count / blind close ("arqueo", "cierre de caja").** Comparing a
  counted drawer against the ledger and recording the difference is a
  genuine need and a separate flow.
- Anything under `infrastructure/windows/`.
