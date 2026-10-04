# Fiscal draft preparation

The first fiscal slice is preparation only: Gestión `/facturas-fiscales`
selects a confirmed internal sale, previews its tax breakdown and saves a
company-scoped `FiscalDraft`. Every view identifies it as **Sin validez fiscal**
and **No enviado a ARCA**. There is no authorization endpoint, invoice number,
CAE, QR, fiscal receipt, WSAA client or network call to ARCA.

## Operator flow

1. Open Operación → Borradores fiscales and choose a confirmed sale.
2. Choose the **proposed** A/B/C class explicitly. This does not establish that
   the issuer or recipient is eligible for that class.
3. Explicitly confirm that the sale's existing final amounts already include
   any applicable VAT. Historical `PriceList.includesTax` is not inferred.
4. Select each line's treatment; no class or tax rate is selected by default.
5. Preview the server-calculated breakdown, then save the draft. Reopen it to
   review or edit. A conflicting edit requires reloading the latest revision.

The first slice accepts only ARS confirmed sales with zero pre-existing tax
amounts and exact-cent line totals whose sum equals the sale total. A sale
with nonzero fractions of a cent is rejected, never silently rounded. A/B
support VAT 0%, 10.5%, 21%, 27%, exempt and non-taxed; C requires the explicit
C-without-VAT treatment on every line. This is a deliberately limited local
preparation catalog, not the complete live ARCA catalog.

## Amount and persistence guarantees

All calculations use a private Prisma Decimal constructor. For each taxable
line, net = final / (1 + rate), rounded HALF_UP to two decimals; VAT is the
remainder. Exempt and non-taxed amounts remain separate; C places the final
amount in net/subtotal with VAT zero. Summing each component conserves the
original final amount. These are draft line calculations; a future WSFE
builder must validate grouping by VAT rate, rounding tolerances and current
ARCA catalog rules before authorization.

One draft exists per company and sale. The additive migration creates
`fiscal_drafts` and a composite unique index on the referenced sales table.
A composite foreign key prevents referring to a sale in a different company.
Only DRAFT status and positive revisions are permitted by database checks.

The first save snapshots sale lines, recipient and issuer data. Later master
changes do not rewrite that snapshot. Saving rechecks the source sale's
confirmed status and supported currency/tax state. A per-sale transaction
lock plus expected revision prevents duplicate drafts and lost updates;
a sale row lock serializes saving against cancellation. The audit entry is
written in the same transaction. Neither preview nor save changes commercial
sales, inventory, customer accounts, Treasury or prices. The sale number
shown is its internal reference, never a fiscal number.

## API and permissions

All routes are under `/api/v1/fiscal`; company/tenant come exclusively from
validated request context. Existing invoice permissions are reused.

| Route | Permission |
| --- | --- |
| GET `/drafts` (page/pageSize), `/drafts/:id` | `sales.invoices.read` |
| GET `/sales/:saleId/draft` | `sales.invoices.read` |
| GET `/sales/:saleId/source` | `sales.invoices.create` AND `sales.documents.read` |
| POST `/sales/:saleId/preview` | `sales.invoices.create` AND `sales.documents.read` |
| POST `/sales/:saleId/draft` | `sales.invoices.create` AND `sales.documents.read` |

The UI additionally requires invoice read permission to prepare an existing
or new draft safely. Save includes `expectedRevision` (0 for first creation).
Strict schemas accept only proposed class, explicit amount interpretation,
source line IDs and treatments; callers cannot supply their own totals,
company identity, issuer snapshot, authorization status or revision result.
Queries/mutations bind to the company at request creation, including retries
after authentication refresh. Changing company resets the preparation UI.

## Next stage: actual homologation

Issuer identity and VAT condition have not yet been defined by the operator.
There is no homologation certificate or Web Services point of sale configured.
Drafts therefore always report `authorizationAvailable: false` and pending
issuer/recipient validation and homologation configuration.

Before issuing even a homologation invoice, implement fiscal profiles,
recipient identification/VAT-condition validation, service catalog checks,
WSAA credentials, point-of-sale configuration, WSFEv1 request building and
persistent authorization state. Allocate numbers durably per point of sale
and voucher type. Handle an uncertain send by querying the original voucher
(`FECompConsultar`), not blindly allocating another number. Live homologation,
production configuration, CAE/QR/printing, credit/debit notes and contingency
operation are separate work. Do not paste certificates/private keys in chat
or commit them to Git.

Primary references checked 2026-10-03:

- [ARCA electronic invoice services and WSFEv1 manual 4.7](https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [WSFEv1 developer manual](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf)
- [WSAA certificates and service association](https://www.arca.gob.ar/ws/documentacion/wsaa.asp)

No live ARCA authentication, authorization or homologation has been tested.

## Verification for this slice

Disposable PostgreSQL 16 + Redis: all migrations deployed, schema comparison
reported no drift, two seed runs preserved identical business snapshots
across 12 tables. Eight fiscal integration tests cover permissions and
cross-tenant isolation, concurrent create/update conflicts, immutable source
snapshots, unsupported inputs, non-persistent preview, audit rollback and
unchanged stock/account/tender data after preparing an actually confirmed
sale. Twenty-one calculator tests cover Decimal precision, treatments and
exact totals. Client/component tests cover company changes, authentication
refresh, explicit choices, revision conflicts and preserved local edits.

Repository lint, typecheck and API/Gestión/Facturación production builds pass.
Lint retains the two pre-existing authentication navigation warnings. No
manual browser acceptance or live homologation run is claimed for this slice.
