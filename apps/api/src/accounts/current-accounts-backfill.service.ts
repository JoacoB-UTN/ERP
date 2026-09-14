import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  backfillCurrentAccounts,
  hasPendingCurrentAccountsBackfill,
  isBackfillResultEmpty,
} from './current-accounts-backfill';

/**
 * Arbitrary but fixed key for `pg_try_advisory_xact_lock`. Postgres advisory
 * locks share one namespace per database, so the value only has to be stable
 * and not collide with another advisory lock in this codebase.
 *
 * It is a **transaction**-scoped lock, not a session-scoped one, and that is
 * not a detail. Prisma hands every standalone query whichever connection the
 * pool has free, so `pg_try_advisory_lock` and a later `pg_advisory_unlock`
 * can — and under concurrency do — run on two different connections: the
 * unlock then returns false and the lock stays held for the life of the
 * connection that took it. On a long-lived API process that means the
 * backfill silently never runs again. `pg_try_advisory_xact_lock` inside
 * `$transaction` cannot drift: the transaction pins one connection and
 * Postgres releases the lock on commit or rollback, with nothing to unlock
 * by hand and nothing to leak if the process dies mid-run.
 */
const BACKFILL_ADVISORY_LOCK_KEY = 4_017_092_601;

/**
 * The backfill only opens a transaction when the probe already found
 * pending work, so this budget is for a real upgrade of an installation
 * with history — not for a normal boot, which never gets here. Generous on
 * purpose: exceeding it aborts the transaction and the ledger simply stays
 * as it was, to be retried on the next boot or by the CLI.
 */
const BACKFILL_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;
const BACKFILL_TRANSACTION_MAX_WAIT_MS = 30 * 1000;

export type BackfillTrigger = 'startup';

/**
 * Runs the Current Accounts historical backfill when the API boots — see
 * docs/current-accounts.md.
 *
 * The problem it closes: `db:backfill-current-accounts` is a standalone
 * script and nothing made an upgrade run it, so an existing installation
 * that upgraded into this module got the tables, the code, and a
 * completely empty ledger against sales that already existed. Every
 * customer read as owing nothing until an administrator happened to know
 * the script was there. That is wrong data in production, not a missing
 * convenience.
 *
 * Why this is safe to run on every boot rather than once:
 *
 * - The backfill is **idempotent by construction** — every insert is
 *   `createMany({ skipDuplicates: true })` against the same unique
 *   constraint the live confirm()/cancel() paths use. It is not guarded
 *   by a "did I already run" flag that could drift from reality.
 * - It only ever **inserts**. It never updates or deletes a movement, so
 *   it cannot corrupt a ledger that is already correct — which is the
 *   same immutability rule the rest of the module obeys.
 * - A cheap EXISTS probe runs first, so a healthy installation pays one
 *   query per boot and loads nothing.
 */
@Injectable()
export class CurrentAccountsBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CurrentAccountsBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.configService.get(
      'ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT',
      { infer: true },
    );
    if (!enabled) {
      this.logger.log(
        'Current accounts backfill on boot is disabled (ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT=false) — run `npm run db:backfill-current-accounts --workspace=apps/api` by hand if this installation is upgrading into the module.',
      );
      return;
    }
    await this.run('startup');
  }

  /**
   * Never throws: a ledger that is still missing rows is bad, an API that
   * refuses to boot is worse. Any failure is logged loudly and startup
   * continues.
   */
  async run(trigger: BackfillTrigger): Promise<void> {
    try {
      await this.runOrThrow(trigger);
    } catch (error) {
      this.logger.error(
        `Current accounts backfill failed — the ledger may be missing historical movements. Run \`npm run db:backfill-current-accounts --workspace=apps/api\` to post them. ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async runOrThrow(trigger: BackfillTrigger): Promise<void> {
    // Cheap path first, outside any transaction or lock: a healthy
    // installation pays one EXISTS query per boot and stops here.
    if (!(await hasPendingCurrentAccountsBackfill(this.prisma))) {
      this.logger.debug(
        'Current accounts ledger is complete — nothing to backfill.',
      );
      return;
    }

    this.logger.warn(
      'Current accounts ledger has confirmed sales or receipts with no movements — backfilling historical rows.',
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Several API instances can boot at once on a LAN. One does the
        // work; the others move on. Losing the race is the normal case,
        // not an error. The lock is released with the transaction.
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(${BACKFILL_ADVISORY_LOCK_KEY}) AS locked`,
        );
        if (rows[0]?.locked !== true) return null;

        // Re-probe inside the lock: between the cheap probe above and
        // getting here, another instance may have done the whole job.
        if (!(await hasPendingCurrentAccountsBackfill(tx))) return null;

        const posted = await backfillCurrentAccounts(tx);

        // Same transaction as the rows it describes — see
        // docs/audit-architecture.md. Nothing is recorded when nothing
        // was posted.
        if (!isBackfillResultEmpty(posted)) {
          await this.audit.record(
            {
              action: 'CREATE',
              entityType: 'CurrentAccountsBackfill',
              metadata: { trigger, ...posted },
            },
            tx,
          );
        }
        return posted;
      },
      {
        timeout: BACKFILL_TRANSACTION_TIMEOUT_MS,
        maxWait: BACKFILL_TRANSACTION_MAX_WAIT_MS,
      },
    );

    if (result === null) {
      this.logger.debug(
        'Another instance is running the current accounts backfill, or it completed first — skipping.',
      );
      return;
    }

    if (isBackfillResultEmpty(result)) {
      // The probe saw pending work and the backfill posted nothing, so
      // say so rather than logging a silent success.
      this.logger.warn(
        'Current accounts backfill inserted no movements despite pending work being detected — inspect the ledger by hand.',
      );
      return;
    }

    this.logger.warn(
      `Current accounts backfill complete: ${result.salesCharges} sale charges, ${result.salesSettlements} tender settlements, ${result.receiptAccruals} receipt accruals, ${result.receiptReversals} receipt reversals.`,
    );
  }
}
