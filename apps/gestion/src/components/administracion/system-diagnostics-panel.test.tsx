import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SystemDiagnosticsPanel } from './system-diagnostics-panel';

/**
 * The panel's own behaviour: the three states of the query, and the rule that
 * an endpoint it cannot reach is itself reported rather than rendered as an
 * empty grid. The wording of each row is covered by
 * `lib/system-diagnostics.test.ts`, which needs no DOM.
 */

const mocks = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
}));

vi.mock('@/lib/auth-client', () => ({
  useSystemDiagnostics: () => mocks.query,
}));

const data = {
  server: {
    version: '1.2.3',
    startedAt: new Date().toISOString(),
    uptimeSeconds: 7_200,
    nodeVersion: 'v22.0.0',
  },
  database: {
    startedAt: new Date().toISOString(),
    uptimeSeconds: 9_000,
    latencyMs: 2.5,
    sizeBytes: 18_594_839,
  },
  disk: { backups: { totalBytes: 100_000_000_000, freeBytes: 50_000_000_000 } },
};

beforeEach(() => {
  mocks.query = { isPending: false, isError: false, data };
});

afterEach(cleanup);

describe('SystemDiagnosticsPanel', () => {
  it('shows every measured row once the query resolves', () => {
    render(<SystemDiagnosticsPanel />);

    expect(screen.getByText('Versión instalada')).toBeTruthy();
    expect(screen.getByText('1.2.3')).toBeTruthy();
    expect(screen.getByText('PostgreSQL en línea desde hace')).toBeTruthy();
    expect(screen.getByText('Espacio libre en disco')).toBeTruthy();
  });

  it('says it is measuring before the first result', () => {
    mocks.query = { isPending: true, isError: false, data: undefined };
    render(<SystemDiagnosticsPanel />);

    expect(screen.getByText('Midiendo…')).toBeTruthy();
    expect(screen.queryByText('Versión instalada')).toBeNull();
  });

  it('reports a diagnostics endpoint it could not reach', () => {
    // Silence here would be the worst outcome: the operator would read an
    // empty panel as "nothing to report" on a machine that is failing.
    mocks.query = { isPending: false, isError: true, data: undefined };
    render(<SystemDiagnosticsPanel />);

    expect(
      screen.getByText('No se pudo obtener el diagnóstico del servidor.'),
    ).toBeTruthy();
  });

  it('surfaces the orphaned-postmaster warning where an operator will read it', () => {
    mocks.query = {
      isPending: false,
      isError: false,
      data: {
        ...data,
        server: { ...data.server, uptimeSeconds: 300 },
        database: { ...data.database, uptimeSeconds: 300 + 86_401 },
      },
    };
    render(<SystemDiagnosticsPanel />);

    expect(screen.getByText(/erp-postgres/)).toBeTruthy();
  });

  it('offers no control that changes anything on the server', () => {
    // A read permission gates this screen; it must never gate an action.
    render(<SystemDiagnosticsPanel />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
