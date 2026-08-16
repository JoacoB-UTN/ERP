# 0095 — Repository Portability, GitHub Collaboration and Multi-Agent Development

Status: DONE
Depends on: 009 (Pricing)
Agent: Claude
Base branch: main
Branch: chore/multi-agent-setup
PR: not yet opened — no GitHub remote configured in this environment (see below)

## Objective

Prepare the repository so it can be developed collaboratively by human
developers, Claude Code, OpenAI Codex, and future agents without relying
on any agent's private conversation history — organizational/
infrastructure only, no ERP business behavior changed.

## Implemented scope

- `AGENTS.md` (new, root) — the shared cross-agent rulebook: project
  identity, source-of-truth policy, architecture invariants, required
  verification, documentation links, parallel-work rules, code review
  rules (including the critical-red-flags list), human collaboration.
- `CLAUDE.md` — rewritten to point to `AGENTS.md` first and hold only
  Claude-specific supplementary detail (concrete code shapes/examples per
  module), removing the ~230-line duplicated rulebook that used to live
  here.
- `docs/architecture.md`, `docs/implementation-status.md`,
  `docs/roadmap.md`, `docs/development-workflow.md`,
  `docs/multi-agent-workflow.md` (all new) — verified against actual code,
  not assumed from prior task descriptions.
- `docs/README.md` and root `README.md` updated: doc-index links, an
  `Inventory`/`Pricing` summary added (previously entirely missing from
  README even though both modules were implemented), a stale "no business
  modules yet" architecture section replaced with a pointer to
  `docs/architecture.md`, model list and project-structure tree brought
  up to date.
- `prompts/` (new) — `README.md` (format, ownership, branch naming,
  after-merge rule), `completed/001` through `009` (short status records,
  not reconstructed original prompt text — see the note in
  `prompts/README.md` for why), `planned/010` through `015` (agent-neutral
  stubs for the demo-first roadmap milestones — explicitly not started).
- `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/agent-task.md`,
  `.github/ISSUE_TEMPLATE/bug.md` (all new).
- `.github/workflows/ci.yml` (new) — lint/typecheck job, a test job
  (Postgres 16 + Redis 7 service containers, migrate deploy, seed, unit +
  e2e tests) using dummy/test-only secrets, and a build job for all three
  apps. `prisma migrate deploy` and the seed were both manually verified
  against a throwaway local database before trusting the workflow (see
  Verification below) — no other part of the pipeline could be executed
  in this environment (no GitHub remote/Actions runner available).

## Repository state discovered and addressed

`main` had exactly one commit (the original foundation skeleton) — every
module implemented since (Authentication through Pricing, Prompts
002–009) existed only as uncommitted working-tree changes, with no git
history and no GitHub remote. This directly blocked the task's own goal
(the repository as durable source of truth), so it was fixed as a
prerequisite: a `chore/multi-agent-setup` branch was created from `main`,
the accumulated Prompts 002–009 work was committed as one clearly-described
commit (after removing leftover scratch/debug files that had never been
cleaned up — `apps/api/decimal_check.*`, `apps/api/tmp-create-test-user.*`),
and this task's own deliverables were committed on top as a second commit
on the same branch. See `prompts/completed/001-foundation.md` for the
detail on why 002–009 don't have individual commits.

## Acceptance criteria

- [x] `AGENTS.md` created, concise, cross-agent.
- [x] `CLAUDE.md` points to `AGENTS.md`, duplication removed, no
      invariants lost.
- [x] `docs/architecture.md`, `implementation-status.md`, `roadmap.md`,
      `development-workflow.md`, `multi-agent-workflow.md` created,
      verified against code.
- [x] `docs/README.md` indexes everything.
- [x] `prompts/` structure created with an honest 001–009 record and
      agent-neutral 010–015 planning stubs.
- [x] `.github/pull_request_template.md` + `ISSUE_TEMPLATE/` created.
- [x] `.github/workflows/ci.yml` created; the migration/seed steps
      manually verified against a real database.
- [x] No ERP business schema/behavior changed.
- [x] No UI redesign.
- [x] No dependency upgrades.
- [x] No git history rewritten; branch used instead of committing
      directly to `main`.
- [x] Full verification run (see below) — no regressions.

## Verification

Run from repository root unless noted:

```
npm run lint        → clean (0 errors; 2 pre-existing, unrelated warnings)
npm run typecheck   → clean, all workspaces
npm test            → 6 suites / 55 tests passed
npm run test:e2e    → 10 suites / 134 tests passed
npm run build       → api + gestion + facturacion all succeed
```

Additionally, run manually against a throwaway local database
(`erp_platform_ci_test`, dropped afterward) to validate the exact CI
steps before trusting them:

```
DATABASE_URL=... npm run db:migrate:deploy --workspace=apps/api   → applies all 9 migrations cleanly
DATABASE_URL=... SEED_ADMIN_*=... npm run db:seed                  → seeds cleanly
```

## Out of scope (explicitly deferred)

No new ERP business functionality was implemented. GitHub remote
creation, pushing the branch, opening the Pull Request, configuring
branch protection, and creating GitHub labels all remain manual actions
for the user — see the final chat response for the exact steps.
