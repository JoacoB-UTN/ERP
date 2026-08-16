import type { HealthResponse } from '@erp/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/**
 * Fetches API health. Never throws — a network failure is itself a
 * meaningful "the API is unreachable" status for the shell page to render,
 * not an error to crash the page on.
 */
export async function fetchHealth(): Promise<HealthResponse> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) {
      throw new Error(`Unexpected status ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  } catch {
    return { status: 'error', services: { database: 'error', redis: 'error' } };
  }
}
