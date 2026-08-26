import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './ipc-channels';
import type { DesktopConfig } from './config';
import type { ConnectionResult } from './health';
import type { Workspace } from './urls';
import type { ShortcutWriteResult } from './shortcuts';

/**
 * The LAUNCHER window's only privileged surface — see
 * docs/desktop-lan-architecture.md's "Security model". Every method maps
 * to exactly one fixed IPC channel with a validated payload; there is no
 * generic `invoke(channel, payload)` escape hatch, no `fs`, no
 * `child_process`, no `shell.openExternal`, no arbitrary URL loading.
 * This bridge is NEVER attached to a workspace `BrowserWindow` that loads
 * remote server content — see `main.ts`'s `createWorkspaceWindow`, which
 * passes no `preload` at all.
 */
const api = {
  getDesktopConfig: (): Promise<DesktopConfig | null> => ipcRenderer.invoke(IPC.GET_DESKTOP_CONFIG),

  getAppInfo: (): Promise<{ version: string; platform: NodeJS.Platform }> =>
    ipcRenderer.invoke(IPC.GET_APP_INFO),

  /** Validates+normalizes the raw text input, then (only if valid) runs a live connection test — never saves anything. */
  testServer: (
    rawInput: string,
  ): Promise<
    | { ok: true; config: DesktopConfig; connection: ConnectionResult }
    | { ok: false; error: string }
  > => ipcRenderer.invoke(IPC.TEST_SERVER, rawInput),

  saveServer: (config: DesktopConfig): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.SAVE_SERVER, config),

  openWorkspace: (workspace: Workspace): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.OPEN_WORKSPACE, workspace),

  createWorkspaceShortcuts: (): Promise<ShortcutWriteResult> =>
    ipcRenderer.invoke(IPC.CREATE_WORKSPACE_SHORTCUTS),

  /** Fixed-shape, one-directional notification when a workspace window fails to load — see `main.ts`. */
  onWorkspaceLoadFailed: (
    callback: (payload: { workspace: Workspace; host: string }) => void,
  ): void => {
    ipcRenderer.on(IPC.WORKSPACE_LOAD_FAILED, (_event, payload) => callback(payload));
  },

  /** Fired when the user picks "Configurar servidor" from the native app menu. */
  onShowConfigScreen: (callback: () => void): void => {
    ipcRenderer.on(IPC.SHOW_CONFIG_SCREEN, () => callback());
  },
};

export type LauncherApi = typeof api;

contextBridge.exposeInMainWorld('erp', api);
