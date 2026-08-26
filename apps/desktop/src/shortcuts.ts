import path from 'node:path';
import type { Workspace } from './urls';

export interface ShortcutSpec {
  /** Display name of the shortcut file, without the `.lnk` extension. */
  name: string;
  /** The installed executable this shortcut launches. */
  targetPath: string;
  /** e.g. `--workspace=gestion` — matches `startup-args.ts`'s parser exactly. */
  args: string;
  workspace: Workspace;
}

/**
 * Builds the shortcut specs for both workspaces — pure, platform-agnostic,
 * fully unit-testable without touching the filesystem or `shell`. Only
 * the actual file-write (`createWorkspaceShortcuts` below) is Windows-only
 * and Electron-dependent.
 */
export function buildShortcutSpecs(exePath: string): ShortcutSpec[] {
  return [
    { name: 'ERP Gestión', targetPath: exePath, args: '--workspace=gestion', workspace: 'gestion' },
    {
      name: 'ERP Facturación',
      targetPath: exePath,
      args: '--workspace=facturacion',
      workspace: 'facturacion',
    },
  ];
}

export interface ShortcutWriteResult {
  ok: boolean;
  created: string[];
  error?: string;
}

/** Matches (a subset of) Electron's own `Shell.writeShortcutLink` 2-arg overload — kept narrow and local so this module never needs to import the `electron` types directly. */
export interface ShortcutLinkOptions {
  target: string;
  args?: string;
  description?: string;
}

/**
 * Writes both workspace shortcuts to the current user's Desktop —
 * Windows only (Prompt #20 §28). Uses Electron's own
 * `shell.writeShortcutLink`, no third-party shortcut library. Never
 * invoked automatically — only ever from an explicit user action in the
 * launcher (see `main.ts`'s `create-workspace-shortcuts` IPC handler),
 * and the caller is responsible for hiding the action entirely on any
 * non-Windows platform (`process.platform !== 'win32'`).
 */
export async function createWorkspaceShortcuts(
  shell: { writeShortcutLink: (shortcutPath: string, options: ShortcutLinkOptions) => boolean },
  desktopDir: string,
  exePath: string,
): Promise<ShortcutWriteResult> {
  const created: string[] = [];
  for (const spec of buildShortcutSpecs(exePath)) {
    const shortcutPath = path.join(desktopDir, `${spec.name}.lnk`);
    const ok = shell.writeShortcutLink(shortcutPath, {
      target: spec.targetPath,
      args: spec.args,
      description: `Abrir ${spec.name}`,
    });
    if (!ok) {
      return { ok: false, created, error: `No se pudo crear el acceso directo "${spec.name}".` };
    }
    created.push(shortcutPath);
  }
  return { ok: true, created };
}
