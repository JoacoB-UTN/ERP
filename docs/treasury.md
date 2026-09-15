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

Every reversal is **its own movement type** (`COLLECTION_REVERSAL`,
`PAYMENT_REVERSAL`, …) rather than a negative of the original, precisely
so the idempotency key can tell a cancellation apart from the
confirmation it undoes.

## Corrections are new movements

A confirmed movement is never updated or deleted. A correction is a new,
reversing movement pointed back at the original via `reversalOfId` — the
rule [inventory.md](inventory.md) and
[current-accounts.md](current-accounts.md) already follow, and the reason
a cancelled Cobro will not leave its money in the drawer.

## The opening balance

What was already in the account the day it was loaded into the system,
recorded as a real `OPENING_BALANCE` movement rather than a column
somebody edits — so the ledger explains every peso of the balance
including the first one.

It can be set **only once, and only while the ledger is empty**. A second
"opening" after money has moved is a correction wearing the wrong name;
use an adjustment. The endpoint is gated by `treasury.movements.create`,
not `treasury.accounts.update`: declaring what is in a drawer is a
treasury operation, not master-data maintenance.

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

The running balance is computed **from the ledger**, not read from the
projection, so a statement is internally consistent even if the
projection had drifted — and so a reader can see the drift instead of
being reassured by a total that disagrees with the rows above it.

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
- **Cobro and Pago posting to Treasury.** The two documents still only
  record a payment *method*; confirming one moves no treasury balance
  yet. This is the seam the module was built for and it is next after
  (or alongside) POS — it carries an open decision about the confirmed
  Cobros and Pagos that already exist without an account.
- **Transfers between accounts** (the daily "deposit the till at the
  bank"). Planned as the `TRANSFER_IN`/`TRANSFER_OUT` movement types
  already in the enum, with `lockBalancesInStableOrder`'s stable lock
  ordering to avoid the A→B / B→A deadlock.
- **Cheques** — de terceros, propios, diferidos, e-cheq. A cheque has its
  own lifecycle and is a subdomain, not a movement type.
- **Bank reconciliation** — needs statement import and a matching engine.
- **Mercado Pago** or any payment-processor integration.
- **Multi-currency with exchange rates.** Revaluation, FX gain/loss and
  cross-currency transfers are all deferred.
- **Accounting.** A treasury movement is not an accounting entry.
- **Cash count / blind close ("arqueo", "cierre de caja").**
- **Gestión UI.** The API exists; no screens yet.
