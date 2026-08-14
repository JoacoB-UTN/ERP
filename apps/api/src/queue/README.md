# Queue module boundary (future work)

`bullmq` is installed as a dependency and Redis connectivity is available
via `RedisModule` (`src/redis`), but no queues, producers or processors are
implemented yet — that belongs to the task that actually needs background
jobs.

When that task arrives, this is the intended boundary:

- `src/queue/queue.module.ts` — registers `BullModule.forRootAsync` (from
  `@nestjs/bullmq`, not yet installed) using the same `REDIS_URL` consumed
  by `RedisService`.
- One queue per bounded background-job concern (e.g. `outbox`,
  `notifications`), each in its own subfolder with its own processor,
  following the domain module boundaries described in `CLAUDE.md`.
- Producers live inside the domain module that raises the job (e.g. the
  future `sales` module enqueues an invoice-email job); this folder should
  only hold cross-cutting queue configuration, not domain logic.

Do not add queue definitions here speculatively — create them when a real
task requires them.
