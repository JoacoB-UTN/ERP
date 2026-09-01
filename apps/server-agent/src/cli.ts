import fs from 'node:fs/promises';
import path from 'node:path';
import { parseAgentEnv } from './config';
import { createLogger } from './logger';
import { runBackup } from './backup';
import { runRestore } from './restore';
import { readManifest } from './manifest';
import { isArchiveName } from './naming';

/**
 * Support-facing CLI: `erp-backup <command>`.
 *
 * This is the only way to run a restore — see restore.ts for why it is not, and
 * must not become, an API endpoint.
 */

const USAGE = `
erp-backup — ERP Server backup tooling

  erp-backup now                       Take a backup immediately.
  erp-backup list                      List archives on disk and their status.
  erp-backup restore <archive>         Restore into a NEW database (safe default).
      [--into <database>]              Restore into a specific database name.
      [--overwrite]                    Restore over the live database. Stop the
                                       API service first.

Configuration is read from the environment (see apps/server-agent/README.md).
`.trim();

function parseFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }
  return flags;
}

async function commandList(backupDir: string): Promise<void> {
  const manifest = await readManifest(backupDir);
  const onDisk = new Set(
    (await fs.readdir(backupDir).catch(() => [] as string[])).filter(isArchiveName),
  );

  if (manifest.runs.length === 0) {
    console.log('No backup runs recorded yet.');
    return;
  }

  console.log('DATE                 STATUS   VERIFIED  OFFSITE    SIZE        FILE');
  for (const run of manifest.runs.slice(0, 30)) {
    const size = run.sizeBytes ? `${(run.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '-';
    const present = run.fileName && onDisk.has(run.fileName) ? run.fileName : `${run.fileName ?? '-'} (missing)`;
    console.log(
      [
        run.startedAt.slice(0, 19).replace('T', ' ').padEnd(20),
        run.status.padEnd(8),
        String(run.verified).padEnd(9),
        run.cloud.status.padEnd(10),
        size.padEnd(11),
        present,
      ].join(' '),
    );
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const env = parseAgentEnv(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const flags = parseFlags(rest);

  switch (command) {
    case 'now': {
      const record = await runBackup(env, logger, { trigger: 'manual' });
      process.exitCode = record.status === 'success' ? 0 : 1;
      return;
    }

    case 'list':
      await commandList(env.ERP_BACKUP_DIR);
      return;

    case 'restore': {
      const archive = rest.find((token) => !token.startsWith('--'));
      if (!archive) {
        console.error('An archive path is required: erp-backup restore <archive>');
        process.exitCode = 1;
        return;
      }

      const archivePath = path.isAbsolute(archive)
        ? archive
        : path.join(env.ERP_BACKUP_DIR, archive);

      const into = flags.get('into');
      const result = await runRestore(env, logger, {
        archivePath,
        targetDatabase: typeof into === 'string' ? into : undefined,
        overwrite: flags.get('overwrite') === true,
      });

      console.log(
        `Restored into "${result.targetDatabase}"${result.checksumVerified ? ' (checksum verified)' : ''}.`,
      );
      return;
    }

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
