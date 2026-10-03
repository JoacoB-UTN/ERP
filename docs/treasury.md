# Treasury — cash boxes, bank accounts and the movement ledger

Where the money actually is.

Until this module existed, the ERP recorded **how** people paid and never
**where the money went**. Three places captured a payment method —
`SalesTender.method` on a POS sale, `CustomerCollection.paymentMethod` on
a Cobro, `SupplierPayment.paymentMethod` on a Pago — and all three were
descriptive strings. The schema said so out loud: *"purely descriptive,
never touches a cash/bank balance"*. A business could confirm half a
million pesos in cash and the system had no answer at all to "how much is
in the drawer". Not a wrong answer — no answer.

Specified in `prompts/planned/019-treasury-cash-and-banks.md`.

## The shape: a ledger and a projection

`TreasuryMovement` is **the only authoritative record** of money entering
or leaving an account. `TreasuryAccountBalance` is a projection of
`SUM(amount)` per account. If the two ever disagree, **the ledger wins**
and `TreasuryService.rebuildTreasuryBalances()` is the documented
recovery path.

This is deliberately the same contract `InventoryService` has with
`InventoryBalance` (see [inventory.md](inventory.md)), for the same
reason: a stored total is a cache, and a cache is never a source of truth
about money.

The projection is a **separate table**, not a column on
`TreasuryAccount`, so that nobody reads `account.balance` by accident and
so a rebuild never touches master data.

```
TreasuryAccount   ── the cash box or bank account (master data)
TreasuryMovement  ── the ledger. Immutable. Signed amounts.
TreasuryAccountBalance ── SUM(movements). Rebuildable. Never authoritative.
```

## Accounts

A `TreasuryAccount` is a `CASH_BOX` or a `BANK_ACCOUNT`, and the
distinction is not cosmetic — see the sign policy below.

- **Single-currency, always.** A business holding pesos and dollars has
  two accounts, not one bilingual one: a mixed balance is not a number
  anybody can act on. No conversion happens anywhere in this module, and
  no exchange rate exists in it.
- **`code` and `name` are unique per company**, never globally — the same
  rule as `Customer.code` (see [customers.md](customers.md)).
- **`branchId` is optional.** A cash box belongs to a location; a bank
  account usually does not.
- **Bank fields are metadata.** `bankName`, `accountNumber`, `cbu`,
  `alias` are display-only. Nothing parses them and nothing moves money
  with them.
- **`type` and `currencyId` cannot be edited.** Both change what every
  existing movement on the account *means*: turning a peso cash box into
  a dollar bank account would silently reinterpret its whole history.
  Retire the account and open another one.
- **`active: false` retires an account** without deleting history. A
  retired account refuses new movements — but **accepts reversals**,
  because money that already left has to be able to come back after the
  drawer was closed.

## The sign policy

`amount` is signed: **positive is money in, negative is money out** — the
same convention `StockMovement.quantity` uses.

- A **`CASH_BOX` can never go below zero.** A drawer holding minus five
  thousand pesos does not exist, so the movement is rejected
  (`INSUFFICIENT_TREASURY_FUNDS`) and the whole transaction rolls back.
- A **`BANK_ACCOUNT` may go below zero** when `allowsNegativeBalance` is
  set. An overdraft is a real thing. The flag is explicit per account
  rather than inferred from the type, and it can never be set on a cash
  box — not at creation and not by a later edit.

**The policy is checked against the value Postgres returned**, inside the
same transaction, never against a balance read beforehand:

```ts
const updated = await tx.treasuryAccountBalance.upsert({
  where: { treasuryAccountId: account.id },
  create: { companyId, treasuryAccountId: account.id, balance: amount },
  update: { balance: { increment: amount } },   // never read-modify-write
});
if (updated.balance.lt(0) && !account.allowsNegativeBalance) throw ...;
```

Postgres serializes concurrent writers to that row, so two terminals
posting at once cannot both compute a new balance from the same stale
read. This is the shape [inventory.md](inventory.md) learned first, and
it is the reason the check reads `updated.balance` rather than the delta:
a payment that looks like an overdraw can be perfectly fine by the time
it lands, if another writer put money in first.

## Idempotency

`@@unique([companyId, sourceType, sourceId, movementType])` — the same
shape `CustomerAccountMovement` uses.

