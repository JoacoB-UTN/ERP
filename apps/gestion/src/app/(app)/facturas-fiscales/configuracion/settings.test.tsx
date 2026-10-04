import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiscalSettings } from '@erp/shared';
import FiscalSettingsPage, { SettingsForm } from './page';
import FiscalLayout from '../layout';

const mock = vi.hoisted(() => ({
  company: 'a',
  allowed: true,
  save: vi.fn(),
  probe: vi.fn(),
  authenticate: vi.fn(),
  query: vi.fn(),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({ can: () => mock.allowed, isLoading: false }),
  useFiscalSettings: (enabled: boolean) => mock.query(enabled),
  useSaveFiscalSettings: () => ({ mutateAsync: mock.save }),
  useCheckFiscalConnectivity: () => ({ mutateAsync: mock.probe }),
  useCheckFiscalAuthentication: () => ({ mutateAsync: mock.authenticate }),
}));
const initial: FiscalSettings = {
  environment: 'HOMOLOGATION',
  issuer: { legalName: 'Empresa', taxId: '20123456786', taxIdFormatValid: true },
  vatCondition: null,
  testPointOfSale: null,
  revision: 0,
  updatedAt: null,
  authorizationAvailable: false,
  pendingRequirements: ['Credenciales pendientes', 'Emisión no implementada'],
};
const available = {
  environment: 'HOMOLOGATION',
  checkedAt: '2026-10-04T00:00:00Z',
  status: 'AVAILABLE',
  services: { application: 'OK', database: 'OK', authentication: 'OK' },
  authorizationAvailable: false,
  message: 'Servicio disponible; no habilita emisión.',
};
beforeEach(() => {
  mock.authenticate
    .mockReset()
    .mockResolvedValue({ status: 'UNAVAILABLE', message: 'Certificado vencido.', expiresAt: null });
  mock.company = 'a';
  mock.allowed = true;
  mock.save.mockReset().mockResolvedValue({ settings: { ...initial, revision: 1 } });
  mock.probe.mockReset().mockResolvedValue(available);
  mock.query.mockReset().mockReturnValue({
    data: { settings: initial },
    isError: false,
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);
describe('Homologation setup', () => {
  it('allows unknown values without inventing fiscal defaults', async () => {
    render(<SettingsForm initial={initial} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    await waitFor(() =>
      expect(mock.save).toHaveBeenCalledWith({
        vatCondition: null,
        testPointOfSale: null,
        expectedRevision: 0,
      }),
    );
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.queryByLabelText(/clave|certificado/i)).toBeNull();
  });
  it.each(['0', '100000', '1.2', '-1', 'abc'])('rejects invalid point %s before saving', (point) => {
    render(<SettingsForm initial={initial} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: point } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(mock.save).not.toHaveBeenCalled();
  });
  it('keeps choices and loaded revision across failed background refetches and retries', async () => {
    const view = render(<FiscalSettingsPage />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'EXENTO' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '45' } });
    mock.query.mockReturnValue({
      data: { settings: initial },
      isError: true,
      error: new Error('Temporal'),
      refetch: vi.fn(),
    });
    view.rerender(<FiscalSettingsPage />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('45');
    mock.query.mockReturnValue({ data: { settings: { ...initial, revision: 8 } }, isError: false });
    view.rerender(<FiscalSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    await waitFor(() =>
      expect(mock.save).toHaveBeenCalledWith({
        vatCondition: 'EXENTO',
        testPointOfSale: 45,
        expectedRevision: 0,
      }),
    );
  });
  it('shows conflicts and explicit reload instead of claiming a save', async () => {
    mock.save.mockRejectedValue(new Error('La configuración cambió. Recargala.'));
    render(<SettingsForm initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    expect((await screen.findByRole('alert')).textContent).toContain('cambió');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /Recargar configuración/ })).toBeTruthy();
  });
  it('does not query or render controls without configuration permission', () => {
    mock.allowed = false;
    render(<FiscalSettingsPage />);
    expect(mock.query).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('does not render an editable form when initial loading fails', () => {
    mock.query.mockReturnValue({
      data: undefined,
      isError: true,
      error: new Error('Offline'),
      refetch: vi.fn(),
    });
    render(<FiscalSettingsPage />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
  it('shows public availability without authorizing emission', async () => {
    render(<SettingsForm initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar disponibilidad de ARCA' }));
    expect((await screen.findByRole('status')).textContent).toContain('no habilita emisión');
    expect(mock.save).not.toHaveBeenCalled();
    expect(screen.getByText('Emisión no implementada')).toBeTruthy();
  });
  it('ignores late probe results after changing company', async () => {
    let resolve!: (value: unknown) => void;
    mock.probe.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SettingsForm initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar disponibilidad de ARCA' }));
    mock.company = 'b';
    await act(async () => {
      resolve(available);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('resets selections on a company change', () => {
    const view = render(
      <FiscalLayout>
        <SettingsForm initial={initial} />
      </FiscalLayout>,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '12' } });
    mock.company = 'b';
    view.rerender(
      <FiscalLayout>
        <SettingsForm initial={initial} />
      </FiscalLayout>,
    );
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
  });
});

it('checks credentials explicitly and shows safe expired-certificate status', async () => {
  render(<SettingsForm initial={initial} />);
  expect(mock.authenticate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Probar autenticación de homologación' }));
  expect(await screen.findByText('Certificado vencido.')).toBeTruthy();
  expect(screen.getByText('Autenticación no disponible')).toBeTruthy();
});
it('discards late authentication results after changing company', async () => {
  let resolve!: (value: unknown) => void;
  mock.authenticate.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  render(<SettingsForm initial={initial} />);
  fireEvent.click(screen.getByRole('button', { name: 'Probar autenticación de homologación' }));
  mock.company = 'b';
  await act(async () => resolve({ status: 'READY', message: 'Old company auth', expiresAt: null }));
  expect(screen.queryByText('Old company auth')).toBeNull();
});
