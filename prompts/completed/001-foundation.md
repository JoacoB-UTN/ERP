# 001 — Foundation

Status: DONE

## Implemented scope

Monorepo (npm workspaces): `apps/api` (NestJS), `apps/web` (later
renamed to `apps/gestion` — see 006), `packages/{config,shared,
eslint-config,typescript-config}`. Backend: validated env config
(`AppConfigModule`), `PrismaService`/`RedisService`, `GET /api/v1/health`,
global exception filter, structured logging, security headers, CORS.
Initial Prisma schema: `Tenant`/`Company`/`Branch`/`User`/`UserCompany`.
Dev seed. Health e2e + unit tests.

## Relevant docs

[docs/architecture.md](../../docs/architecture.md)

## Notes

This is the only prompt with a dedicated, real git commit
(`c99d4a2 — ERP Foundation: monorepo, multi-tenancy skeleton, infra
wiring`) — everything else through 009 was implemented in later sessions
but never committed until Prompt `0095` caught the repository up in one
pass. See [prompts/README.md](../README.md) for why 001–009 are status
records rather than reconstructed original task text.
