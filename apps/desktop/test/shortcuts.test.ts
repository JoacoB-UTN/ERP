import { describe, it, expect, vi } from 'vitest';
import { buildShortcutSpecs, createWorkspaceShortcuts } from '../src/shortcuts';

describe('buildShortcutSpecs', () => {
  it('builds exactly two specs — Gestión and Facturación — targeting the installed executable', () => {
    const specs = buildShortcutSpecs('C:\\Program Files\\ERP\\ERP.exe');
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({
      name: 'ERP Gestión',
      targetPath: 'C:\\Program Files\\ERP\\ERP.exe',
      args: '--workspace=gestion',
      workspace: 'gestion',
    });
    expect(specs[1]).toEqual({
      name: 'ERP Facturación',
      targetPath: 'C:\\Program Files\\ERP\\ERP.exe',
      args: '--workspace=facturacion',
      workspace: 'facturacion',
    });
  });

  it('the args exactly match what startup-args.ts parses back into a workspace', () => {
    const specs = buildShortcutSpecs('/any/path');
    for (const spec of specs) {
      expect(spec.args).toBe(`--workspace=${spec.workspace}`);
    }
  });
});

describe('createWorkspaceShortcuts', () => {
  it('writes both shortcuts via shell.writeShortcutLink and reports their paths', async () => {
    const writeShortcutLink = vi.fn().mockReturnValue(true);
    const result = await createWorkspaceShortcuts(
      { writeShortcutLink },
      '/Users/demo/Desktop',
      '/Applications/ERP.app',
    );
    expect(result.ok).toBe(true);
    expect(result.created).toHaveLength(2);
    expect(writeShortcutLink).toHaveBeenCalledTimes(2);
    expect(writeShortcutLink).toHaveBeenCalledWith(
      expect.stringContaining('ERP Gestión'),
      expect.objectContaining({ target: '/Applications/ERP.app', args: '--workspace=gestion' }),
    );
  });

  it('reports failure without throwing when the OS shortcut write fails', async () => {
    const writeShortcutLink = vi.fn().mockReturnValue(false);
    const result = await createWorkspaceShortcuts(
      { writeShortcutLink },
      '/Users/demo/Desktop',
      '/Applications/ERP.app',
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
