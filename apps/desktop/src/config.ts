import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * The three server-hosted services' well-known ports — mirrors
 * `packages/shared/src/runtime-url.ts`'s `DEFAULT_RUNTIME_PORTS`. Not
 * imported directly: `apps/desktop` deliberately has no dependency on the
 * Next.js frontend packages, and this tiny constant is not worth a
 * cross-workspace import for three numbers — see
 * docs/desktop-lan-architecture.md's "Desktop architecture".
 */
export const DEFAULT_PORTS = {
  gestion: 3000,
  api: 3001,
  facturacion: 3002,
} as const;

export const CONFIG_VERSION = 1 as const;

export interface DesktopConfig {
  version: typeof CONFIG_VERSION;
  scheme: 'http' | 'https';
  /** Hostname only — never a port, path, query, or fragment. See `normalizeServerInput`. */
  host: string;
  ports: {
    gestion: number;
    api: number;
    facturacion: number;
  };
}

export type NormalizeResult =
  | { ok: true; scheme: 'http' | 'https'; host: string }
  | { ok: false; error: string };

const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Validates and normalizes untrusted server-address input from the
 * launcher's "Servidor" field — see docs/desktop-lan-architecture.md's
 * "Server configuration" and the acceptance examples in Prompt #20 §49.
 * Accepts a bare host ("192.168.1.50", "erp-server.local"), or one with
 * an explicit http/https scheme. Rejects anything else outright — a
 * credential, query string, fragment, path, port, or non-http(s) scheme
 * (`javascript:`, `file:`, `data:`, ...) — rather than silently
 * reinterpreting it into something plausible.
 */
export function normalizeServerInput(rawInput: string): NormalizeResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { ok: false, error: 'Ingresá una dirección de servidor.' };
  }

  const schemeMatch = SCHEME_PREFIX.exec(trimmed);
  let candidate: string;
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') {
      return { ok: false, error: `Esquema no permitido: "${scheme}:". Usá http o https.` };
    }
    candidate = trimmed;
  } else {
    // A bare host ("192.168.1.50", "erp-server.local") — the common case.
    candidate = `http://${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: 'Dirección de servidor inválida.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `Esquema no permitido: "${url.protocol}". Usá http o https.` };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'No incluyas usuario/contraseña en la dirección del servidor.' };
  }
  if (url.port) {
    return {
      ok: false,
      error: 'No incluyas un puerto en la dirección — los puertos del servidor son fijos.',
    };
  }
  if (url.search) {
    return { ok: false, error: 'No incluyas parámetros (?) en la dirección del servidor.' };
  }
  if (url.hash) {
    return { ok: false, error: 'No incluyas un fragmento (#) en la dirección del servidor.' };
  }
  if (url.pathname && url.pathname !== '/') {
    return { ok: false, error: 'No incluyas una ruta en la dirección — solo el host.' };
  }
  if (!url.hostname) {
    return { ok: false, error: 'Dirección de servidor inválida.' };
  }

  return { ok: true, scheme: url.protocol === 'https:' ? 'https' : 'http', host: url.hostname };
}

/** Builds a full config from validated input — pass `normalizeServerInput`'s successful result. */
export function buildConfig(
  normalized: { scheme: 'http' | 'https'; host: string },
  ports: DesktopConfig['ports'] = { ...DEFAULT_PORTS },
): DesktopConfig {
  return {
    version: CONFIG_VERSION,
    scheme: normalized.scheme,
    host: normalized.host,
    ports: { ...ports },
  };
}

/** Type-guards an arbitrary parsed JSON value into a `DesktopConfig`, without trusting the file's shape. */
export function isValidStoredConfig(value: unknown): value is DesktopConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== CONFIG_VERSION) return false;
  if (v.scheme !== 'http' && v.scheme !== 'https') return false;
  if (typeof v.host !== 'string' || !v.host) return false;
  if (typeof v.ports !== 'object' || v.ports === null) return false;
  const ports = v.ports as Record<string, unknown>;
  return (
    typeof ports.gestion === 'number' &&
    typeof ports.api === 'number' &&
    typeof ports.facturacion === 'number'
  );
}

export function configFileName(): string {
  return 'server-config.json';
}

/**
 * Loads the persisted server config from disk. Never throws — a missing,
 * unreadable, or malformed file is treated as "no server configured yet"
 * (returns `null`), matching the first-run experience (Prompt #20 §22) —
 * a corrupt config must never crash the launcher.
 */
export async function loadConfig(userDataDir: string): Promise<DesktopConfig | null> {
  const filePath = path.join(userDataDir, configFileName());
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isValidStoredConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persists the server config atomically: write to a uniquely-named temp
 * file in the same directory, then rename over the real path.
 * `fs.rename` is atomic on the same filesystem, so a crash or power loss
 * mid-write never leaves a half-written config file — the reader always
 * sees either the old complete file or the new complete file, never a
 * partial one.
 */
export async function saveConfig(userDataDir: string, config: DesktopConfig): Promise<void> {
  await fs.mkdir(userDataDir, { recursive: true });
  const filePath = path.join(userDataDir, configFileName());
  const tmpPath = path.join(userDataDir, `.${configFileName()}.${randomUUID()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}
