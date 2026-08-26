import type { DesktopConfig } from './config';

export type Workspace = 'gestion' | 'facturacion';

function originFor(config: DesktopConfig, port: number): string {
  return `${config.scheme}://${config.host}:${port}`;
}

/** Gestión's origin for the currently configured server — never string-concatenated ad hoc elsewhere. */
export function gestionUrl(config: DesktopConfig): string {
  return originFor(config, config.ports.gestion);
}

/** The API's origin (no `/api/v1` suffix — callers that need the REST base append it themselves). */
export function apiUrl(config: DesktopConfig): string {
  return originFor(config, config.ports.api);
}

/** The API's health endpoint — the one URL `health.ts`'s connection test actually calls. */
export function apiHealthUrl(config: DesktopConfig): string {
  return `${apiUrl(config)}/api/v1/health`;
}

/** Facturación's origin for the currently configured server. */
export function facturacionUrl(config: DesktopConfig): string {
  return originFor(config, config.ports.facturacion);
}

/** Resolves one workspace's origin by name — the single place `main.ts`/`health.ts` go from a `Workspace` to a URL. */
export function workspaceUrl(config: DesktopConfig, workspace: Workspace): string {
  return workspace === 'gestion' ? gestionUrl(config) : facturacionUrl(config);
}

/**
 * The set of top-level origins a workspace `BrowserWindow` may ever
 * navigate to for the given config — see `navigation-policy.ts`, the
 * consumer of this list.
 */
export function allowedWorkspaceOrigins(config: DesktopConfig): string[] {
  return [new URL(gestionUrl(config)).origin, new URL(facturacionUrl(config)).origin];
}
