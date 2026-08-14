# ERP Platform

Foundation for a multi-company ERP platform. This repository currently
contains **only the technical foundation** — multi-tenancy skeleton
(Tenant/Company/Branch/User/UserCompany), infrastructure wiring, and an
empty application shell. No business domain (sales, inventory, purchasing,
invoicing, accounting, fiscal integrations) is implemented yet; see
`CLAUDE.md` for the rules that will govern that work when it starts.

## Architecture

Modular monolith (not microservices). See `CLAUDE.md` for the full list of
expected domain modules and the conventions (ledger-based inventory/
treasury/balances, explicit state machines, money as `NUMERIC(19,4)` never
float, tenant scoping on every query, etc.) that apply once domain work
begins.

```
apps/
  api/            NestJS backend
  web/             Next.js frontend
packages/
  config/          Shared, validated environment schema (Zod)
  shared/          Framework-agnostic types shared by api + web
  eslint-config/    Shared ESLint flat config
  typescript-config/ Shared tsconfig bases
infrastructure/    Reserved for deployment infra (empty for now)
docs/              Reserved for design docs/ADRs (empty for now)
```

### Backend (`apps/api`)

NestJS + TypeScript + Prisma + PostgreSQL + Redis.

- `src/config` — global, validated env config (`AppConfigModule`). Fails
  fast (throws at boot) if required variables are missing/invalid.
- `src/database` — `PrismaService` (global), connects via `@prisma/adapter-pg`.
- `src/redis` — `RedisService` (global), a plain connection only — no queues
  yet (see `src/queue/README.md`).
- `src/health` — `GET /api/v1/health`.
- `src/common/filters` — global exception filter producing the standard
  error envelope.
- `src/modules/*` — one empty, documented folder per future domain module
  (from `CLAUDE.md`'s "Expected modules" list). No logic lives there yet.

### Frontend (`apps/web`)

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Query +
React Hook Form + Zod. Currently just an application shell (sidebar/header/
main layout) and a single page that renders live API health status. No
business screens.

## Requirements

- Node.js ≥ 20
- npm (workspaces are used for the monorepo — no pnpm/yarn required)
- PostgreSQL 16 and Redis 7, either via Docker or installed locally

## Setup

```bash
npm install
cp .env.example apps/api/.env      # then edit apps/api/.env if needed
cp .env.example apps/web/.env.local # only NEXT_PUBLIC_API_URL is used here
```

### Infrastructure: Docker (preferred)

```bash
docker compose up -d   # starts postgres (:5433) and redis (:6380)
```

Then point `apps/api/.env`'s `DATABASE_URL`/`REDIS_URL` at those ports (see
`.env.example`, already configured for the compose ports).

### Infrastructure: without Docker

If Docker isn't available, install Postgres 16 and Redis locally (e.g. via
Homebrew: `brew install postgresql@16 redis`) and point `DATABASE_URL`/
`REDIS_URL` in `apps/api/.env` at your local instances instead. This is how
the foundation was actually verified in this environment (Docker wasn't
installed on the build machine) — functionally equivalent, just not via
`docker compose up -d`. See "Decisions" in the PR/commit description for
details.

## Environment variables

Defined and validated in `packages/config/src/env.ts`; the app will not
start if these are missing or malformed.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `API_PORT` | no | `3001` | |
| `DATABASE_URL` | **yes** | — | Postgres connection string |
| `REDIS_URL` | **yes** | — | Redis connection string |
| `CORS_ORIGIN` | no | `http://localhost:3000` | |
| `LOG_LEVEL` | no | `info` | pino level |

`apps/web` only reads `NEXT_PUBLIC_API_URL` (defaults to
`http://localhost:3001/api/v1`).

## Database

```bash
npm run db:migrate   # apply migrations (creates the DB schema from empty)
npm run db:seed      # demo Tenant/Company/Branch + placeholder user
npm run db:studio    # Prisma Studio
```

Models: `Tenant`, `Company`, `Branch`, `User`, `UserCompany` — see
`apps/api/prisma/schema.prisma`. The seed creates "Demo Organization" →
"Demo Company" → "Main Branch", plus a `admin@example.local` user row with
a random, unusable password hash (there is no login flow yet — see
Deferred, below).

## Development

```bash
npm run dev        # builds packages/*, then runs api (:3001) + web (:3000)
npm run dev:api     # api only
npm run dev:web     # web only
```

## Tests

```bash
npm test            # apps/api unit tests (mocked dependencies, no I/O)
npm run test:e2e     # apps/api e2e tests (real Postgres + Redis required)
```

`test:e2e` needs `NODE_OPTIONS=--experimental-vm-modules` (already wired
into the script) — Prisma 7's WASM query compiler uses a dynamic `import()`
that plain Jest can't evaluate without it.

## Quality gates

```bash
npm run lint
npm run typecheck
npm run format        # write
npm run format:check  # check only, no writes
npm run build
```

## Project structure

```
apps/api/src/
  app.module.ts
  main.ts
  config/          AppConfigModule (validated env)
  database/        PrismaService + DatabaseModule
  redis/           RedisService + RedisModule
  health/          GET /api/v1/health
  common/filters/   Global exception filter (error envelope)
  queue/           README only — BullMQ boundary, not wired up yet
  modules/         One README-only folder per future domain module
apps/api/prisma/
  schema.prisma
  seed.ts
  migrations/

apps/web/src/
  app/             layout.tsx, page.tsx
  components/layout/   Sidebar, Header, AppShell
  components/providers/ QueryProvider (TanStack Query)
  components/ui/    shadcn/ui primitives
  lib/             api.ts (fetch helper), utils.ts (shadcn cn())
```
