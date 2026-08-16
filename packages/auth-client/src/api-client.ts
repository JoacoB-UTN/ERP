import { COMPANY_ID_HEADER, BRANCH_ID_HEADER } from '@erp/shared';
import { createCompanyContextStore } from './company-context-store';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  /** e.g. "http://localhost:3001/api/v1" */
  baseUrl: string;
  /** Called once when a request fails auth AND a refresh attempt also fails — the app should redirect to its login screen. */
  onUnauthenticated?: () => void;
  /**
   * Namespaces the active company/branch selection in localStorage so
   * Gestión and Facturación never collide (see CLAUDE.md — they may hold
   * different active companies at the same time). Defaults to "default",
   * which is fine for a single-app/test context but every real app should
   * pass its own (e.g. "gestion", "facturacion").
   */
  storageKeyPrefix?: string;
}

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  json?: unknown;
}

const NO_REFRESH_PATHS = new Set(['/auth/login', '/auth/refresh']);

/** Company/branch context errors the client should react to by clearing local selection — see CLAUDE.md. */
const COMPANY_CONTEXT_INVALIDATING_CODES = new Set(['COMPANY_ACCESS_DENIED', 'COMPANY_INACTIVE']);

/**
 * A small fetch wrapper shared by every frontend app (Gestión, Facturación).
 * Handles the cookie-based session lifecycle described in CLAUDE.md:
 * a 401 triggers exactly one refresh attempt (de-duplicated across
 * concurrent callers) and retry; a failed refresh clears local state and
 * lets the caller redirect to login. No request is retried more than once,
 * so there is no possibility of a refresh/retry loop.
 *
 * Also automatically attaches X-Company-Id/X-Branch-Id (from the returned
 * `companyContextStore`) to every request when set, and — if a company
 * context request comes back COMPANY_ACCESS_DENIED/COMPANY_INACTIVE (e.g.
 * an admin revoked access mid-session) — clears the now-invalid selection
 * so the app naturally falls back to re-selecting instead of retrying a
 * request that will only ever fail the same way.
 */
export function createApiClient(config: ApiClientConfig) {
  let inFlightRefresh: Promise<boolean> | null = null;
  const companyContextStore = createCompanyContextStore(config.storageKeyPrefix ?? 'default');

  async function rawFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const companyId = companyContextStore.getActiveCompanyId();
    if (companyId) {
      headers[COMPANY_ID_HEADER] = companyId;
    }
    const branchId = companyContextStore.getActiveBranchId();
    if (branchId) {
      headers[BRANCH_ID_HEADER] = branchId;
    }

    return fetch(`${config.baseUrl}${path}`, {
      method: options.method ?? (options.json !== undefined ? 'POST' : 'GET'),
      credentials: 'include',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
    });
  }

  function refreshOnce(): Promise<boolean> {
    if (!inFlightRefresh) {
      inFlightRefresh = rawFetch('/auth/refresh', { method: 'POST' })
        .then((res) => res.ok)
        .catch(() => false)
        .finally(() => {
          inFlightRefresh = null;
        });
    }
    return inFlightRefresh;
  }

  async function parseErrorBody(
    res: Response,
  ): Promise<{ message: string; details?: unknown; code?: string }> {
    try {
      const body = (await res.json()) as {
        error?: { message?: string; details?: unknown; code?: string };
      };
      return {
        message: body.error?.message ?? `Request failed (${res.status})`,
        details: body.error?.details,
        code: body.error?.code,
      };
    } catch {
      return { message: `Request failed (${res.status})` };
    }
  }

  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}, isRetry = false): Promise<T> {
    const res = await rawFetch(path, options);

    if (res.status === 401 && !isRetry && !NO_REFRESH_PATHS.has(path)) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        return apiFetch<T>(path, options, true);
      }
      config.onUnauthenticated?.();
      throw new ApiError(401, 'Not authenticated.');
    }

    if (!res.ok) {
      const { message, details, code } = await parseErrorBody(res);
      if (code && COMPANY_CONTEXT_INVALIDATING_CODES.has(code)) {
        companyContextStore.setActiveCompanyId(null);
      }
      throw new ApiError(res.status, message, details, code);
    }

    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  return { apiFetch, companyContextStore };
}
