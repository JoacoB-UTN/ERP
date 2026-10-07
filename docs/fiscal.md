# Fiscal preparation and homologation

The first fiscal slice is preparation only: Gestión `/facturas-fiscales`
selects a confirmed internal sale, previews its tax breakdown and saves a
company-scoped `FiscalDraft`. Every view identifies it as **Sin validez fiscal**
and **No enviado a ARCA** until a separate, explicit homologation request is
registered. The authorization slice described below adds WSAA authentication
and WSFE test authorization, with separate persisted status and test CAE.
Neither drafts nor homologation results have fiscal validity. Production, QR
and fiscal printing remain unavailable. The public availability probe is
separate from authentication and invoice authorization.

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

## Homologation preparation and limits

Issuer identity, VAT condition, certificate and Web Services test point of sale
must be supplied before the real authenticated circuit can be tested. The
operator has not supplied that configuration yet. Draft DTOs continue to report
`authorizationAvailable: false`: this legacy preparation field never asserts
eligibility; the separate authorization resource records explicit test requests.

This slice supports WSFE concept 1 (products), ARS/PES with exchange rate 1,
A/B/C invoices and a recipient explicitly identified by CUIT. Services, foreign
currencies, other document identifiers, credit/debit notes and production are
outside this slice. Both CUITs must pass local syntax/checksum checks. The
issuer's declared VAT condition and recipient condition must match a supported
class; current recipient identity/condition and issuer CUIT must still match
the saved draft. This is not an ARCA registry check or a general eligibility
engine. The server rechecks the confirmed sale and recalculates saved amounts.
VAT groups must reconcile exactly with the supported aggregate rounding rule;
inconsistent draft rounding is rejected rather than changing the sale total.

The authenticated WSFE checks verify the test point of sale, compatible recipient
VAT condition and applicable VAT catalog entries. The operator must explicitly
confirm a point of sale reserved for this ERP and the homologation environment.
External software using the same series is not coordinated by database locks;
an exclusive test point of sale is a prerequisite.

Primary references checked 2026-10-03:

