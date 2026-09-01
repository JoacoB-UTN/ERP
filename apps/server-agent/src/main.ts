import fs from 'node:fs/promises';
import { parseAgentEnv } from './config';
import { createLogger } from './logger';
import { runBackup } from './backup';
import { nextRunAt } from './schedule';
import { publishSettings } from './manifest';

/**
 * Long-running service entry point.
 *
 * Registered as its own Windows service by the ERP Server installer, separate
 * from the API service: backups must keep running when the API is stopped for
 * maintenance, and a crash in one must not take down the other.
 */

async function main(): Promise<void> {
  const env = parseAgentEnv(process.env);
  const logger = createLogger(env.LOG_LEVEL);

  logger.info(
    `ERP Server agent starting. Backup dir: "${env.ERP_BACKUP_DIR}", schedule: ${env.ERP_BACKUP_TIMES.join(', ')}, retention: ${env.ERP_BACKUP_RETENTION_DAYS}d (keep at least ${env.ERP_BACKUP_KEEP_MINIMUM}).`,
  );
  logger.info(
    env.ERP_BACKUP_CLOUD_ENABLED
      ? 'Offsite copy: enabled.'
      : 'Offsite copy: disabled (local backups only).',
  );

  // Publish the effective settings up front so Gestión shows the real schedule
  // immediately after a configuration change, not only after the next run.
  await fs.mkdir(env.ERP_BACKUP_DIR, { recursive: true });
  await publishSettings(env.ERP_BACKUP_DIR, {
    times: env.ERP_BACKUP_TIMES,
    retentionDays: env.ERP_BACKUP_RETENTION_DAYS,
    keepMinimum: env.ERP_BACKUP_KEEP_MINIMUM,
    cloudEnabled: env.ERP_BACKUP_CLOUD_ENABLED,
    updatedAt: new Date().toISOString(),
  });

  let stopping = false;
  const stop = (signal: string) => {
    logger.info(`Received ${signal}, shutting down.`);
    stopping = true;
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  while (!stopping) {
    const now = new Date();
    const next = nextRunAt(env.ERP_BACKUP_TIMES, now);
    const waitMs = next.getTime() - now.getTime();
    logger.info(`Next backup at ${next.toISOString()}.`);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      // Do not hold the process open purely for the timer; the loop condition
      // decides when to exit.
      timer.unref?.();
      const poll = setInterval(() => {
        if (stopping) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve();
        }
      }, 1000);
      poll.unref?.();
    });

    if (stopping) break;

    try {
      await runBackup(env, logger, { trigger: 'scheduled' });
    } catch (error) {
      // A thrown error here (bad configuration, missing pg_dump) must not kill
      // the service: the operator fixes it and the next scheduled run recovers.
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Scheduled backup crashed: ${message}`);
    }
  }

  logger.info('ERP Server agent stopped.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ERP Server agent failed to start: ${message}`);
  process.exitCode = 1;
});
