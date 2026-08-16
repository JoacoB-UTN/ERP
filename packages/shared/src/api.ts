/** Standard API error envelope returned by apps/api on failure. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** Shape of GET /api/v1/health. */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

/** Standard page/pageSize pagination envelope — see docs/audit-architecture.md for the first consumer (GET /administration/audit). */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
}
