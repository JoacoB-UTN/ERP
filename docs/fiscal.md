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
does not equal `CUIT <issuerCuit>`. This first implementation requires the
certificate CUIT to equal the issuing company's CUIT; delegated certificates
for another CUIT are not supported. The private key must be an unencrypted PEM.
Local validation does not establish that ARCA trusts the certificate or that
its WSASS association with `wsfe` is correct.

On POSIX, use owner-only permissions (`0600` or `0400`) for the private key;
keep the credential directory writable only by the trusted server administrator.
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
