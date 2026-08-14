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
