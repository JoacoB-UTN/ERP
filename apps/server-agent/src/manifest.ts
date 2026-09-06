import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BACKUP_MANIFEST_FILENAME,
  BACKUP_MANIFEST_VERSION,
  type BackupManifest,
  type BackupRunRecord,
  type BackupSettings,
} from '@erp/shared';

/**
 * Persistence for the backup manifest.
 *
 * See the contract in `@erp/shared` for why this lives on disk rather than in
 * PostgreSQL. Writes are atomic (temp file + rename) so a crash mid-write can
 * never leave the operator with a truncated, unparseable history.
 */

/** Keep the file bounded — roughly two years of daily runs. */
const MAX_RETAINED_RUNS = 750;

export function manifestPath(backupDir: string): string {
  return path.join(backupDir, BACKUP_MANIFEST_FILENAME);
}

const emptyManifest = (): BackupManifest => ({
  version: BACKUP_MANIFEST_VERSION,
  runs: [],
});

/**
 * Reads the manifest, tolerating absence and corruption.
 *
 * A missing manifest means "backups have never run here" — a normal state on a
 * fresh install, not an error. A corrupt manifest must not stop the agent from
 * taking today's backup, which matters far more than the history; the caller
 * gets an empty manifest and the damaged file is left untouched for support.
 */
export async function readManifest(backupDir: string): Promise<BackupManifest> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath(backupDir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyManifest();
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as BackupManifest;
    if (!parsed || !Array.isArray(parsed.runs)) return emptyManifest();
    return {
      version: parsed.version ?? BACKUP_MANIFEST_VERSION,
      settings: parsed.settings,
      runs: parsed.runs,
    };
  } catch {
    return emptyManifest();
  }
}

export async function writeManifest(backupDir: string, manifest: BackupManifest): Promise<void> {
  const target = manifestPath(backupDir);
  const temp = `${target}.tmp`;
  const bounded: BackupManifest = {
    version: manifest.version,
    settings: manifest.settings,
    runs: manifest.runs.slice(0, MAX_RETAINED_RUNS),
  };

  await fs.writeFile(temp, `${JSON.stringify(bounded, null, 2)}\n`, 'utf8');
  await fs.rename(temp, target);
}

/**
 * Publishes the agent's effective settings so the API and Gestión can show the
 * real schedule without duplicating the server's backup configuration. Called
 * at agent startup, so a settings change takes effect in the UI on restart
 * rather than waiting for the next nightly run.
 */
export async function publishSettings(
  backupDir: string,
  settings: BackupSettings,
): Promise<void> {
  const manifest = await readManifest(backupDir);
  manifest.settings = settings;
  await writeManifest(backupDir, manifest);
}

/** Prepends a run (newest first) and persists. */
export async function recordRun(backupDir: string, run: BackupRunRecord): Promise<void> {
  const manifest = await readManifest(backupDir);
  manifest.runs.unshift(run);
  await writeManifest(backupDir, manifest);
}
