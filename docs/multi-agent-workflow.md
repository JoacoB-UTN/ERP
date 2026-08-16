# Multi-Agent Workflow

How Claude Code, OpenAI Codex, and human developers collaborate on this
repository without relying on any agent's private conversation history.
Read this alongside [AGENTS.md](../AGENTS.md) (the rules) and
[development-workflow.md](development-workflow.md) (day-to-day commands
and the branch/PR mechanics).

## The golden rule

Parallel work is allowed only when tasks have sufficiently independent
scopes. Never intentionally assign two agents simultaneous ownership of
the same core implementation area without coordination.

Sensitive shared files/areas — coordinate explicitly before two branches
touch these at once:

```
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/
apps/api/prisma/seed.ts
package-lock.json
apps/api/src/auth/
apps/api/src/company-context/
apps/api/src/authorization/
apps/api/src/audit/
packages/shared/       (shared API contracts)
packages/auth-client/  (shared UI-facing client)
root configuration (package.json, tsconfig bases, eslint config, CI)
```

If two parallel tasks genuinely need the same sensitive file, either
explicitly assign one owner and have the other rebase on top, or
serialize those specific portions of the work.

## The dependency rule

A task must not be started from `main` if it depends on another task
that's still unmerged.

```
Task B depends on Task A.
Task A is still in branch agent/codex-A (not merged).

Do NOT independently implement B from old main.
Either:
  - wait for A to merge, then branch B from the updated main, or
  - explicitly branch B from agent/codex-A and document the dependency
    in B's task/PR description.
```

This prevents an agent from developing against a repository state that's
already known to be stale.

## Flow

```
main
 │
 ├── agent/codex-task-a
 │        ↓
 │       PR A  →  review  →  merge
 │
 └── agent/claude-task-b
          ↓
         PR B  →  review  →  merge
```

Both branches may exist and be worked on simultaneously **only if their
scopes are independent** (see the golden rule above).

### Safe parallel example

```
Codex:  improve inventory concurrency tests
Claude: implement an isolated Gestión UX improvement (e.g. a products list filter)

Both branch from current main.
Neither touches the same schema/domain/sensitive file.
```

### Unsafe parallel example — avoid

```
Codex:  modify the Pricing Prisma schema
Claude: modify the Pricing Prisma schema, at the same time

Same domain, same migration surface, guaranteed conflict/inconsistency.
```

## Database migration ownership

Only one parallel task should normally own a given database/domain
schema change at a time. If multiple branches do end up each adding a
migration:

- Each migration needs a clear, stated dependency order.
- Before merging, rebase/update the branch against the latest `main`.
- Re-run a fresh migration verification (`npm run db:migrate` against a
  clean or up-to-date database) after rebasing — don't assume an older
  local run still applies.
- Inspect migration ordering/conflicts by hand; never blindly merge
  conflicting Prisma schema changes and hope Prisma resolves it.

## Agent task ownership template

Every parallel agent task — whether tracked as a GitHub Issue (see the
`agent-task` issue template) or a file under `prompts/planned/` — should
state:

```
Task:
Owner:
Base branch:
Expected files/modules:
Files/modules that must NOT be changed:
Dependencies:
Acceptance criteria:
Verification commands:
```

## Avoid giant shared changes

Parallel agents should avoid opportunistic refactoring outside their
assigned scope. A Products task must not also rewrite authentication,
rename every API route, replace the state-management architecture, or
reformat the entire repository — unless that was explicitly the task.
Small scope keeps merge conflicts small and reviewable.

## Prompt allocation strategy

Codex and Claude may implement independent tasks in parallel. Either
agent may also review the other's PR:

```
Codex implements a feature → PR → Claude or a human reviews
Claude implements a feature → PR → Codex or a human reviews
```

Dual-agent review isn't mandatory for every small change — reserve it for
changes that touch the high-risk areas below.

### High-risk changes — get extra review

- Inventory concurrency (`InventoryService`, balance mutation)
- Any future financial ledger (accounting, AR/AP, treasury)
- Tax/fiscal behavior (ARCA integration, when it exists)
- Payments (when they exist)
- Database migrations touching financial/inventory history
- Authorization/security code paths

These should not be merged solely because one agent reports tests
passed — get a second read (agent or human) before merging.

## Codex onboarding

1. Open/connect the GitHub repository.
2. Read [AGENTS.md](../AGENTS.md).
3. Read [implementation-status.md](implementation-status.md).
4. Read the relevant `docs/<module>.md` for the task at hand.
5. Work on a dedicated branch (or worktree).
6. Run the verification commands relevant to the change (see
   [development-workflow.md](development-workflow.md)).
7. Open a Pull Request against `main` using the PR template.

Do not rely on Codex having access to any previous Claude Code
conversation — nothing outside this repository is available context.

## Claude Code onboarding

1. Read `CLAUDE.md`.
2. `CLAUDE.md` directs to `AGENTS.md` — read that next.
3. Read [implementation-status.md](implementation-status.md) and the
   relevant `docs/<module>.md`.
4. Work on a dedicated branch (or worktree).
5. Run the verification commands relevant to the change.
6. Open a Pull Request against `main` using the PR template.

Do not require or assume access to prior Claude conversation history —
the repository itself must contain enough context to continue safely.

## Task completion

When a task's PR merges:

1. Update [implementation-status.md](implementation-status.md) and any
   relevant `docs/<module>.md` — ideally in the same PR, not a follow-up.
2. If the task was tracked as a file under `prompts/planned/`, move it to
   `prompts/completed/` and update its metadata (`Status: DONE`, `PR:
   #...`).

`implementation-status.md` plus the code/tests remain authoritative if a
prompt file and reality ever diverge after merge — prompt files describe
intent at planning time, not a live status feed.

## Human collaboration

Humans remain responsible for: merging PRs, resolving ambiguous business
decisions, reviewing destructive migrations, managing production
secrets, and approving production deployment. Agents may implement and
review code but must not silently make an irreversible production
decision.
