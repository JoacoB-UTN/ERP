import { DEFAULT_RUNTIME_PORTS, getBrowserOrigin, resolveServiceUrl, type HealthResponse } from '@erp/shared';

/**
 * Resolved at runtime from the current page's own host — see
 * docs/desktop-lan-architecture.md's "Runtime LAN addressing". Loading
 * Gestión from `192.168.1.50:3000` resolves this to `192.168.1.50:3001`
 * with zero rebuild; set `NEXT_PUBLIC_API_URL` to override explicitly
 * (dev/test only).
 */
export const API_URL = resolveServiceUrl({
  explicitOverride: process.env.NEXT_PUBLIC_API_URL,
  port: DEFAULT_RUNTIME_PORTS.api,
  path: '/api/v1',
  currentOrigin: getBrowserOrigin(),
});

/** Facturación's own origin — used only by the workspace switcher (see docs/desktop-ui-direction.md). Same runtime-host resolution as API_URL above. */
export const FACTURACION_URL = resolveServiceUrl({
  explicitOverride: process.env.NEXT_PUBLIC_FACTURACION_URL,
  port: DEFAULT_RUNTIME_PORTS.facturacion,
  currentOrigin: getBrowserOrigin(),
});

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
