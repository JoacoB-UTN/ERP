# prompts

Durable, agent-neutral task specifications for this repository — the
same file format any of Claude Code, Codex, or a human developer can
read and execute without prior chat context.

## Purpose

A prompt file describes one unit of work: objective, scope, acceptance
criteria, and what's explicitly out of scope. It's the task-tracking
layer that sits above individual PRs — see
[docs/multi-agent-workflow.md](../docs/multi-agent-workflow.md) for how
this fits into the branch/PR flow.

## Completed vs. planned

- `completed/` — one file per unit of work that's actually merged. Each
  file is a short **status record** (what was implemented, relevant
  docs, relevant commits/PRs), not a full reconstruction of the original
  task text. See "A note on prompts 001–009" below for why.
- `planned/` — task specifications for work that hasn't started, or has
  a branch open but isn't merged yet.

`docs/implementation-status.md` plus the actual code/tests remain
authoritative for "what's implemented" if a prompt file and reality ever
diverge after merge. A prompt file describes intent at planning/completion
time — it is not a live status feed. If you find a `completed/` file that
disagrees with `docs/implementation-status.md`, trust the latter and fix
the former.

## A note on prompts 001–009

This repository's early development (foundation through Pricing) was
driven by a sequence of numbered task prompts in an AI coding session,
before this `prompts/` directory existed. The exact original prompt text
for those tasks is not available as a repository artifact, and this
directory does not attempt to reconstruct it from memory — doing so would
risk presenting invented text as historical fact. Instead,
`completed/001-009` are short, honest status records: what module each
one produced, and where to find the real detail (the corresponding
`docs/<module>.md` and the code itself). Repository truth (code, tests,
`docs/implementation-status.md`) is more important than a reconstructed
history.

Every prompt from `010` onward, and the `0095` collaboration-infrastructure
prompt itself, use the real format below and are stored as they were
actually specified.

## Prompt file format (`planned/`)

```markdown
# Task 010 — Demo Sales Core

Status: PLANNED
Depends on: 009
Agent: UNASSIGNED
Base branch: main
Branch:
PR:

## Objective

...

## Acceptance criteria

...

## Out of scope

...
```

Keep it plain, human-readable Markdown — no custom task-management
tooling, no YAML frontmatter required.

### Prompts must be agent-neutral

Never write a planned prompt starting with `Claude, ...` or `Codex,
...`. The same task must be executable by any agent or a human. Prefer:

```markdown
Before making changes:
- Read AGENTS.md.
- Read the relevant docs/<module>.md and docs/implementation-status.md.
- Inspect the current implementation — treat repository state as source
  of truth, not this file or any prior conversation.
```

## How to claim a task

1. Pick an `UNASSIGNED` (or your own newly-written) file under
   `planned/`.
2. Set `Agent:` to yourself (`Codex`, `Claude`, or a human name/handle),
   and `Status:` to `IN PROGRESS`.
3. Create a branch per the naming convention in
   [docs/development-workflow.md](../docs/development-workflow.md)
   (`agent/codex-<task>`, `agent/claude-<task>`, `feature/<name>`, ...)
   and fill in `Branch:`.
4. Do the work, run verification, open a PR, and fill in `PR:`.

## After merge

1. Update [docs/implementation-status.md](../docs/implementation-status.md)
   and the relevant `docs/<module>.md` — ideally in the same PR.
2. Move the file from `planned/` to `completed/`.
3. Set `Status: DONE` and fill in the merged `PR:` number.

Documentation updates are expected to land in the same PR as the code
they describe, not as a separate follow-up task.
