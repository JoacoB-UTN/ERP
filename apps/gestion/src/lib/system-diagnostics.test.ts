import { describe, expect, it } from 'vitest';
import type { SystemDiagnosticsResponse } from '@erp/shared';
import {
  describeDiagnostics,
  formatBytes,
  formatDuration,
} from './system-diagnostics';

/**
 * The property under test is the one the panel lives or dies by: it must
 * never state something the measurement did not establish, and a value it
 * could not measure must read as unmeasured rather than as zero.
 */

function makeData(
  overrides: Partial<{
    server: Partial<SystemDiagnosticsResponse['server']>;
    database: Partial<SystemDiagnosticsResponse['database']>;
    disk: SystemDiagnosticsResponse['disk'];
  }> = {},
): SystemDiagnosticsResponse {
  return {
    server: {
      version: '1.2.3',
      startedAt: new Date().toISOString(),
      uptimeSeconds: 3_600,
      nodeVersion: 'v22.0.0',
      ...overrides.server,
    },
    database: {
      startedAt: new Date().toISOString(),
      uptimeSeconds: 7_200,
      latencyMs: 3.4,
      sizeBytes: 18_594_839,
      ...overrides.database,
    },
    disk: overrides.disk ?? {
      backups: { totalBytes: 100_000_000_000, freeBytes: 50_000_000_000 },
    },
  };
}

function rowFor(data: SystemDiagnosticsResponse, key: string) {
  const row = describeDiagnostics(data).find((r) => r.key === key);
  if (!row) throw new Error(`No hay fila "${key}"`);
  return row;
}

describe('formatDuration', () => {
  it('drops to the coarsest useful unit', () => {
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(90)).toBe('1 min');
    expect(formatDuration(3_700)).toBe('1 h 1 min');
    expect(formatDuration(90_000)).toBe('1 d 1 h');
  });

  it('never renders a negative duration', () => {
    // Clock skew between the database and the API can make an elapsed time
    // come out below zero; "-3 s de actividad" would just look broken.
    expect(formatDuration(-10)).toBe('0 s');
  });
});

describe('formatBytes', () => {
  it('keeps one decimal below ten so 1,4 GB does not become 1 GB', () => {
    expect(formatBytes(1_500_000_000)).toBe('1,4 GB');
    expect(formatBytes(50_000_000_000)).toBe('47 GB');
  });

  it('uses bytes below a kilobyte', () => {
    expect(formatBytes(512)).toBe('512 B');
  });
});

describe('describeDiagnostics', () => {
  it('returns nothing before the first measurement', () => {
    expect(describeDiagnostics(undefined)).toEqual([]);
  });

  it('shows the version and the Node it runs on', () => {
    const row = rowFor(makeData(), 'version');
    expect(row.value).toBe('1.2.3');
    expect(row.hint).toContain('v22.0.0');
  });

  it('flags a build that could not name itself', () => {
    const row = rowFor(makeData({ server: { version: 'unknown' } }), 'version');
    expect(row.value).toBe('No se pudo medir');
    expect(row.tone).toBe('warning');
  });

  it('warns when the API has only just started', () => {
    const row = rowFor(makeData({ server: { uptimeSeconds: 12 } }), 'apiUptime');
    expect(row.tone).toBe('warning');
    expect(row.hint).toContain('se está cayendo');
  });

  it('treats a database older than the API by hours as normal', () => {
    // Restarting only the API is an everyday thing. This must not cry wolf.
    const row = rowFor(
      makeData({
        server: { uptimeSeconds: 60 },
        database: { uptimeSeconds: 20_000 },
      }),
      'databaseUptime',
    );
    expect(row.tone).toBe('success');
    expect(row.hint).toBeUndefined();
  });

  it('flags a postmaster that outlived the API by more than a day', () => {
    // The defect this panel exists for: WinSW died, Windows reported the
    // service stopped, and PostgreSQL kept serving unsupervised.
    const row = rowFor(
      makeData({
        server: { uptimeSeconds: 300 },
        database: { uptimeSeconds: 300 + 86_401 },
      }),
      'databaseUptime',
    );
    expect(row.tone).toBe('warning');
    expect(row.hint).toContain('erp-postgres');
  });

  it('escalates latency in two steps', () => {
    expect(rowFor(makeData({ database: { latencyMs: 5 } }), 'latency').tone).toBe(
      'success',
    );
    expect(
      rowFor(makeData({ database: { latencyMs: 300 } }), 'latency').tone,
    ).toBe('warning');
    expect(
      rowFor(makeData({ database: { latencyMs: 1_500 } }), 'latency').tone,
    ).toBe('danger');
  });

  it('escalates disk pressure in two steps and says what breaks', () => {
    const healthy = rowFor(makeData(), 'disk');
    expect(healthy.tone).toBe('success');
    expect(healthy.value).toContain('de');

    const low = rowFor(
      makeData({
        disk: { backups: { totalBytes: 1_000, freeBytes: 100 } },
      }),
      'disk',
    );
    expect(low.tone).toBe('warning');

    const critical = rowFor(
      makeData({ disk: { backups: { totalBytes: 1_000, freeBytes: 10 } } }),
      'disk',
    );
    expect(critical.tone).toBe('danger');
    expect(critical.hint).toContain('backups');
  });

  it('says "no se pudo medir" instead of zero for every unmeasured value', () => {
    // A zero and an unknown send an operator to two different places, and
    // this is the whole reason the API returns null rather than 0.
    const data = makeData({
      database: {
        startedAt: null,
        uptimeSeconds: null,
        latencyMs: null,
        sizeBytes: null,
      },
      disk: { backups: null },
    });

    for (const key of ['databaseUptime', 'latency', 'disk', 'databaseSize']) {
      const row = rowFor(data, key);
      expect(row.value).toBe('No se pudo medir');
      expect(row.tone).toBe('warning');
    }
  });

  it('gives every row a word, never a colour alone', () => {
    for (const row of describeDiagnostics(makeData())) {
      expect(row.value.trim().length).toBeGreaterThan(0);
    }
  });
});
