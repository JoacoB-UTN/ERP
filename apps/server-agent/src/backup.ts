import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupRunRecord } from '@erp/shared';
import type { AgentEnv } from './config';
import { connectionArgs, parseDatabaseUrl, resolvePgBinary, runPgTool } from './pg';
import { buildArchiveName, isArchiveName } from './naming';
import { planRetention } from './retention';
import { recordRun } from './manifest';
import { uploadArchive } from './cloud';
import type { Logger } from './logger';

/**
 * One backup run, end to end:
 *
 *   dump → verify → checksum → record → offsite copy → prune
 *
 * The verify step is the one that makes this a backup rather than a file. A
 * pg_dump that exits 0 can still have produced an archive that pg_restore
 * cannot read (a truncated write, a full disk, an antivirus holding the
 * handle). Discovering that during a real restore — the worst possible moment —
 * is the failure mode this step exists to prevent, so a run that cannot be
 * listed back is failed and its archive deleted rather than left to look
 * healthy in the folder.
 *
 * Pruning happens last and only after a successful, verified run: a failing
 * agent must never delete old backups it cannot replace.
 */

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function listArchives(backupDir: string): Promise<string[]> {
  const entries = await fs.readdir(backupDir);
  return entries.filter(isArchiveName);
}

async function pruneExpired(
  env: AgentEnv,
  now: Date,
  logger: Logger,
): Promise<void> {
  const archives = await listArchives(env.ERP_BACKUP_DIR);
  const { deleteExpired } = planRetention(
    archives,
    env.ERP_BACKUP_RETENTION_DAYS,
    env.ERP_BACKUP_KEEP_MINIMUM,
    now,
  );

  for (const fileName of deleteExpired) {
    try {
      await fs.unlink(path.join(env.ERP_BACKUP_DIR, fileName));
      logger.info(`Pruned expired backup "${fileName}".`);
    } catch (error) {
      // A file we cannot delete is a disk-space problem, not a backup failure.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not prune "${fileName}": ${message}`);
    }
  }
}

export interface BackupOptions {
  trigger: 'scheduled' | 'manual';
}

export async function runBackup(
  env: AgentEnv,
  logger: Logger,
  options: BackupOptions,
): Promise<BackupRunRecord> {
  const startedAt = new Date();
  const connection = parseDatabaseUrl(env.DATABASE_URL);
  const fileName = buildArchiveName(connection.database, startedAt);
  const archivePath = path.join(env.ERP_BACKUP_DIR, fileName);

  const base = {
    id: randomUUID(),
    startedAt: startedAt.toISOString(),
    trigger: options.trigger,
  };

  const fail = async (message: string, verified = false): Promise<BackupRunRecord> => {
    // Never leave a half-written archive behind: it would be indistinguishable
    // from a good one in Explorer and could be picked for a restore.
    await fs.rm(archivePath, { force: true });

    const record: BackupRunRecord = {
      ...base,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      durationMs: Date.now() - startedAt.getTime(),
      verified,
      cloud: { status: env.ERP_BACKUP_CLOUD_ENABLED ? 'failed' : 'disabled' },
      error: message,
    };
    logger.error(`Backup failed: ${message}`);
    await recordRun(env.ERP_BACKUP_DIR, record);
    return record;
  };

  await fs.mkdir(env.ERP_BACKUP_DIR, { recursive: true });
  logger.info(`Starting ${options.trigger} backup of "${connection.database}".`);

  // ---- Dump ----
  // Custom format (-Fc): compressed, and the only format pg_restore can read
  // selectively (a single table, a single schema) during a partial recovery.
  const dump = await runPgTool(
    resolvePgBinary('pg_dump', env.ERP_PG_BIN_DIR),
    [
      ...connectionArgs(connection),
      '--dbname',
      connection.database,
      '--format',
      'custom',
      '--compress',
      '6',
      '--file',
      archivePath,
    ],
    connection,
    env.ERP_BACKUP_TIMEOUT_MS,
  );

  if (dump.code !== 0) {
    return fail(`pg_dump exited with code ${dump.code}: ${dump.stderr.trim()}`);
  }

  // ---- Verify ----
  const verify = await runPgTool(
    resolvePgBinary('pg_restore', env.ERP_PG_BIN_DIR),
    ['--list', archivePath],
    connection,
    env.ERP_BACKUP_TIMEOUT_MS,
  );

  if (verify.code !== 0) {
    return fail(
      `Archive failed verification — pg_restore --list exited with code ${verify.code}: ${verify.stderr.trim()}`,
    );
  }

  const stats = await fs.stat(archivePath);
  const sha256 = await sha256File(archivePath);
  logger.info(`Backup written and verified: ${fileName} (${stats.size} bytes).`);

  // ---- Offsite copy (best effort — see cloud.ts) ----
  const cloud = await uploadArchive(env, archivePath, fileName, stats.size, logger);

  const record: BackupRunRecord = {
    ...base,
    finishedAt: new Date().toISOString(),
    status: 'success',
    fileName,
    sizeBytes: stats.size,
    sha256,
    durationMs: Date.now() - startedAt.getTime(),
    verified: true,
    cloud,
  };

  await recordRun(env.ERP_BACKUP_DIR, record);

  // ---- Prune (only after a verified success) ----
  await pruneExpired(env, startedAt, logger);

  return record;
}
