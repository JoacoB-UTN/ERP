import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BackupsPage from '@/app/(app)/administracion/backups/page';

/**
 * The screen the system-status panel was added to. Two things must stay true:
 * it is still gated by `system.backups.read`, and everything that was on it
 * before is still on it.
 */

const mocks = vi.hoisted(() => ({
  permissions: ['system.backups.read'] as string[],
  backupStatus: undefined as unknown,
  backupsLoading: false,
  backupsError: false,
}));

vi.mock('@/lib/auth-client', () => ({
  usePermissions: () => ({
    can: (code: string) => mocks.permissions.includes(code),
    isLoading: false,
  }),
  useBackupStatus: () => ({
    data: mocks.backupStatus,
    isLoading: mocks.backupsLoading,
    isError: mocks.backupsError,
  }),
}));

vi.mock('@/lib/use-server-health', () => ({
  useServerHealth: () => ({
    status: 'connected',
    probe: {
      reachable: true,
      response: { status: 'ok', services: { database: 'ok', redis: 'ok' } },
    },
    isFirstCheck: false,
    isChecking: false,
    lastCheckedAt: Date.now(),
    refresh: () => {},
  }),
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function fakeStatus() {
  return {
    configured: true,
    lastRun: { id: 'run-1', status: 'success', startedAt: hoursAgo(3), verified: true },
    lastSuccessfulRun: { id: 'run-1', status: 'success', startedAt: hoursAgo(3), verified: true },
    schedule: ['03:00', '15:00'],
    retentionDays: 30,
    nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
    storedBackups: 12,
    totalSizeBytes: 512 * 1024 * 1024,
    cloudEnabled: false,
    recentRuns: [
      {
        id: 'run-1',
        status: 'success',
        startedAt: hoursAgo(3),
        verified: true,
        sizeBytes: 42 * 1024 * 1024,
        trigger: 'scheduled',
        cloud: { status: 'skipped' },
      },
    ],
  };
}

beforeEach(() => {
  mocks.permissions = ['system.backups.read'];
  mocks.backupStatus = fakeStatus();
  mocks.backupsLoading = false;
  mocks.backupsError = false;
});

afterEach(() => cleanup());

describe('Servidor y backups', () => {
  it('refuses the screen without system.backups.read', () => {
    mocks.permissions = ['sales.documents.create'];
    render(<BackupsPage />);
    // No status panel, no backup data — the unauthorized state instead.
    expect(screen.queryByText('Sistema operativo')).toBeNull();
    expect(screen.queryByText('Historial')).toBeNull();
    expect(screen.queryByRole('button', { name: /Actualizar ahora/ })).toBeNull();
  });

  it('leads with the system status panel', () => {
    render(<BackupsPage />);
    expect(screen.getByText('Servidor y backups')).toBeTruthy();
    expect(screen.getByText('Sistema operativo')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Actualizar ahora/ })).toBeTruthy();
  });

  it('still renders the existing backup summary and history', () => {
    render(<BackupsPage />);
    expect(screen.getByText('Última copia correcta')).toBeTruthy();
    expect(screen.getByText('Copias guardadas')).toBeTruthy();
    expect(screen.getByText('Próxima copia')).toBeTruthy();
    // Appears twice: as a summary card and as a history column.
    expect(screen.getAllByText('Copia externa').length).toBeGreaterThan(0);
    expect(screen.getByText('Historial')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/se conservan 30 días/)).toBeTruthy();
    // A row from recentRuns actually rendered.
    expect(screen.getAllByText('Correcta').length).toBeGreaterThan(0);
  });

  it('shows the panel even while the backup status is still loading', () => {
    mocks.backupStatus = undefined;
    mocks.backupsLoading = true;
    render(<BackupsPage />);
    expect(screen.getByText('Sistema operativo')).toBeTruthy();
    expect(screen.getByText('Cargando el estado de los backups…')).toBeTruthy();
  });

  it('offers no write action anywhere on the screen', () => {
    render(<BackupsPage />);
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatch(/Actualizar ahora/);
  });
});