`TreasuryService.post()` returns **`null`** when the movement already
exists. That is a success, not an error: a retried or concurrent confirm
found the ledger already saying what it wanted it to say. The decision is
delegated to the constraint rather than to a read-then-insert, because
between the read and the insert is exactly where a second terminal fits.

**The insert is `ON CONFLICT DO NOTHING`, and that detail is not
cosmetic.** A unique violation **aborts the entire PostgreSQL
transaction** — every later statement fails with *current transaction is
aborted* — and catching the error in TypeScript does not undo it. An
earlier version of this method caught the P2002 and returned `null`; it
looked right, and its test passed, because that test did nothing else in
the transaction. Every real caller does: a Cobro's confirm flips the
status, posts to the customer ledger, posts here, then audits. Measured,
then fixed. The regression test now writes before and after the duplicate
on purpose.

## One lock protocol

**Every writer to an account holds that account's advisory lock for the
rest of its transaction.** `post()` takes it itself, so the rule holds by
construction rather than by each caller remembering: the opening balance,
transfers, Cobros, Pagos and the rebuild are all covered by the same key.
Locks are re-entrant within a transaction, so a transfer that already
took both (in stable order) pays nothing extra.

Two consequences worth stating:

- **The opening balance checks that the ledger is empty *under* the
  lock.** Otherwise a transfer or a Cobro could post the account's first
  movement between the check and the insert, and the "opening" would land
  on top of it.
- **The rebuild sums inside the transaction that writes**, one account at
  a time, holding that account's lock. Summing outside and writing after
  would let a movement committed in between be overwritten by a total
  computed before it existed — a repair that loses money is worse than
  the drift it set out to fix. One account at a time so a rebuild never
  freezes the whole treasury.

### The lock keys

`hashtextextended(name, 0)` — 64 bits, which is what
`pg_advisory_xact_lock` takes. And the **sort is over the keys, not over
the names**: hashing does not preserve string order, so sorting the names
first and hashing after gives no consistent order at all, and two
transactions locking the same pair could still take them in opposite
orders — the exact deadlock the sort exists to prevent.

Every reversal is **its own movement type** (`COLLECTION_REVERSAL`,
`PAYMENT_REVERSAL`, …) rather than a negative of the original, precisely
so the idempotency key can tell a cancellation apart from the
confirmation it undoes.

## Corrections are new movements

A confirmed movement is never updated or deleted. A correction is a new,
reversing movement pointed back at the original via `reversalOfId` — set,
not left null, so a statement can say *which* movement a reversal cancels — the
rule [inventory.md](inventory.md) and
[current-accounts.md](current-accounts.md) already follow, and the reason
a cancelled Cobro will not leave its money in the drawer.

## The opening balance

What was already in the account the day it was loaded into the system,
recorded as a real `OPENING_BALANCE` movement rather than a column
somebody edits — so the ledger explains every peso of the balance
including the first one.

**It can be negative — but only where a negative balance is possible.** A
bank account with an overdraft can genuinely be overdrawn the day the
module is loaded, and refusing to record that forces the operator to lie
about the starting position. A cash box, and a bank without an overdraft,
are refused with `NEGATIVE_OPENING_BALANCE_NOT_ALLOWED` — its own code,
because "there is not enough money" is not what happened.

It can be set **only once, and only while the ledger is empty**. A second
"opening" after money has moved is a correction wearing the wrong name;
use an adjustment. The endpoint is gated by `treasury.movements.create`,
not `treasury.accounts.update`: declaring what is in a drawer is a
treasury operation, not master-data maintenance.

## Transfers between accounts

The daily "deposit the till at the bank". One document
(`TreasuryTransfer`, numbered `TRF-000001`), DRAFT → CONFIRMED →
CANCELLED, with the same rules as `StockTransfer` — because it is the
same problem with money instead of goods.

- **A draft moves nothing.** The ledger is untouched until `confirm()`.
- **Confirming writes BOTH movements in one transaction, the OUT
  first.** The source is debited before the destination is credited, so
  an insufficient-funds rejection rolls the whole thing back rather than
  leaving money that arrived from nowhere.
- **Cancelling appends the inverted pair** (`TRANSFER_OUT_REVERSAL` +
  `TRANSFER_IN_REVERSAL`), never edits or deletes. A cancelled transfer
  leaves four movements in the ledger and both balances where they
  started.
- **Source and destination must differ, share a currency, belong to the
  same company, and both be active.** A transfer never converts.
- **Confirming and cancelling are their own permissions**, so a role can
  prepare a deposit without executing it.

