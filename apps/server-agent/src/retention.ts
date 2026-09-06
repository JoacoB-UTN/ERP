import { parseArchiveDate } from './naming';

/**
 * Retention policy.
 *
 * Two rules, and the second one overrides the first:
 *   1. Delete archives older than `retentionDays`.
 *   2. Never let the folder drop below `keepMinimum` archives.
 *
 * Rule 2 exists because rule 1 alone has a catastrophic failure mode: if the
 * agent (or the server) was offline for longer than the retention window, every
 * surviving archive is "expired" and a naive sweep would delete the business's
 * only copies of its data — precisely at the moment something was already
 * wrong. Retention is an economy measure; it must never be the thing that
 * destroys the last backup.
 */

export interface RetentionDecision {
  keep: string[];
  deleteExpired: string[];
}

export function planRetention(
  fileNames: string[],
  retentionDays: number,
  keepMinimum: number,
  now: Date,
): RetentionDecision {
  const dated = fileNames
    .map((fileName) => ({ fileName, at: parseArchiveDate(fileName) }))
    .filter((entry): entry is { fileName: string; at: Date } => entry.at !== null)
    // Newest first.
    .sort((a, b) => b.at.getTime() - a.at.getTime());

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  const keep: string[] = [];
  const deleteExpired: string[] = [];

  for (const [index, entry] of dated.entries()) {
    const withinMinimum = index < keepMinimum;
    const expired = entry.at.getTime() < cutoff;

    if (withinMinimum || !expired) {
      keep.push(entry.fileName);
    } else {
      deleteExpired.push(entry.fileName);
    }
  }

  return { keep, deleteExpired };
}
