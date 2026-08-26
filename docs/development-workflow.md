# Development Workflow

Real commands, taken from `package.json`/workspace configuration — not
invented. If a command here stops matching `package.json`, fix this
file.

## New developer setup

```bash
git clone <repo-url>
cd erp-platform
npm install
cp .env.example apps/api/.env              # then edit apps/api/.env if needed
cp .env.example apps/gestion/.env.local     # NEXT_PUBLIC_* overrides only — see .env.example
cp .env.example apps/facturacion/.env.local # same

docker compose up -d    # starts Postgres (:5433) and Redis (:6380)
# or install Postgres 16 / Redis 7 locally and point DATABASE_URL/REDIS_URL
# in apps/api/.env at them instead — see .env.example

npm run db:migrate
npm run db:seed
npm run dev
```

See the root [README.md](../README.md) for the full environment-variable
table and seeded demo data (companies, users, permissions, sample
customers/products/prices).

## Commands

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Run everything (api :3001 + gestion :3000 + facturacion :3002) | `npm run dev` |
| Run only the API | `npm run dev:api` |
| Run only Gestión | `npm run dev:gestion` |
| Run only Facturación | `npm run dev:facturacion` |
| Apply migrations | `npm run db:migrate` |
| Seed demo data (idempotent) | `npm run db:seed` |
| Prisma Studio | `npm run db:studio` |
| Lint (all workspaces) | `npm run lint` |
| Typecheck (all workspaces) | `npm run typecheck` |
| Format (write) | `npm run format` |
| Format (check only) | `npm run format:check` |
| Unit tests (`apps/api`, mocked deps) | `npm test` |
| E2E tests (`apps/api`, real Postgres + Redis) | `npm run test:e2e` |
| Production build (api + gestion + facturacion) | `npm run build` |
| Production build — API only | `npm run build:api` |
| Production build — Gestión only | `npm run build:gestion` |
| Production build — Facturación only | `npm run build:facturacion` |

`npm run test:e2e` needs `NODE_OPTIONS=--experimental-vm-modules`
(already wired into the script). Both test commands need a real,
reachable Postgres + Redis — nothing is mocked at the database layer.

## Ports (local dev)

| App | Port | URL |
| --- | --- | --- |
| `apps/api` | `3001` | `http://localhost:3001/api/v1` |
| `apps/gestion` | `3000` | `http://localhost:3000` |
| `apps/facturacion` | `3002` | `http://localhost:3002` |

## Creating a safe change

1. Read [AGENTS.md](../AGENTS.md), then
   [implementation-status.md](implementation-status.md) and the specific
   `docs/<module>.md` for what you're touching.
2. Branch from an up-to-date `main` (see "Git workflow" below).
3. Make the smallest change that satisfies the task — see AGENTS.md's
   parallel-work rules for sensitive shared files that need coordination
   before you touch them from a branch that isn't the only one changing
   them.
4. Run the commands relevant to what you changed: at minimum `lint` +
   `typecheck`; add `test`/`test:e2e` if you touched `apps/api`; add
   `build` before calling anything done; run `db:migrate` (and re-run
   `db:seed`, checking it stays idempotent) if you touched the Prisma
   schema.
5. Update the relevant `docs/<module>.md` and
   [implementation-status.md](implementation-status.md) in the same
   change if you added/changed a module's behavior.
6. Open a Pull Request (see below) — don't merge your own work into
   `main` without review for anything beyond a trivial fix.

## Git workflow

`main` represents the integrated, stable development state. Don't
develop directly on `main` — branch, then open a Pull Request.

### Branch naming

```
feature/<short-name>
fix/<short-name>
refactor/<short-name>
chore/<short-name>

agent/codex-<task>
agent/claude-<task>
```

Examples: `feature/sales-order-draft`, `fix/inventory-negative-stock-race`,
`agent/codex-demo-sales`, `agent/claude-inventory-hardening`.

### Pull Requests

Every meaningful branch becomes a PR before merging into `main`, using
the repository's PR template (`.github/pull_request_template.md`) —
summary, scope, database/API/UI changes, verification checklist, manual
verification notes, known limitations, deferred work.

### Merge strategy

**Squash merge** for agent-generated and typical feature branches, unless
the branch's own history is deliberately meaningful and worth preserving
(rare — say so in the PR if it applies). Agent work sessions often
produce intermediate commits that don't need permanent preservation in
`main`'s history. Never rewrite already-pushed `main` history
(`git push --force`, `git reset --hard` on shared branches).

### Recommended branch protection (`main`)

Configure in the GitHub repository settings once a remote exists (see
[multi-agent-workflow.md](multi-agent-workflow.md) for current remote
status):

- Require a Pull Request before merging.
- Require the CI workflow to pass before merging.
- Prevent force-pushes to `main`.
- Prevent deletion of `main`.

## Commit hygiene

- Don't commit `.env` files, `node_modules/`, build artifacts (`dist/`,
  `.next/`), coverage output, or agent scratch files — `.gitignore`
  already covers the standard ones; if you generate a new kind of
  throwaway file, extend `.gitignore` rather than committing it once and
  remembering to avoid it next time.
- Keep commits reasonably scoped to the task at hand — avoid
  opportunistic unrelated refactors (renaming routes, reformatting
  unrelated files, swapping libraries) inside a task-focused branch
  unless the task explicitly asked for it.
- When multiple branches add dependencies in parallel, expect lockfile
  conflicts. Don't hand-merge `package-lock.json` — resolve the
  `package.json` conflicts, then regenerate the lockfile with `npm
  install` and re-run `lint`/`typecheck`/`test`/`build`.
