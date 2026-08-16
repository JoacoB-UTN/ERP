# 003 — Multi-company Context

Status: DONE

## Implemented scope

`apps/api/src/company-context`. `X-Company-Id`/`X-Branch-Id` request
headers validated against active `UserCompany` membership,
`RequestContext` propagated to handlers, `GET /context/companies`,
`/context/companies/:id`, `/context/companies/:id/branches`,
`/context/current`. Frontend company/branch selectors in both apps,
namespaced per app in `localStorage`.

## Relevant docs

[docs/multi-company-architecture.md](../../docs/multi-company-architecture.md)

## Verification

`apps/api/test/company-context.e2e-spec.ts`.
