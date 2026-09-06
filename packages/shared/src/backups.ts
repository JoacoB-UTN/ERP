/**
 * Backup manifest contract — the single wire/disk shape shared by the
 * maintenance agent (`apps/server-agent`, which writes it), the API
 * (`apps/api/src/system`, which reads it) and Gestión (which renders it).
 *
 * CRITICAL: this manifest is written to a JSON file next to the backup
 * archives, NOT to PostgreSQL. Backup history must remain readable exactly
 * when the database is unavailable or corrupt — which is the only moment it
 * actually matters. Storing it inside the thing being backed up would make it
 * useless in the one scenario it exists for.
 *
 * It therefore must never contain secrets: no cloud credentials, no database
 * password, no connection string. See AGENTS.md on secret leakage.
 */

export const BACKUP_MANIFEST_VERSION = 1;

/** Manifest file name, resolved relative to the configured backup directory. */
export const BACKUP_MANIFEST_FILENAME = 'manifest.json';

export type BackupRunStatus = 'success' | 'failed';

/** Outcome of the optional offsite copy. `disabled` is the local-first default. */
export type BackupCloudStatus = 'disabled' | 'uploaded' | 'failed';

export interface BackupCloudResult {
  status: BackupCloudStatus;
  /** Object key within the bucket. Never includes credentials or the endpoint host. */
  key?: string;
  error?: string;
}

export interface BackupRunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: BackupRunStatus;
  /** How the run was started — a scheduled run, or an explicit operator request. */
  trigger: 'scheduled' | 'manual';
  /** Archive file name only, never an absolute path (paths leak server layout). */
  fileName?: string;
  sizeBytes?: number;
  /** SHA-256 of the archive, used to detect silent corruption at restore time. */
  sha256?: string;
  durationMs: number;
  /**
   * Whether `pg_restore --list` could read the archive back. A dump that cannot
   * be listed is not a backup, it is a file — so this is recorded per run and a
   * failed verification fails the whole run.
   */
  verified: boolean;
  cloud: BackupCloudResult;
  error?: string;
}

/**
 * The agent's effective configuration, mirrored into the manifest so the API
 * and Gestión can show the real schedule without the server's backup settings
 * having to be configured twice (once for the agent, once for the API). The
 * agent owns this configuration; everyone else reads it from here.
 *
 * Only non-sensitive settings appear: never the bucket credentials, never the
 * endpoint, never the database URL.
 */
export interface BackupSettings {
  /** Local times of day, e.g. ["03:00"]. */
  times: string[];
  retentionDays: number;
  keepMinimum: number;
  cloudEnabled: boolean;
  /** When the agent last started and wrote these settings. */
  updatedAt: string;
}

export interface BackupManifest {
  version: number;
  settings?: BackupSettings;
  runs: BackupRunRecord[];
}

/** Read-only status surfaced by the API to Gestión. */
export interface BackupStatusResponse {
  /** False when the agent has never written a manifest — i.e. backups are not running. */
  configured: boolean;
  lastRun: BackupRunRecord | null;
  lastSuccessfulRun: BackupRunRecord | null;
  /** Local time-of-day schedule ("03:00"), as configured on the server. */
  schedule: string[];
  retentionDays: number;
  /**
   * Next scheduled run, computed from the manifest's schedule. Null when the
   * agent has never reported its settings.
   */
  nextRunAt: string | null;
  /** How many archives are currently on disk. */
  storedBackups: number;
  totalSizeBytes: number;
  cloudEnabled: boolean;
  recentRuns: BackupRunRecord[];
}

/* -------------------------------------------------------------------------
 * Schedule maths
 *
 * Lives here rather than in the agent because two processes need it: the agent
 * (to know when to wake up) and the API (to tell Gestión when the next backup
 * is due). Duplicating it would let the two drift and show the operator a time
 * the agent will not actually honour.
 *
 * Deliberately not a cron implementation: a PyME backup policy is "every day at
 * 03:00", occasionally "03:00 and 15:00". HH:MM keeps the configuration
 * readable by whoever has to support the install, and the maths pure.
 * ---------------------------------------------------------------------- */


export interface ScheduledTime {
  hours: number;
  minutes: number;
}

export function parseTimes(times: string[]): ScheduledTime[] {
  return times.map((time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return { hours, minutes };
  });
}

/**
 * Next occurrence of any configured time, strictly after `from`.
 *
 * Uses local time on purpose — an operator who configures "03:00" means 03:00
 * on the wall clock in the shop, including across a DST change.
 */
export function nextRunAt(times: string[], from: Date): Date {
  const candidates = parseTimes(times).flatMap(({ hours, minutes }) => {
    const today = new Date(from);
    today.setHours(hours, minutes, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return [today, tomorrow];
  });

  const future = candidates
    .filter((candidate) => candidate.getTime() > from.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  // `times` is non-empty (enforced by the config schema), so a future candidate
  // always exists: the "tomorrow" variant of every time is by definition ahead.
  return future[0];
}
