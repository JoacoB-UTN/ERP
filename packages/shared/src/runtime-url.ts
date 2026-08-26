/**
 * Runtime host resolution for the two Next.js frontends (Gestión,
 * Facturación) — see docs/desktop-lan-architecture.md's "Runtime LAN
 * addressing". The historical `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_GESTION_URL`/
 * `NEXT_PUBLIC_FACTURACION_URL` env vars are baked into the built JS bundle
 * at build time — fine for local dev, but wrong for the ERP Server/thin
 * Electron client target: the exact same built bundle must work whether
 * it's reached via `localhost`, `127.0.0.1`, or a real LAN IP, with zero
 * rebuild between them. The functions below derive each sibling service's
 * URL from wherever the CURRENT page was actually loaded from instead.
 */

/** The three server-hosted services' well-known dev/deployment ports — see docs/desktop-lan-architecture.md's "Deployment example". A real deployment could reassign these; nothing here hardcodes a HOST. */
export const DEFAULT_RUNTIME_PORTS = {
  gestion: 3000,
  api: 3001,
  facturacion: 3002,
} as const;

export interface CurrentOrigin {
  /** e.g. "http:" or "https:" — matches `window.location.protocol`, including the trailing colon. */
  protocol: string;
  /** Host only, never a port — matches `window.location.hostname`. */
  hostname: string;
}

/**
 * Resolves one sibling service's URL at runtime.
 *
 * Precedence (documented once here — every call site relies on this exact
 * order, see docs/desktop-lan-architecture.md):
 * 1. `explicitOverride`, when non-empty — a deliberate dev/test escape
 *    hatch (e.g. `NEXT_PUBLIC_API_URL` set to point at a non-standard
 *    port). Leave the env var unset to get automatic host-derived
 *    resolution — this is the default for both local dev and a real ERP
 *    Server/Electron deployment.
 * 2. `currentOrigin` (the current page's own protocol + hostname) + the
 *    given `port` — the LAN-safe default. `currentOrigin` is `null`
 *    outside a browser (SSR/build time), where no request is made from
 *    this value anyway.
 * 3. `http://localhost:{port}` — only ever reachable server-side, before
 *    any request could be issued from that context.
 */
export function resolveServiceUrl(options: {
  explicitOverride?: string;
  port: number;
  path?: string;
  currentOrigin?: CurrentOrigin | null;
}): string {
  const { explicitOverride, port, path = '', currentOrigin } = options;
  if (explicitOverride) return explicitOverride;
  const origin = currentOrigin
    ? `${currentOrigin.protocol}//${currentOrigin.hostname}:${port}`
    : `http://localhost:${port}`;
  return `${origin}${path}`;
}

/**
 * Reads the current browser page's protocol+hostname, or `null` outside a
 * browser (SSR/build). Reads `window` through `globalThis` (rather than a
 * bare `window` reference) so this package — also consumed by `apps/api`
 * — never needs the DOM lib in its own compilation.
 */
export function getBrowserOrigin(): CurrentOrigin | null {
  const win = (globalThis as { window?: { location?: { protocol: string; hostname: string } } })
    .window;
  if (!win?.location) return null;
  return { protocol: win.location.protocol, hostname: win.location.hostname };
}
