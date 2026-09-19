/** Standard API error envelope returned by apps/api on failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * What the Current Accounts historical backfill has established — see
 * docs/current-accounts.md. Reported so an operator can tell "nobody owes
 * anything" from "the history has not been loaded yet", which look
 * identical on a balance screen.
 *
 * It is a state word and nothing else: no counts, no company names, no
 * amounts. The health endpoint is unauthenticated.
 */
export type CurrentAccountsBackfillState =
  | 'pending'
  | 'running'
  | 'complete'
  | 'failed'
  | 'disabled';

/** Shape of GET /api/v1/health. */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  services: {
    database: 'ok' | 'error';
    /**
     * `disabled` means no REDIS_URL was configured, which is a supported
     * deployment and does NOT degrade the server. `error` means a Redis was
     * configured and cannot be reached.
     */
    redis: 'ok' | 'error' | 'disabled';
  };
  currentAccountsBackfill: CurrentAccountsBackfillState;
}

/** Standard page/pageSize pagination envelope — see docs/audit-architecture.md for the first consumer (GET /administration/audit). */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Free and total bytes of a filesystem the server depends on. */
export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
}

/**
 * Deep diagnostics for the machine the ERP Server runs on.
 *
 * Deliberately NOT part of `HealthResponse`: `GET /health` is unauthenticated
 * — the desktop client polls it before anyone logs in — so a version string,
 * a disk size or an uptime there would be readable by anyone who can reach
 * the port. This lives behind `system.backups.read` instead.
 *
 * Every field answers a question a real failure on the Windows VM raised;
 * see docs/server-installer.md. `null` means "could not be measured", which
 * is a different answer from zero and is rendered as such.
 */
export interface SystemDiagnosticsResponse {
  server: {
    /** Version of the installed build. */
    version: string;
    /** When this API process started. */
    startedAt: string;
    uptimeSeconds: number;
    nodeVersion: string;
  };
  database: {
    /**
     * When the PostgreSQL server itself started.
     *
     * The field that earns its place: compared against the API's own start
     * time, a postmaster far older than every service around it is the
     * signature of defect 12 — WinSW's log rotation killed the wrapper and
     * left PostgreSQL running unsupervised, so Windows reported the service
     * stopped while the database kept answering.
     */
    startedAt: string | null;
    uptimeSeconds: number | null;
    /** Round-trip of a trivial query. Tells "slow" apart from "down". */
    latencyMs: number | null;
    sizeBytes: number | null;
  };
  disk: {
    /**
     * The filesystem holding the backup directory. Null when it cannot be
     * read. Only sizes are reported, never the path: the response crosses
     * to a browser and a directory layout is not the operator's business
     * data.
     *
     * When PostgreSQL runs on another machine this says nothing about the
     * disk under the database — a documented limit, not an oversight.
     */
    backups: DiskUsage | null;
  };
}
