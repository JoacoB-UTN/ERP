import type { MenuItemConstructorOptions } from 'electron';

export interface MenuActions {
  onInicio: () => void;
  onGestion: () => void;
  onFacturacion: () => void;
  onConfigurarServidor: () => void;
}

/**
 * Native application menu template — pure and Electron-runtime-independent
 * (only a type-only import of `electron`, never a value import), so it's
 * directly unit-testable without an actual Electron process. `main.ts`'s
 * `buildAppMenu()` is the only caller, wiring real callbacks and passing
 * the result to `Menu.buildFromTemplate`.
 *
 * The "Edición" menu is not cosmetic: on macOS in particular, replacing
 * Electron's default application menu with a fully custom one (as "ERP"
 * below does) silently drops the standard Edit role accelerators —
 * without them, ordinary Cmd+C/Cmd+V/Cmd+X/Cmd+A/Cmd+Z/Cmd+Shift+Z stop
 * working in every text field across the launcher AND every workspace
 * window (Gestión, Facturación, POS), since those keyboard shortcuts are
 * routed through the app's menu-key-equivalents, not something a web page
 * can restore on its own. Using Electron's built-in `undo`/`redo`/`cut`/
 * `copy`/`paste`/`selectAll` roles (rather than any custom clipboard
 * logic) restores this for free and platform-correctly — Ctrl+C/Ctrl+V
 * on Windows, Cmd+C/Cmd+V on macOS — with zero preload/IPC surface
 * added: this is purely native menu wiring, never a clipboard bridge
 * exposed to any renderer.
 */
export function buildAppMenuTemplate(actions: MenuActions, isDev: boolean): MenuItemConstructorOptions[] {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ type: 'separator' }, { label: 'Herramientas de desarrollo', role: 'toggleDevTools' }]
    : [];

  return [
    {
      label: 'ERP',
      submenu: [
        { label: 'Inicio', click: actions.onInicio },
        { label: 'Gestión', click: actions.onGestion },
        { label: 'Facturación', click: actions.onFacturacion },
        { type: 'separator' },
        { label: 'Configurar servidor', click: actions.onConfigurarServidor },
        { label: 'Recargar', role: 'reload' },
        ...devItems,
        { type: 'separator' },
        { label: 'Salir', role: 'quit' },
      ],
    },
    {
      label: 'Edición',
      submenu: [
        { label: 'Deshacer', role: 'undo' },
        { label: 'Rehacer', role: 'redo' },
        { type: 'separator' },
        { label: 'Cortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Pegar', role: 'paste' },
        { type: 'separator' },
        { label: 'Seleccionar todo', role: 'selectAll' },
      ],
    },
  ];
}
