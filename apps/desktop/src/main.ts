import path from 'node:path';
import { app, BrowserWindow, Menu, ipcMain, session, shell as electronShell } from 'electron';
import { IPC } from './ipc-channels';
import {
  buildConfig,
  isValidStoredConfig,
  loadConfig,
  normalizeServerInput,
  saveConfig,
  type DesktopConfig,
} from './config';
import { testConnection } from './health';
import { parseStartupArgs } from './startup-args';
import { isAllowedNavigationTarget } from './navigation-policy';
import { workspaceUrl, type Workspace } from './urls';
import { createWorkspaceShortcuts } from './shortcuts';
import { buildAppMenuTemplate } from './menu';
import { logger } from './logger';

function isDev(): boolean {
  return !app.isPackaged;
}

let launcherWindow: BrowserWindow | null = null;
const workspaceWindows = new Map<Workspace, BrowserWindow>();
let cachedConfig: DesktopConfig | null = null;
let pendingWorkspaceFailure: { workspace: Workspace; host: string } | null = null;

async function getConfig(): Promise<DesktopConfig | null> {
  if (cachedConfig) return cachedConfig;
  cachedConfig = await loadConfig(app.getPath('userData'));
  return cachedConfig;
}

/**
 * SECURITY CRITICAL — see docs/desktop-lan-architecture.md's "Security
 * model". No current feature needs camera/microphone/geolocation/
 * notifications/clipboard access, so every permission request is denied
 * outright, application-wide. This does NOT affect ordinary keyboard
 * input, barcode-scanner-as-keyboard input, form input, or printing
 * (`webContents.print()`) — none of those go through the permission API.
 */
function applySecurityPolicies(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function workspaceLabel(workspace: Workspace): string {
  return workspace === 'gestion' ? 'Gestión' : 'Facturación';
}

function flushPendingWorkspaceFailure(win: BrowserWindow): void {
  if (!pendingWorkspaceFailure) return;
  const payload = pendingWorkspaceFailure;
  const send = () => {
    win.webContents.send(IPC.WORKSPACE_LOAD_FAILED, payload);
    pendingWorkspaceFailure = null;
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function notifyWorkspaceLoadFailed(workspace: Workspace, host: string): void {
  pendingWorkspaceFailure = { workspace, host };
  const win = createLauncherWindow();
  win.show();
  win.focus();
  flushPendingWorkspaceFailure(win);
}

/**
 * A) LAUNCHER WINDOW — loads only local packaged content (`launcher.html`,
 * a strict CSP, see that file). May have the minimal preload bridge in
 * `preload.ts`. Never loads remote content. See "Two window types" in
 * docs/desktop-lan-architecture.md.
 */
function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    return launcherWindow;
  }

  const win = new BrowserWindow({
    width: 480,
    height: 620,
    minWidth: 420,
    minHeight: 520,
    title: 'ERP',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev(),
    },
  });

  // Defense in depth: the launcher itself never needs to navigate anywhere
  // or open a new window, even though its content is fully local/trusted.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'launcher.html'));
  if (isDev()) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => {
    if (launcherWindow === win) launcherWindow = null;
  });

  launcherWindow = win;
  return win;
}

/**
 * B) WORKSPACE WINDOW — loads remote, untrusted ERP-Server content. NO
 * preload, so no privileged surface is ever exposed to that content — a
 * compromised or misconfigured remote server can never gain filesystem
 * or Electron IPC access through this window. Navigation is restricted
 * to the configured server's own Gestión/Facturación origins
 * (`navigation-policy.ts`); popups are denied outright.
 */
function createWorkspaceWindow(config: DesktopConfig, workspace: Workspace): BrowserWindow {
  const existing = workspaceWindows.get(workspace);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: `ERP — ${workspaceLabel(workspace)}`,
    webPreferences: {
      // No `preload` — see the doc comment above. This is the mandatory
      // separation between the two window types.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      devTools: isDev(),
    },
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigationTarget(config, url)) {
      event.preventDefault();
      logger.warn('navigation_blocked', { workspace, url });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    logger.warn('window_open_blocked', { workspace, url });
    return { action: 'deny' };
  });

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED — fires on ordinary cancelled/superseded
      // navigations, not a real failure (Prompt #20 §37/§38: don't treat
      // routine navigation as a load failure).
      if (!isMainFrame || errorCode === -3) return;
      logger.warn('workspace_load_failed', {
        workspace,
        host: config.host,
        errorCode,
        errorDescription,
      });
      win.close();
      notifyWorkspaceLoadFailed(workspace, config.host);
    },
  );

  void win.loadURL(workspaceUrl(config, workspace));
  if (isDev()) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => {
    if (workspaceWindows.get(workspace) === win) workspaceWindows.delete(workspace);
  });

  workspaceWindows.set(workspace, win);
  return win;
}

/**
 * Shared by the IPC handler, direct `--workspace=` startup, and the
 * native menu — re-validates reachability immediately before opening,
 * so a workspace window is never shown blank against a server that just
 * went down (Prompt #20 §25/§56).
 */