- [ARCA electronic invoice services and WSFEv1 manual 4.7](https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp)
- [WSFEv1 developer manual](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf)
- [WSAA certificates and service association](https://www.arca.gob.ar/ws/documentacion/wsaa.asp)
- [WSAA technical specification](https://www.arca.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf)

No authenticated ARCA homologation or invoice authorization has been tested
with a real certificate. Only the public availability probe documented below
has been exercised live. Local tests use ephemeral keys and simulated responses.

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
manual browser acceptance or invoice homologation run is claimed for this slice.


## Issuer preparation and public homologation connectivity

Gestión → Operación → **Configuración fiscal** (`/facturas-fiscales/configuracion`)
requires `configuration.manage`. It shows the registered Company's identity
without changing it; CUIT checking is local syntax/checksum only. A locally
valid CUIT does not establish registration, fiscal condition or eligibility.
The operator can save a declared IVA condition and a test Web Services point
of sale (1–99999), or leave either unset. There are no fiscal defaults.

The additive `fiscal_settings` table holds one company-scoped profile with
revision and audit metadata. GET/PUT `/fiscal/settings` use validated context,
strict payloads and expected-revision conflicts. Persistence and audit are
atomic. Environment is constrained to HOMOLOGATION by the database. The API
accepts no credentials, identity override, external URL or production toggle.
Saving declarations neither validates them against ARCA nor changes existing
fiscal drafts, sales or ledger balances. `authorizationAvailable` stays false.

**Comprobar disponibilidad de ARCA** invokes POST
`/fiscal/settings/connectivity` with an empty body, also protected by
`configuration.manage`. The API sends only the public `FEDummy` SOAP request
to the fixed official homologation URL. No CUIT, customer, credential or invoice
is transmitted. The operation has a five-second deadline, a 32 KiB response
limit, rejects redirects and DTDs, and parses namespaces/expected structure
with `saxes`. Only validated service states are returned; raw upstream bodies
or exceptions are never reflected. `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`
describe service availability, never this company's ability to issue.

The form preserves unsaved edits across background refetch failures, rejects
stale revisions, and clears state when switching company. Availability checks
are on demand and display their timestamp; no monitoring is scheduled.

[Official FEDummy SOAP contract](https://wswhomo.afip.gov.ar/wsfev1/service.asmx?op=FEDummy)
was checked for endpoint, namespace and SOAPAction. A live public-only probe
from this development host at **2026-10-04 02:52 UTC** returned all three
services OK. This was not a WSAA login, certificate validation or invoice
homologation test. The separate authenticated implementation below is pending real-certificate
homologation acceptance. Production fiscal issuance remains future work.

Settings verification adds seven real-database integration cases, 20 public
transport/parser cases, 13 configuration UI cases and three client cases.
The new migration and both fiscal suites pass on disposable PostgreSQL/Redis;
schema comparison remains empty and double seed preserves business data.


## Server-only credentials and WSAA authentication

The server reads `ERP_ARCA_CREDENTIALS_DIR`, an absolute canonical directory
path without symlink aliases. Under it, provision one directory named with the
validated ERP company UUID, containing exactly the expected credential filenames:

```text
<ERP_ARCA_CREDENTIALS_DIR>/<companyId>/certificate.pem
<ERP_ARCA_CREDENTIALS_DIR>/<companyId>/private-key.pem
```

For example, `/srv/erp/arca-credentials` on Linux or
`C:\ERP\arca-credentials` on Windows. Resolve the actual directory path first;
macOS aliases such as `/tmp` pointing elsewhere are deliberately rejected.
The application accepts no credential upload, client-supplied path, alternate
endpoint or production toggle. Provision files through server administration,
never Git or chat. The loader rejects symlinked directories/files, nonregular
files, oversized PEMs, expired/not-yet-valid certificates, RSA keys below 2048
bits, key/certificate mismatch and a certificate subject `serialNumber` that
does not identify a valid CUIT. By default that CUIT must equal the issuing
company's CUIT. A delegated personal certificate requires an explicit
`representation.json` in the same company folder, with exactly these fields:

```json
{"issuerCuit":"<company CUIT, 11 digits>","certificateCuit":"<certificate CUIT, 11 digits>"}
```

Replace both placeholders with valid checksum-bearing CUITs. The requested
issuer must match issuerCuit, and the certificate subject must match
certificateCuit. This file is a local operator binding, not evidence of ARCA
authorization: the certificate must also be authorized in WSASS to represent
that issuer for `wsfe`. Only server administrators may provision this file;
there is no client upload or API to change it. Invalid/present files fail closed,
even when both CUITs are the same. Removing the binding or changing either CUIT
prevents the next delegated request, including use of a cached ticket. It cannot
recall an HTTP request already in flight. WSFE Auth.Cuit remains the issuer CUIT;
the personal certificate's CUIT never replaces the invoice issuer.

Provision a dedicated certificate/alias per ERP company for this initial cache
model. Sharing one certificate across companies can trigger WSAA's existing-ticket
restriction because tickets remain cached separately per company; this change
does not introduce a cross-company ticket cache. The private key must be an unencrypted PEM.
Local validation does not establish that ARCA trusts the certificate or that
its WSASS association with `wsfe` is correct.

On POSIX, use owner-only permissions (`0600` or `0400`) for the private key;
keep the credential directory writable only by the trusted server administrator.
The loader rejects group/world-writable root and company folders on POSIX.
The representation file also rejects group/world write permissions on POSIX;
use `0600` or `0644` with a trusted owner. Apply equivalent restricted write ACLs
on Windows, including to `representation.json`.
On Windows, remove inherited broad access and explicitly grant read access only
to the actual ERP API service account, with administration restricted to trusted
administrators/SYSTEM. Apply ACLs to the company folder and private-key file and
verify them under the service identity. POSIX mode checks do not validate Windows
ACLs; secure Windows provisioning remains an operator responsibility.

WSAA receives an attached CMS containing a short-lived `wsfe` access request,
signed using RSA/SHA256 in process. No installed OpenSSL executable is required.
The official published WSAA specification still describes SHA1/RSA; SHA256
signatures have been verified locally, but acceptance by live ARCA with the
operator's certificate remains **unverified**. Do not claim real authentication
until that acceptance test succeeds.

Tickets are kept only in process memory, scoped by company, CUIT and certificate
fingerprint, with bounded caches, coalesced concurrent requests and an expiration
margin. No token/sign/private key is returned to the browser, audit log or
persisted authorization record. Restarting the server loses the local ticket;
ARCA may reject a replacement while the previous ticket remains valid, requiring
an operator to wait for expiry. Requests are not retried automatically. Failures
use a short cooldown and sanitized messages, without upstream bodies or secrets.

POST `/fiscal/settings/authentication` requires `configuration.manage`, an empty
strict body, and returns only readiness, expiration and a safe message. A successful
login alone does not validate the issuer's fiscal situation or authorize a voucher.
Fixed official HTTPS endpoints, no redirects, a 12-second request deadline, a
256 KiB response cap and strict XML/namespace parsing bound authenticated calls.

## Durable test authorization and uncertain results

GET `/fiscal/drafts/:id/authorization` requires `sales.invoices.read`.
POST `/fiscal/drafts/:id/authorize` and POST
`/fiscal/authorizations/:id/reconcile` require both invoice read/create permissions.
The authorize body contains the expected draft revision and explicit
`confirmHomologation: true` / `exclusivePointOfSale: true` declarations; reconcile
accepts only an empty body. All resources use the validated company context.

Before sending, a transaction freezes the draft revision and persists the exact
business request, point of sale, voucher type and reserved number as `SENDING`,
with its audit entry. Tokens/signatures are assembled separately in memory.
Global issuer/point-of-sale/type uniqueness protects a legal series even if two
ERP companies share a CUIT. One unresolved send blocks that series; a draft with
an unresolved or authorized request cannot be edited. This does not alter sales,
inventory, customer accounts, Treasury, prices or the internal sale number.

The resulting states are:

- `SENDING`: the durable request exists; delivery or response may still be pending.
- `AUTHORIZED`: a matching homologation response carries a validated-format test
  CAE and expiration. This has no fiscal validity.
- `REJECTED`: a conclusive matched rejection permits correction and a new explicit
  attempt; no automatic retry occurs.
- `UNKNOWN`: timeout, malformed/mismatched response or other uncertainty. The
  original number stays reserved and the series remains blocked.

Reconciliation uses `FECompConsultar` for the persisted original request and
verifies its identity and amounts before accepting a recovered authorization.
It never resends, allocates a replacement number or interprets “not found” as
permission to retry. The conservative block also applies if the process crashes
**after persisting but before sending**: the system cannot prove non-delivery.
If repeated consultation cannot establish the result, manual operational review
is required; this slice has no force-unlock/reuse endpoint. A failed result/audit
transaction leaves the durable pending record available for consultation.

Authorization verification completed locally: 288 API unit tests, 167 Gestión
tests and 71 Facturación tests pass. The three fiscal integration suites pass
24 tests on disposable PostgreSQL 16/Redis, including persisted-before-send,
audit failure recovery, duplicate/concurrent requests and two tenants sharing
a legal issuer series. All migrations deploy without schema drift; repeated
seed preserves identical business snapshots across 12 tables. Repository lint
(with only the two existing navigation warnings), typecheck and all three
production builds pass. Independent agent reviews identified and corrected the
nullable CAE constraint, sale locking and originating-company cache refresh.
No manual browser acceptance or authenticated live ARCA run is claimed. Production activation, issuer registry
validation, complete tax catalogs, fiscal printing/QR and credit/debit notes
remain separate reviewed work.

Operator walkthrough: [Primera prueba de facturación con ARCA](fiscal-homologation-guide.md).

## Printing the homologation result

Gestión offers **Imprimir comprobante de prueba** on a readable, successfully
loaded authorization whose status is AUTHORIZED in HOMOLOGATION and whose draft
ID, revision and invoice type match the saved draft. CAE and expiry are required.
The browser print dialog can print or save a PDF; repeated **SIN VALIDEZ FISCAL**
notices identify this as a test document. It uses saved issuer/recipient identity,
line amounts, treatments and totals, plus the stored number and test CAE. It does
not infer an issue date from timestamps or generate a production QR.

The print stylesheet hides app navigation and repeats the warning in table
headers across detail pages. The client rechecks the active company at print time.
No server mutation occurs, and pending, unknown or rejected requests have no
print action. This is test-result printing only; production fiscal layout and
legal invoice compliance remain unimplemented.

## Latest authorization status in the list

GET `/fiscal/drafts` adds `authorization` to each item: null when no attempt
exists, otherwise the latest status, voucher type, point of sale and number.
The bounded latest-attempt selection uses the same company scope as the draft;
ordering is creation time descending then ID descending. No request JSON,
credential or certificate data is returned in the summary.

Gestión shows unsent, sending, unknown, authorized and rejected test states.
Pending/unknown rows link to the existing detail for manual consultation without
automatic calls to ARCA. A failed list refresh does not display cached rows as
current results, and missing summary data is not labeled as an unsent draft.

## Total credit-note preparation

An authorized homologation invoice can have one `FiscalCreditNoteDraft`, uniquely
bound by company and original authorization ID. GET/POST
`/fiscal/authorizations/:originalId/credit-note-draft` use invoice read and
read+create permissions respectively. POST accepts only a reason (5–500 trimmed
characters) and expectedRevision (0 creates; the stored revision updates).
Concurrent stale writes conflict. Audit and persistence share one transaction.

Saving is **preparation only**: it does not request a number or CAE or send the
note to ARCA. The draft remains DRAFT/HOMOLOGATION; separate authorization
attempts below own its transmission status. Identity and source lines come from
the immutable authorized invoice snapshot; amounts and grouped IVA are copied
from the original persisted request and retain positive signs. Totals must match.
Invoice types 1/6/11 map to NC types 3/8/13. The original type, point of sale,
number, issuer CUIT, date and CAE are saved as references. Only the reason is
editable; no current product price or changed customer/company master data is
used to reprice or replace the original snapshot.

Gestión displays the preparation inside the authorized invoice detail, preserves
unsaved reason/revision across refetches and requires explicit reload after a
conflict. Read-only operators can read the saved note. Preparing a note does not
cancel a sale/invoice, return goods or refund money. Sales, tenders, stock,
customer accounts, collections/applications and Treasury remain unchanged.

The authorization flow below serializes the NC series, persists its exact
request before sending, verifies the original CbtesAsoc association and recovers
uncertain results by consultation only. Partial notes and commercial reversal
posting need separate cumulative/application designs: the
current outstanding-sale calculation does not apply arbitrary CREDIT_NOTE ledger
rows to invoices, and a cash refund is not the same event as a fiscal correction.

References: [WSFEv1 manual](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf)
and [RG 4540](https://biblioteca.afip.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A4540%7Co%3A3%7Ca%3A2019%7Cf%3A31%2F07%2F2019).
No live homologation or legal eligibility validation is claimed by saving a draft.

## Total credit-note authorization in homologation

A saved note can be authorized only with explicit homologation and exclusive-PV
confirmations plus its current revision. It uses NC3/8/13 and the original point
of sale, with a separate NC numbering series. The builder preserves the original
positive amounts and grouped IVA and includes exactly one associated invoice
(type, point, number, issuer CUIT and original date). The service rechecks the
note against the original authorized request before claiming a number.

GET `/fiscal/credit-notes/:id/authorization` requires invoice read; POST
`/fiscal/credit-notes/:id/authorize` and
`/fiscal/credit-note-authorizations/:id/reconcile` require invoice read/create.
A separate `fiscal_credit_note_authorizations` table stores only business request
and result data, never credentials. Partial unique indexes protect active note,
legal NC series and number. Invoice and NC voucher-type sets are disjoint, so
separate persistence cannot bypass series uniqueness. Request and audit commit
before the one external send. The same preparation lock freezes the draft;
uncertain/authorized attempts block editing and another active attempt.

SENDING/UNKNOWN follow consult-only recovery; a missing result never releases
or resends the original request. AUTHORIZED requires a matching test CAE/expiry;
REJECTED permits a new manual attempt. Consultation verifies the full associated
invoice rather than accepting a number/amount match alone. A result-persistence
failure leaves the pending request available for recovery. UI prevents sending
unsaved reason edits and presents test statuses and a test CAE explicitly.

Authorizing a test credit note does not cancel the original invoice, refund a
payment, return goods or change account/Treasury balances. Real commercial
corrections, partial notes, production and force-unlock tooling remain separate.
No live authenticated ARCA acceptance is claimed without operator credentials.

## Credit-note follow-up and test printing

The paginated fiscal draft list includes a minimal `creditNote` summary: null
when absent, or the note ID and latest persisted authorization summary. The
summary contains status/PV/type/number only; no CAE, request or credentials.
All nested relations remain company-scoped. Reading the list never contacts
ARCA. Prepared and pending/unknown notes link directly to the note panel; absent
summary data from an old cache is shown as unavailable rather than “no note.”

Authorized notes can print a homologation sheet using their saved identity,
lines, positive authorized amounts, reason and associated invoice. Printing
requires matching draft ID/revision, NC type, homologation status and valid test
CAE/expiry. Company/freshness is rechecked on click. Invoice and NC sheets share
a container that selects exactly one document for the print dialog and clears
selection after printing. Warnings repeat in the page/table; no production QR
is generated. Printing does not change the authorization or any commercial data.

## Explicit identity refresh before the first submission

Saving a draft freezes its source identity. If an operator later corrects the
company/customer CUIT or the customer's VAT condition, the authorization check
correctly refuses the old snapshot. An explicit preparation action now lets the
operator refresh issuer/recipient identity before any submission has occurred.

POST `/fiscal/drafts/:id/refresh-identity` requires invoice read/create and sales
documents read. Its strict body is `{ expectedRevision, confirmIdentityRefresh: true }`;
identity values cannot be supplied by the client. The server reads the scoped
company and source-sale customer, requires valid CUITs and a supported known VAT
condition, and copies their legal names and fiscal identity only. Every other
snapshot field—including original sale lines, quantities, prices, chosen class,
tax treatments and totals—remains unchanged. No current pricing is resolved.

The existing sale/draft lock serializes refresh against saving and authorization.
Any recorded attempt, including a rejected one, blocks this action. Revision
validation, snapshot update, revision increment and audit commit atomically;
failed audit cannot leave changed identity. No ARCA call or commercial ledger
mutation is involved. Authorization still validates class, amounts and catalogs.

Gestión shows the saved identity and requires explicit confirmation to refresh.
The action is available only with current draft/attempt queries and no prior
attempt; company changes, stale revisions and late responses cannot overwrite
another context. A new revision resets authorization confirmations. Operators
must review the retained class/IVA selection before any subsequent send.

## Find submissions requiring consultation

GET `/fiscal/drafts` accepts `filter=ALL` (default), `PENDING`,
`INVOICE_PENDING` or `CREDIT_NOTE_PENDING`. Pending means a persisted SENDING
or UNKNOWN attempt; unsent drafts, prepared notes and resolved/rejected attempts
are excluded. Company-scoped relation filters apply before pagination and the
same predicate counts results. A repeatable-read transaction keeps rows, nested
status summaries and totals consistent. Listing never contacts ARCA.

Gestión offers all documents, all pending consultations, pending invoices or
pending notes. Changing the filter starts at page one and uses a separate query
cache key. Read-only operators can locate the document and open its detail;
consultation still requires its existing explicit action and write permission.

## Read-only attempt history

GET `/fiscal/drafts/:id/authorizations` and
`/fiscal/credit-notes/:id/authorizations` require invoice read permission and a
parent document in the active company/tenant. Strict `page`/`pageSize` queries
return sanitized authorization DTOs, a total and `latestAuthorizationId` from
one consistent read. Attempts sort by creation time and ID descending; a later
page never relabels its first item as the latest attempt. Business request JSON,
issuer CUIT, user IDs and credentials are not part of this response.

This is a history of persisted submission attempts, not a timeline of every
status transition. A manual retry after rejection creates another attempt;
consultation updates the existing attempt without creating another submission.
Opening, paging or refreshing history never contacts ARCA or changes data.

Gestión loads history only when expanded and shows date, revision, test number,
status and message. It is separate from the current authorization controls and
cannot authorize, consult or print an older attempt. History caches are scoped
by company, invoice/note kind, document and page. Errors or unavailable document
context hide cached history rather than presenting it as current information.

## Safe rejection diagnostics

A correlated rejected submission retains up to ten distinct numeric observation
codes in its existing safe message. The adapter reads only direct, correctly
namespaced observation fields and accepts bounded integer codes. Missing or
malformed diagnostic values fall back to the generic rejection message only
after existing protocol validation passes; a foreign XML namespace remains an
uncertain response. Upstream
`Msg` text and XML are never returned or persisted as diagnostics.

Brief local hints cover total/component mismatch (10048), invalid recipient VAT
condition (10242), VAT condition incompatible with the voucher class (10243),
and missing recipient VAT condition (10246). Other valid codes remain visible
as numbers for manual investigation. These mappings follow the
[official WSFEv1 manual](https://www.arca.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf),
PDF pages 38, 47–48 and 70, checked 2026-10-07. They describe the rejection and
do not change any fiscal values automatically.

The same message survives in invoice and NC attempt history after a manual
retry. This affects only already-verified rejections: uncertain/mismatched
responses still require consultation and never become safe-to-resend merely
because an observation is present. Existing authorized results stay unchanged.
