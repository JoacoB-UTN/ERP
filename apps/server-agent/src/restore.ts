import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentEnv } from './config';
import { connectionArgs, parseDatabaseUrl, resolvePgBinary, runPgTool } from './pg';
import { sha256File } from './backup';
import { readManifest } from './manifest';
import type { Logger } from './logger';

/**
 * Restore is deliberately CLI-only and never reachable from the API.
 *
 * Two reasons. First, a restore replaces every company's data at once; there is
 * no company-scoped version of it, so there is no honest way to expose it
 * behind the per-company RBAC the rest of the product uses (see
 * docs/backups.md). Second, it must run with the API stopped — restoring under
 * a live application is how you get a half-old, half-new database.
 *
 * The default target is a NEW database, not the live one. Restoring beside the
 * running system lets an operator verify the archive actually contains what
 * they expect before anything irreversible happens; clobbering production
 * requires saying so explicitly with --overwrite.
 */

export interface RestoreOptions {
  archivePath: string;
  /** Database to restore into. Defaults to `<current>_restore_<timestamp>`. */
  targetDatabase?: string;
  /** Required to restore over the live database named in DATABASE_URL. */
  overwrite: boolean;
}

export interface RestoreResult {
  targetDatabase: string;
  checksumVerified: boolean;
}

function defaultTargetName(database: string, at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '');
  return `${database}_restore_${stamp}`.slice(0, 63); // PostgreSQL identifier limit.
}

/**
 * Compares the archive against the checksum recorded when it was taken.
 *
 * A mismatch means the file changed after the backup ran — bit rot, a partial
 * copy off a USB drive, or tampering. Restoring it would silently install
 * corrupt data, so this is a hard stop rather than a warning.
 */
async function verifyChecksum(
  env: AgentEnv,
  archivePath: string,
  logger: Logger,
): Promise<boolean> {
  const manifest = await readManifest(env.ERP_BACKUP_DIR);
  const fileName = path.basename(archivePath);
  const run = manifest.runs.find((entry) => entry.fileName === fileName && entry.sha256);

  if (!run?.sha256) {
    logger.warn(
      `No recorded checksum for "${fileName}" — cannot prove the archive is unmodified.`,
    );
    return false;
  }

  const actual = await sha256File(archivePath);
  if (actual !== run.sha256) {
    throw new Error(
      `Checksum mismatch for "${fileName}": the archive does not match what was backed up. Refusing to restore.`,
    );
  }

  logger.info(`Checksum verified for "${fileName}".`);
  return true;
}

export async function runRestore(
  env: AgentEnv,
  logger: Logger,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const connection = parseDatabaseUrl(env.DATABASE_URL);

  await fs.access(options.archivePath).catch(() => {
    throw new Error(`Archive not found: ${options.archivePath}`);
  });

  const target =
    options.targetDatabase ?? (options.overwrite ? connection.database : defaultTargetName(connection.database, new Date()));

  if (target === connection.database && !options.overwrite) {
    throw new Error(
      `Refusing to restore over the live database "${target}" without --overwrite.`,
    );
  }

  const checksumVerified = await verifyChecksum(env, options.archivePath, logger);

  // Confirm the archive is readable before touching any database at all.
  const listed = await runPgTool(
    resolvePgBinary('pg_restore', env.ERP_PG_BIN_DIR),
    ['--list', options.archivePath],
    connection,
    env.ERP_BACKUP_TIMEOUT_MS,
  );
  if (listed.code !== 0) {
    throw new Error(`Archive is not readable by pg_restore: ${listed.stderr.trim()}`);
  }

  if (target !== connection.database) {
    logger.info(`Creating target database "${target}".`);
    const created = await runPgTool(
      resolvePgBinary('createdb', env.ERP_PG_BIN_DIR),
      [...connectionArgs(connection), target],
      connection,
      env.ERP_BACKUP_TIMEOUT_MS,
    );
    // Tolerate "already exists" so a retried restore into the same scratch
    // database works; pg_restore --clean below sorts out the contents.
    if (created.code !== 0 && !/already exists/i.test(created.stderr)) {
      throw new Error(`Could not create database "${target}": ${created.stderr.trim()}`);
    }
  } else {
    logger.warn(
      `Restoring OVER the live database "${target}". The API service must be stopped.`,
    );
  }

  const restored = await runPgTool(
    resolvePgBinary('pg_restore', env.ERP_PG_BIN_DIR),
    [
      ...connectionArgs(connection),
      '--dbname',
      target,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--single-transaction',
      options.archivePath,
    ],
    connection,
    env.ERP_BACKUP_TIMEOUT_MS,
  );

  if (restored.code !== 0) {
    throw new Error(`pg_restore exited with code ${restored.code}: ${restored.stderr.trim()}`);
  }

  logger.info(`Restore completed into "${target}".`);
  return { targetDatabase: target, checksumVerified };
}
