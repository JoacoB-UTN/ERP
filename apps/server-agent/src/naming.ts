/**
 * Backup archive naming.
 *
 * The timestamp is encoded in the file name so that retention, and a human
 * looking at the folder in Explorer, can both order backups without needing
 * the manifest or trusting filesystem mtimes (which a copy, a restore from a
 * USB drive, or an antivirus quarantine can all rewrite).
 */

const ARCHIVE_PATTERN = /^erp-(.+)-(\d{8})-(\d{6})\.dump$/;

/** Local-time components, matching what the operator sees in Explorer. */
function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function buildArchiveName(database: string, at: Date): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  // Keep the database segment filename-safe; everything else is generated.
  const safeDatabase = database.replace(/[^A-Za-z0-9_-]/g, '_');
  return `erp-${safeDatabase}-${date}-${time}.dump`;
}

export function isArchiveName(fileName: string): boolean {
  return ARCHIVE_PATTERN.test(fileName);
}

/** Returns the encoded local timestamp, or null when the name is not ours. */
export function parseArchiveDate(fileName: string): Date | null {
  const match = ARCHIVE_PATTERN.exec(fileName);
  if (!match) return null;

  const [, , date, time] = match;
  const parsed = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
