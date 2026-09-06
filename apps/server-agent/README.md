# @erp/server-agent

ERP Server maintenance agent: scheduled PostgreSQL backups, integrity
verification, retention and restore.

Runs as its **own** Windows service, separate from `apps/api` — backups must
keep running while the API is stopped for maintenance, and a crash in one must
not take down the other.

**Read [docs/backups.md](../../docs/backups.md) first.** It explains the design
decisions this package implements, in particular why taking and restoring a
backup are deliberately not API operations, and why the run history is a file
rather than a database table.

## Commands

```
erp-backup now                    Take a backup immediately.
erp-backup list                   List archives on disk and their status.
erp-backup restore <archive>      Restore into a NEW database (safe default).
    [--into <database>]           Restore into a specific database name.
    [--overwrite]                 Restore over the live database. Stop the ERP first.
```

Configuration comes from the environment; the full table lives in
[docs/backups.md](../../docs/backups.md#configuration). The minimum is
`DATABASE_URL`.

## Development

```
npm run typecheck --workspace=apps/server-agent
npm run lint --workspace=apps/server-agent
npm run test --workspace=apps/server-agent
```

The tests are pure unit tests — no database, no network, no filesystem beyond a
temp directory — so they run anywhere. The code that shells out to `pg_dump` /
`pg_restore` is exercised against a real PostgreSQL only through the ERP Server
installer's smoke test, not here.