async function openWorkspace(workspace: Workspace): Promise<{ ok: boolean; error?: string }> {
  const config = await getConfig();
  if (!config) {
    createLauncherWindow().show();
    return { ok: false, error: 'No hay un servidor configurado.' };
  }
  const connection = await testConnection(config);
  const relevant = workspace === 'gestion' ? connection.gestion : connection.facturacion;
  if (relevant.status === 'unreachable') {
    notifyWorkspaceLoadFailed(workspace, config.host);
    return { ok: false, error: `No se pudo conectar a ${workspaceLabel(workspace)} en ${config.host}.` };
  }
  createWorkspaceWindow(config, workspace);
  logger.info('workspace_opened', { workspace, host: config.host });
  return { ok: true };
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.GET_DESKTOP_CONFIG, async () => getConfig());

  ipcMain.handle(IPC.GET_APP_INFO, () => ({
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle(IPC.TEST_SERVER, async (_event, rawInput: unknown) => {
    if (typeof rawInput !== 'string') {
      return { ok: false, error: 'Entrada inválida.' };
    }
    const normalized = normalizeServerInput(rawInput);
    if (!normalized.ok) {
      return { ok: false, error: normalized.error };
    }
    const config = buildConfig(normalized);
    const connection = await testConnection(config);
    logger.info('connection_tested', { host: config.host, overall: connection.overall });
    return { ok: true, config, connection };
  });

  ipcMain.handle(IPC.SAVE_SERVER, async (_event, config: unknown) => {
    if (!isValidStoredConfig(config)) {
      return { ok: false, error: 'Configuración inválida.' };
    }
    await saveConfig(app.getPath('userData'), config);
    cachedConfig = config;
    logger.info('server_saved', { host: config.host });
    return { ok: true };
  });

  ipcMain.handle(IPC.OPEN_WORKSPACE, async (_event, workspace: unknown) => {
    if (workspace !== 'gestion' && workspace !== 'facturacion') {
      return { ok: false, error: 'Espacio de trabajo inválido.' };
    }
    return openWorkspace(workspace);
  });

  ipcMain.handle(IPC.CREATE_WORKSPACE_SHORTCUTS, async () => {
    if (process.platform !== 'win32') {
      return {
        ok: false,
        created: [],
        error: 'Los accesos directos solo están disponibles en Windows.',
      };
    }
    const desktopDir = app.getPath('desktop');
    const result = await createWorkspaceShortcuts(electronShell, desktopDir, process.execPath);
    logger.info('shortcuts_created', { ok: result.ok, count: result.created.length });
    return result;
  });
}

function buildAppMenu(): Menu {
  const template = buildAppMenuTemplate(
    {
      onInicio: () => createLauncherWindow().show(),
      onGestion: () => void openWorkspace('gestion'),
      onFacturacion: () => void openWorkspace('facturacion'),
      onConfigurarServidor: () => {
        const win = createLauncherWindow();
        win.show();
        win.focus();
        win.webContents.send(IPC.SHOW_CONFIG_SCREEN);
      },
    },
    isDev(),
  );
  return Menu.buildFromTemplate(template);
}

/**
 * Startup routing — Prompt #20 §25:
 * - no config yet -> launcher (config screen)
 * - config + no `--workspace` arg -> normal launcher
 * - config + `--workspace=X` + reachable -> straight to that workspace
 * - config + `--workspace=X` + unreachable -> launcher with a clear
 *   connection error, never a blank remote window
 * - unknown `--workspace` value -> already normalized away by
 *   `parseStartupArgs`, falls through to normal launcher
 */
async function handleStartup(workspace: Workspace | undefined): Promise<void> {
  const config = await getConfig();

  if (!config || !workspace) {
    createLauncherWindow().show();
    return;
  }

  const connection = await testConnection(config);
  const relevant = workspace === 'gestion' ? connection.gestion : connection.facturacion;
  if (relevant.status === 'unreachable') {
    notifyWorkspaceLoadFailed(workspace, config.host);
    return;
  }
  createWorkspaceWindow(config, workspace);
}

function currentArgv(): string[] {
  // Packaged: [exePath, ...userArgs]. Dev (`electron .`): [electronPath, '.', ...userArgs].
  return app.isPackaged ? process.argv.slice(1) : process.argv.slice(2);
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // Prompt #20 §27: one client process per session — a second launch
  // (e.g. a "--workspace=facturacion" shortcut while already running)
  // brings the existing app forward instead of spawning a duplicate.
  app.on('second-instance', (_event, argv) => {
    const { workspace } = parseStartupArgs(argv);
    if (workspace) {
      void openWorkspace(workspace);
    } else {
      const win = launcherWindow ?? createLauncherWindow();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(
    async () => {
      applySecurityPolicies();
      Menu.setApplicationMenu(buildAppMenu());
      registerIpcHandlers();
      const { workspace } = parseStartupArgs(currentArgv());
      await handleStartup(workspace);
    },
    (err: unknown) => {
      logger.error('startup_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    },
  );

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void handleStartup(undefined);
    }
  });
}
