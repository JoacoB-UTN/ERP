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
