import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SystemStatusPanel } from './system-status-panel';

/**
 * The panel's own behaviour: the refresh control, the "last checked" line, and
 * the rule that a background refetch must never look like a lost result. The
 * status wording itself is covered by `lib/system-status.test.ts`, which can
 * test it without a DOM.
 */

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  health: {
    status: 'connected',
    probe: { reachable: true, response: { status: 'ok', services: { database: 'ok', redis: 'ok' } } },
    isFirstCheck: false,
    isChecking: false,
    lastCheckedAt: 0,
    refresh: () => mocks.refresh(),
  } as Record<string, unknown>,
}));

vi.mock('@/lib/use-server-health', () => ({
  useServerHealth: () => mocks.health,
}));

function healthy(overrides: Record<string, unknown> = {}) {
  return {
    status: 'connected',
    probe: { reachable: true, response: { status: 'ok', services: { database: 'ok', redis: 'ok' } } },
    isFirstCheck: false,
    isChecking: false,
    lastCheckedAt: Date.now(),
    refresh: () => mocks.refresh(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.health = healthy();
});

afterEach(() => cleanup());

describe('SystemStatusPanel', () => {
  it('shows the three services and the overall verdict', () => {
    render(<SystemStatusPanel />);
    expect(screen.getByText('Sistema operativo')).toBeTruthy();
    expect(screen.getByText('Servidor del ERP')).toBeTruthy();
    expect(screen.getByText('Base de datos')).toBeTruthy();
    expect(screen.getByText('Caché (Redis)')).toBeTruthy();
  });

  it('shows when the last real check happened', () => {
    mocks.health = healthy({ lastCheckedAt: new Date().setHours(14, 32, 0, 0) });
    render(<SystemStatusPanel />);
    expect(screen.getByText(/Última comprobación: hoy a las/)).toBeTruthy();
  });

  it('says there are no checks yet before the first one resolves', () => {
    mocks.health = healthy({ isFirstCheck: true, isChecking: true, probe: undefined, lastCheckedAt: 0 });
    render(<SystemStatusPanel />);
    expect(screen.getByText('Comprobando el estado…')).toBeTruthy();
    expect(screen.getByText('Sin comprobaciones todavía')).toBeTruthy();
  });

  it('keeps the last known status on screen during a background refetch', () => {
    // The regression this guards: reverting to "Comprobando el estado…" while
    // a refetch is in flight would throw away a result we still have.
    mocks.health = healthy({ isChecking: true, isFirstCheck: false });
    render(<SystemStatusPanel />);
    expect(screen.getByText('Sistema operativo')).toBeTruthy();
    expect(screen.queryByText('Comprobando el estado…')).toBeNull();
    // Both the status line and the button say it — the point is that neither
    // says "Comprobando…", which is reserved for "nothing known yet".
    expect(screen.getAllByText('Actualizando…').length).toBeGreaterThan(0);
  });

  it('"Actualizar ahora" refreshes the existing query once per click', () => {
    render(<SystemStatusPanel />);
    const button = screen.getByRole('button', { name: /Actualizar ahora/ });
    fireEvent.click(button);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('disables the button while a check is in flight, so it cannot double-fire', () => {
    mocks.health = healthy({ isChecking: true });
    render(<SystemStatusPanel />);
    const button = screen.getByRole('button', { name: /Actualizando…/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('does not blame PostgreSQL or Redis when the server never answered', () => {
    mocks.health = healthy({
      status: 'disconnected',
      probe: { reachable: false, response: null },
    });
    render(<SystemStatusPanel />);
    expect(screen.getByText('Sin conexión con el servidor')).toBeTruthy();
    expect(screen.getAllByText('No se pudo comprobar')).toHaveLength(2);
    expect(screen.queryByText('No disponible')).toBeNull();
  });

  it('offers no way to restart, restore or run anything', () => {
    render(<SystemStatusPanel />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/Actualizar ahora/);
  });
});
