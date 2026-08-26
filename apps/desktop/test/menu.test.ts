import { describe, it, expect, vi } from 'vitest';
import { buildAppMenuTemplate } from '../src/menu';

function noop() {
  /* no-op */
}

const actions = { onInicio: noop, onGestion: noop, onFacturacion: noop, onConfigurarServidor: noop };

describe('buildAppMenuTemplate', () => {
  it('includes a top-level "Edición" menu with the standard native edit roles', () => {
    const template = buildAppMenuTemplate(actions, false);
    const editMenu = template.find((item) => item.label === 'Edición');
    expect(editMenu).toBeDefined();

    const roles = (editMenu?.submenu as { role?: string }[]).map((item) => item.role).filter(Boolean);
    // Order matters for a conventional Edit menu — undo/redo, then
    // cut/copy/paste, then select-all.
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  it('keeps the existing "ERP" menu and its entries unchanged', () => {
    const template = buildAppMenuTemplate(actions, false);
    const erpMenu = template.find((item) => item.label === 'ERP');
    expect(erpMenu).toBeDefined();

    const labels = (erpMenu?.submenu as { label?: string; type?: string }[])
      .map((item) => item.label)
      .filter(Boolean);
    expect(labels).toEqual(['Inicio', 'Gestión', 'Facturación', 'Configurar servidor', 'Recargar', 'Salir']);
  });

  it('wires each ERP menu action to the callback passed in, not a hardcoded one', () => {
    const onGestion = vi.fn();
    const template = buildAppMenuTemplate({ ...actions, onGestion }, false);
    const erpMenu = template.find((item) => item.label === 'ERP');
    const gestionItem = (erpMenu?.submenu as { label?: string; click?: () => void }[]).find(
      (item) => item.label === 'Gestión',
    );
    gestionItem?.click?.();
    expect(onGestion).toHaveBeenCalledOnce();
  });

  it('only adds the DevTools item in dev mode', () => {
    const devTemplate = buildAppMenuTemplate(actions, true);
    const prodTemplate = buildAppMenuTemplate(actions, false);

    const devErpMenu = devTemplate.find((item) => item.label === 'ERP');
    const prodErpMenu = prodTemplate.find((item) => item.label === 'ERP');

    const devLabels = (devErpMenu?.submenu as { label?: string }[]).map((item) => item.label);
    const prodLabels = (prodErpMenu?.submenu as { label?: string }[]).map((item) => item.label);

    expect(devLabels).toContain('Herramientas de desarrollo');
    expect(prodLabels).not.toContain('Herramientas de desarrollo');
  });
});
