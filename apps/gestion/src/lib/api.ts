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
 * The outcome of one health check, which is strictly more than the server's
 * own answer: it also records whether there *was* an answer.
 *
 * Frontend-internal on purpose. `HealthResponse` is the shared API contract
 * and is not touched — this only wraps it, so the backend keeps returning
 * exactly what it returned before.
 *
 * The distinction matters because the two failures need opposite words. If
 * the API answers `database: 'error'`, PostgreSQL really is down and the ERP
 * cannot operate. If the request never arrives, we know nothing at all about
 * PostgreSQL or Redis — and saying "both are down" would be an invention.
 * Previously both collapsed into the same synthetic `HealthResponse` with
 * every service marked `error`, which is what made the second case
 * indistinguishable from the first.
 */
export type HealthProbe =
  | { reachable: true; response: HealthResponse }
  | { reachable: false; response: null };

/**
 * Fetches API health. Never throws — a network failure is itself a
 * meaningful "the API is unreachable" status for the shell page to render,
 * not an error to crash the page on.
 *
 * A 503 is a real answer and is kept: that is how the API reports its own
 * degraded/error state. Any other non-OK status is treated as unreachable,
 * because a proxy's 502 page is not the API talking.
 */
export async function fetchHealth(): Promise<HealthProbe> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) {
      throw new Error(`Unexpected status ${res.status}`);
    }
    return { reachable: true, response: (await res.json()) as HealthResponse };
  } catch {
    return { reachable: false, response: null };
  }
}