### The two defects this inherited, deliberately

`StockTransfersService` had to learn both the hard way (PR #39), and
this module copies the fixes rather than the original code:

1. **The status flip is a conditional `updateMany ... WHERE status =
   'DRAFT'`, done FIRST.** A concurrent or retried confirm gets zero rows
   and stops before any movement is written.
2. **That update always writes `updatedAt` explicitly.** An update whose
   `data` ends up empty takes **no row lock at all**, which is exactly
   what made the equivalent guard decorative until somebody measured it.
   `@updatedAt` alone is not enough.

And the document is re-read *inside* the transaction after the guard, so
the movements describe the version that was actually confirmed rather
than a snapshot a concurrent edit may have replaced.

### Deadlock

Two transfers moving money in opposite directions at the same moment —
caja→banco and banco→caja — would each hold what the other needs.
`TreasuryService.lockAccountsInStableOrder` takes one advisory lock per
account in a globally sorted order, so one simply waits.

Advisory locks rather than `SELECT ... FOR UPDATE` because the balance
row **may not exist yet** — precisely the case of an account whose first
movement is this transfer. Same reasoning as
`InventoryService.lockBalancesInStableOrder`.

## Cobros and Pagos post here

Confirming a **Cobro** puts the money into a treasury account
(`COLLECTION`); confirming a **Pago** takes it out (`PAYMENT`). Both
happen **inside the same transaction** as the status change and the
current-accounts movement, so the three either all land or none do.

Cancelling appends the reversal (`COLLECTION_REVERSAL` /
`PAYMENT_REVERSAL`) rather than editing anything, and it is allowed into
a retired account — money that already moved has to be able to come
back.

- **`treasuryAccountId` is required on new documents.** A Cobro that does
  not say where the money landed is the gap this module exists to close.
  The Gestión forms for Cobro and Pago carry the selector.
- **The account is validated when the document is written, not when it is
  confirmed** — same company, same currency, still active, on create
  *and* on edit. A document naming an account it cannot reach could never
  be confirmed, so saving it just builds a trap the operator discovers
  days later. The company scoping is what closes the cross-tenant hole: a
  lookup filtered by `companyId` simply does not find another company's
  account, even with the id in hand.
- **On edit, what gets re-checked is the resulting pair, not the field
  that arrived.** Changing only the currency invalidates the account
  already stored just as surely as changing the account does, so both
  edits run the same check, against the values the row will actually end
  up holding. Hanging it off `treasuryAccountId` alone let a
  currency-only `PATCH` save a peso cash box under a dollar Cobro —
  accepted with a 200, refused later at confirmation, which is precisely
  the trap the bullet above says this check exists to prevent.
- **The currencies must match.** A peso Cobro cannot land in a dollar
  account; it is rejected, never converted. Checked at both ends — the
  confirmation keeps its own check for a document that got its account
  some other way.
- **Reversals carry `reversalOfId`**, pointing at the movement they undo.
- **The document returns its account** (`treasuryAccount`: id, code,
  name). The payment method says *how* someone paid; a screen that shows
  only that cannot answer *where the money went*.
- **A Pago cannot overdraw a cash box.** The confirmation fails whole —
  the supplier ledger does not move and the document stays DRAFT, rather
  than ending up CONFIRMED with nothing behind it.

### Documents that predate Treasury

The column is **nullable in the database**, and that is deliberate (task
019, criterion 7). Cobros and Pagos confirmed before this module existed
have no account. They are **not** invented one and **not** back-posted
into a balance nobody ever counted.

So they keep posting to the customer/supplier ledger, they stay visible,
and they stay out of every treasury balance. A cash box opened today
shows what has moved through it *since* — not the history of a business
that was running before it existed. That is the honest number, and it is
the same reasoning behind `excludesPosSales` below: say what a figure
does not include rather than quietly under-report.

## Deliberately not wired: POS

`AGENTS.md` states, as a permanent invariant, that `SalesTender` is an
operational snapshot and must not be wired into a Treasury module
*"without a deliberate, separate design decision"*.

**The decision: this module does not wire it.** The reasons:

1. **A tender does not know which drawer it went into.** `SalesTender`
   has no treasury account, no terminal and no till, and
   `SalesDocument.branchId` is optional. Posting POS cash to a balance
   requires first deciding which cash box a given terminal feeds — a
   modelling and a Facturación UX change, not a side effect.
2. **POS must stay fast and keyboard-first** (see
   [product-ui-principles.md](product-ui-principles.md)). Adding a
   required "caja" selection to the checkout path is a decision about the
   fastest screen in the system.

### What that costs, stated plainly

**A cash box balance is wrong for a business running POS** — not merely
incomplete. Cash physically enters the drawer and never reaches this
ledger.

So the API says so: `GET /treasury/accounts/:id/statement` returns
`excludesPosSales`, and the UI must show that next to the balance rather
than present a bare number it knows may be short. The precedent is the
Current Accounts readiness gate (see
[current-accounts.md](current-accounts.md)): a derived number that cannot
yet be trusted has to say so **where it is read**, because a confident
wrong number is worse than a refusal.

`excludesPosSales` is a field rather than a constant so that wiring POS
later flips one expression instead of hunting for hardcoded warnings.

## Permissions

`treasury.receipts.*` and `treasury.payments.*` were **already taken** by
Cobros and Pagos (implemented in `src/accounts`), reserved in this
namespace long before a Treasury module existed. Cash boxes and bank
accounts therefore use:

| Code | Gates |
|---|---|
| `treasury.accounts.read` | Seeing that an account exists, and its balance |
| `treasury.accounts.create` | Opening a cash box or bank account |
| `treasury.accounts.update` | Editing one, retiring one |
| `treasury.movements.read` | Reading the statement — every peso that passed through |
| `treasury.movements.create` | Writing a movement (today: the opening balance) |

Reading an account and reading its ledger are **separate codes on
purpose**: knowing a cash box exists and seeing everything that passed
through it are different trust levels — the same split
[current-accounts.md](current-accounts.md) makes between seeing a
customer and seeing their balance.

The seeded **Tesorería** role gets all five; **Gerente** and **Solo
lectura** get the two read codes.

## Company scoping

Every lookup is `findFirst({ where: { id, companyId } })`, never
`findUnique({ where: { id } })`. An account belonging to another company
answers **404, not 403** — distinguishing them would confirm it exists.
See [multi-company-architecture.md](multi-company-architecture.md).

## The statement

Movements oldest-first with a running balance, ordered by
`(occurredAt, createdAt, id)` — fully deterministic, because a tie makes
a running balance non-reproducible between two reads of the same page.

**The running balance is a window over every movement of the account,
computed before the filters apply.** Filters decide which rows are
*shown*; they must not decide where the total starts. Summing only the
filtered rows made "payments since March" read as though the account had
been empty in February — a number that looks like a balance and is not
one.

It is computed **from the ledger**, not read from the projection, so a
statement is internally consistent even if the projection had drifted —
and so a reader can see the drift instead of being reassured by a total
that disagrees with the rows above it.

**Both permissions.** The statement needs `treasury.movements.read` *and*
`treasury.accounts.read`, because the response carries the account —
balance, bank name, account number, CBU, alias. Gating on the ledger code
alone handed all of that to a caller never granted the other. The split
still matters in the other direction: seeing that a cash box exists does
not let you read every peso that passed through it.

## Money crosses the wire at stored precision

Amounts are serialized with `toString()`, never `toFixed(2)`. The column
is `NUMERIC(19,4)` and each currency declares its own `decimalPlaces`, so
forcing two places rounds real amounts on the way out. Formatting is the
UI's job; the API's job is not to lose anything.

## Recovery

`TreasuryService.rebuildTreasuryBalances(companyId?)` recomputes every
balance from the ledger. It never invents a movement, so running it can
only make balances agree with history — which is why it is safe to run at
any time. It also zeroes projection rows the ledger no longer accounts
for.

## Not implemented

Each of these is a real Fase 3 item with its own task ahead of it. None
of them is partially present: if it is on this list, there is no code for
it.

- **POS / `SalesTender` integration** — the deliberate decision above.
  The most likely next task, and the one that makes a cash box balance
  trustworthy.
- **Cheques** — de terceros, propios, diferidos, e-cheq. A cheque has its
  own lifecycle and is a subdomain, not a movement type.
- **Bank reconciliation** — needs statement import and a matching engine.
- **Mercado Pago** or any payment-processor integration.
- **Multi-currency with exchange rates.** Revaluation, FX gain/loss and
  cross-currency transfers are all deferred.
- **Accounting.** A treasury movement is not an accounting entry.
- **Cash count / blind close ("arqueo", "cierre de caja").**
- **Gestión UI.** The API exists; no screens yet.
