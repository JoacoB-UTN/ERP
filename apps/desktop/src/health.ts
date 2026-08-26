import type { DesktopConfig } from './config';
import { apiHealthUrl, facturacionUrl, gestionUrl } from './urls';

export type ServiceStatus = 'ok' | 'degraded' | 'error' | 'unreachable';

export interface ServiceCheckResult {
  status: ServiceStatus;
  /** Short, non-sensitive detail for display — never a stack trace or raw error object. */
  detail?: string;
}

/**
 * `'connected'`/`'degraded'`/`'unreachable'` only — this is the result of
 * an already-settled check. The fourth conceptual state from Prompt #20
 * §20, `'checking'`, is a transient UI-only phase the launcher renderer
 * holds *before* it has a result at all; `testConnection()` below always
 * returns one of these three once it resolves.
 */
export type OverallStatus = 'connected' | 'degraded' | 'unreachable';

/**
 * `corsAdvisory` is best-effort and informational ONLY — see Prompt #20
 * §35: an Electron main-process fetch is not subject to browser CORS, so
 * "the API responded" here never proves "Gestión's own browser-context
 * requests will succeed." This checks whether the API's CORS layer
 * reflects BOTH configured workspace origins (Gestión and Facturación)
 * in `Access-Control-Allow-Origin` — a real signal, but not a full
 * credentialed-request simulation (no preflight, no browser enforcement
 * involved).
 *
 * `'ok'` requires an EXACT reflected origin for both workspaces. The ERP
 * uses credentialed requests (cookies, `credentials: 'include'`) —
 * `Access-Control-Allow-Origin: *` is invalid for credentialed requests
 * (browsers reject it outright) and must never count as a pass here,
 * even though a plain non-credentialed request would accept it.
 *
 * `'unknown'` means the check itself couldn't run (e.g. the API was
 * unreachable) — never presented as a pass.
 */
export type CorsAdvisory = 'ok' | 'missing' | 'unknown';

export interface ConnectionResult {
  overall: OverallStatus;
  api: ServiceCheckResult;
  gestion: ServiceCheckResult;
  facturacion: ServiceCheckResult;
  corsAdvisory: CorsAdvisory;
  checkedAt: string;
}

const DEFAULT_TIMEOUT_MS = 4000;

interface ApiHealthBody {
  status?: unknown;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function describeNetworkError(err: unknown): string {
  return err instanceof Error ? err.message : 'Error de red desconocido.';
}

/**
 * Checks the API's own `/health` — parses the JSON body's `status`
 * (`ok`/`degraded`/`error`), not just the HTTP status code: the API
 * intentionally returns HTTP 200 for both `ok` and `degraded` (Redis
 * down is not fatal), and only 503 when Postgres itself is unreachable
 * — see apps/api/src/health/health.controller.ts.
 */
async function checkApiHealth(config: DesktopConfig, timeoutMs: number): Promise<ServiceCheckResult> {
  try {
    const res = await fetchWithTimeout(apiHealthUrl(config), {}, timeoutMs);

    let body: ApiHealthBody | undefined;
    try {
      body = (await res.json()) as ApiHealthBody;
    } catch {
      body = undefined;
    }

    if (body?.status === 'ok') return { status: 'ok' };
    if (body?.status === 'degraded') return { status: 'degraded', detail: 'Redis no disponible.' };
    if (body?.status === 'error') return { status: 'error', detail: 'Base de datos no disponible.' };
    return { status: 'error', detail: `Respuesta inesperada (HTTP ${res.status}).` };
  } catch (err) {
    return { status: 'unreachable', detail: describeNetworkError(err) };
  }
}

/**
 * One origin's reflection outcome — `'unknown'` means the request itself
 * failed (network error), never presented as either a pass or a fail.
 */
type OriginReflection = boolean | 'unknown';

/**
 * Sends the API a request with the given `Origin` header and checks
 * whether `Access-Control-Allow-Origin` reflects it EXACTLY. A wildcard
 * (`*`) or any other value is `false` — see `CorsAdvisory`'s doc comment
 * for why a wildcard must never count as a pass for this credentialed
 * application.
 */
async function checkOriginReflected(
  url: string,
  origin: string,
  timeoutMs: number,
): Promise<OriginReflection> {
  try {
    const res = await fetchWithTimeout(url, { headers: { Origin: origin } }, timeoutMs);
    return res.headers.get('access-control-allow-origin') === origin;
  } catch {
    return 'unknown';
  }
}

/** `'ok'` only when BOTH workspace origins were exactly reflected; `'unknown'` if either check couldn't run at all. */
function computeCorsAdvisory(gestion: OriginReflection, facturacion: OriginReflection): CorsAdvisory {
  if (gestion === 'unknown' || facturacion === 'unknown') return 'unknown';
  return gestion && facturacion ? 'ok' : 'missing';
}

/**
 * Checks that a Next.js workspace process answers at all — any HTTP
 * response (even a redirect to `/login`, even a 404) proves the process
 * is up; only a network-level failure counts as unreachable. This
 * deliberately does not care about auth state — an unauthenticated
 * redirect is not "the workspace is unavailable."
 */
async function checkFrontend(url: string, timeoutMs: number): Promise<ServiceCheckResult> {
  try {
    const res = await fetchWithTimeout(url, { redirect: 'follow' }, timeoutMs);
    return res.ok || (res.status >= 300 && res.status < 500)
      ? { status: 'ok' }
      : { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err) {
    return { status: 'unreachable', detail: describeNetworkError(err) };
  }
}

function computeOverall(
  api: ServiceCheckResult,
  gestion: ServiceCheckResult,
  facturacion: ServiceCheckResult,
): OverallStatus {
  if (api.status === 'unreachable') return 'unreachable';
  if (api.status === 'ok' && gestion.status === 'ok' && facturacion.status === 'ok') {
    return 'connected';
  }
  return 'degraded';
}

/** Runs the full connection diagnostic — see `ConnectionResult`/`CorsAdvisory` above for exactly what each field does and does not prove. */
export async function testConnection(
  config: DesktopConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ConnectionResult> {
  const healthUrl = apiHealthUrl(config);
  const gestionOrigin = new URL(gestionUrl(config)).origin;
  const facturacionOrigin = new URL(facturacionUrl(config)).origin;

  const [api, gestion, facturacion, gestionReflected, facturacionReflected] = await Promise.all([
    checkApiHealth(config, timeoutMs),
    checkFrontend(gestionUrl(config), timeoutMs),
    checkFrontend(facturacionUrl(config), timeoutMs),
    checkOriginReflected(healthUrl, gestionOrigin, timeoutMs),
    checkOriginReflected(healthUrl, facturacionOrigin, timeoutMs),
  ]);

  return {
    overall: computeOverall(api, gestion, facturacion),
    api,
    gestion,
    facturacion,
    corsAdvisory: computeCorsAdvisory(gestionReflected, facturacionReflected),
    checkedAt: new Date().toISOString(),
  };
}
