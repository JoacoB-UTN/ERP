import type { Workspace } from './urls';

export interface StartupArgs {
  workspace?: Workspace;
}

const WORKSPACE_ARG = /^--workspace=(.*)$/;

/**
 * Parses `--workspace=gestion`/`--workspace=facturacion` from `argv` — the
 * mechanism behind Windows shortcuts like "ERP Gestión" /
 * "ERP Facturación" launching the same installed executable straight into
 * one workspace (Prompt #20 §2/§26). An unrecognized value is a safe
 * no-op — it NEVER becomes an arbitrary URL/workspace; the caller just
 * falls back to the normal launcher.
 */
export function parseStartupArgs(argv: string[]): StartupArgs {
  for (const arg of argv) {
    const match = WORKSPACE_ARG.exec(arg);
    if (!match) continue;
    const value = match[1];
    if (value === 'gestion' || value === 'facturacion') {
      return { workspace: value };
    }
    return {};
  }
  return {};
}
