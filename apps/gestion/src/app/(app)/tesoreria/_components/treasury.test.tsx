import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TreasuryAccountDto, TreasuryTransferDto } from '@erp/shared';
import TreasuryLayout from '../layout';
import { AccountsPage, AccountForm, AccountDetailPage, NewAccountPage } from './accounts';
import { TransferForm, TransferDetailPage } from './transfers';
import { money, localDateBound } from './common';

const mock = vi.hoisted(() => ({
  company: 'company-a',
  permissions: new Set<string>(),
  accounts: [] as unknown[],
  account: undefined as unknown,
  transfer: undefined as unknown,
  rows: [] as unknown[],
  listError: false,
  create: vi.fn(),
  update: vi.fn(),
  opening: vi.fn(),
  createTransfer: vi.fn(),
  updateTransfer: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  push: vi.fn(),
  statement: vi.fn(),
  accountsQuery: vi.fn(),
}));
const result = (data: unknown) => ({
  data,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
});
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'account-a' }),
  useRouter: () => ({ push: mock.push }),
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { companyContextStore: { getActiveCompanyId: () => mock.company } },
  useActiveCompany: () => ({ activeCompanyId: mock.company }),
  usePermissions: () => ({ can: (p: string) => mock.permissions.has(p), isLoading: false }),
  useBranches: () => result({ branches: [] }),
  useTreasuryCurrencies: () =>
    result({
      currencies: [{ id: '11111111-1111-4111-8111-111111111111', code: 'ARS', name: 'Peso', active: true }],
    }),
  useTreasuryAccounts: (...args: unknown[]) => {
    mock.accountsQuery(...args);
    return {
      ...result({ accounts: mock.accounts }),
      isError: mock.listError,
      error: mock.listError ? new Error('Sin conexión') : null,
    };
  },
  useTreasuryAccount: () => result({ account: mock.account }),
  useTreasuryStatement: (...args: unknown[]) => {
    mock.statement(...args);
    return result({
      account: mock.account,
      rows: mock.rows,
      pagination: { total: mock.rows.length },
      excludesPosSales: true,
    });
  },
  useTreasuryTransfer: () => result({ transfer: mock.transfer }),
  useTreasuryTransfers: () => result({ transfers: [], pagination: { total: 0 } }),
  useCreateTreasuryAccount: () => ({ mutateAsync: mock.create, isPending: false }),
  useUpdateTreasuryAccount: () => ({ mutateAsync: mock.update, isPending: false }),
  useSetTreasuryOpeningBalance: () => ({ mutateAsync: mock.opening, isPending: false }),
  useCreateTreasuryTransfer: () => ({ mutateAsync: mock.createTransfer, isPending: false }),
  useUpdateTreasuryTransfer: () => ({ mutateAsync: mock.updateTransfer, isPending: false }),
  useConfirmTreasuryTransfer: () => ({ mutateAsync: mock.confirm, isPending: false }),
  useCancelTreasuryTransfer: () => ({ mutateAsync: mock.cancel, isPending: false }),
}));
const currencyId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const destinationId = '33333333-3333-4333-8333-333333333333';
const account: TreasuryAccountDto = {
  id: sourceId,
  code: 'CAJA',
  name: 'Caja principal',
  type: 'CASH_BOX',
  currencyId,
  currencyCode: 'ARS',
  currencySymbol: '$',
  branchId: null,
  branchName: null,
  allowsNegativeBalance: false,
  bankName: null,
  accountNumber: null,
  cbu: null,
  alias: null,
  notes: null,
  active: true,
  balance: '1000.1234',
};
const transfer: TreasuryTransferDto = {
  id: 'transfer-a',
  number: 'TRF-000001',
  status: 'DRAFT',
  sourceAccountId: sourceId,
  sourceAccountName: 'Caja principal',
  destinationAccountId: destinationId,
  destinationAccountName: 'Banco',
  currencyId,
  currencyCode: 'ARS',
  amount: '100.1234',
  occurredAt: '2026-10-03T12:30:00.000Z',
  notes: null,
  confirmedAt: null,
  cancelledAt: null,
  createdAt: '2026-10-03T12:30:00.000Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.company = 'company-a';
  mock.permissions = new Set(['treasury.accounts.read']);
  mock.accounts = [
    account,
    { ...account, id: destinationId, name: 'Banco', type: 'BANK_ACCOUNT' },
    { ...account, id: 'usd', currencyId: 'usd', currencyCode: 'USD', name: 'Dólares' },
  ];
  mock.account = account;
  mock.transfer = transfer;
  mock.rows = [];
  mock.listError = false;
  mock.create.mockResolvedValue({ account });
  mock.update.mockResolvedValue({ account });
  mock.createTransfer.mockResolvedValue({ transfer });
  mock.updateTransfer.mockResolvedValue({ transfer });
  mock.confirm.mockResolvedValue({ transfer: { ...transfer, status: 'CONFIRMED' } });
  mock.cancel.mockResolvedValue({ transfer: { ...transfer, status: 'CANCELLED' } });
});
afterEach(cleanup);

describe('Treasury presentation and permissions', () => {
  it('preserves all decimal digits and currencies without summing balances', () => {
    expect(money('9007199254740993.1234', 'ARS')).toBe('ARS 9.007.199.254.740.993,1234');
    render(<AccountsPage />);
    expect(screen.getAllByText('ARS 1.000,1234')).toHaveLength(2);
    expect(screen.getByText('USD 1.000,1234')).toBeTruthy();
    expect(screen.getByText(/Este saldo no incluye ventas de POS/)).toBeTruthy();
    expect(screen.queryByText('Nueva cuenta')).toBeNull();
  });
  it('disables protected queries and shows unauthorized on direct navigation', () => {
    mock.permissions.clear();
    render(<AccountsPage />);
    expect(mock.accountsQuery).toHaveBeenCalledWith({ includeInactive: false, type: undefined }, false);
    expect(screen.getByText(/No tenés permiso/)).toBeTruthy();
    expect(screen.queryByText('Caja principal')).toBeNull();
  });
  it('shows API failure rather than stale balances', () => {
    mock.listError = true;
    render(<AccountsPage />);
    expect(screen.getByRole('alert').textContent).toContain('Sin conexión');
    expect(screen.queryByText('ARS 1.000,1234')).toBeNull();
  });
  it('keeps account-read separate from statement and opening permissions', () => {
    render(<AccountDetailPage />);
    expect(mock.statement).not.toHaveBeenCalled();
    expect(screen.queryByText('Cargar saldo inicial')).toBeNull();
    expect(screen.queryByText('Editar cuenta')).toBeNull();
  });
  it('allows account creation with Treasury create permission alone', () => {
    mock.permissions = new Set(['treasury.accounts.create']);
    render(<NewAccountPage />);
    expect(screen.getByLabelText('Moneda')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guardar cuenta' })).toBeTruthy();
  });
  it('uses inclusive local-day bounds and backend running balance', () => {
    mock.permissions.add('treasury.movements.read');
    mock.rows = [
      {
        id: 'row',
        movementType: 'PAYMENT',
        amount: '-10.125',
        runningBalance: '9999.4321',
        occurredAt: '2026-10-03T12:30:00Z',
        sourceType: 'PAYMENT',
        sourceId: 'p1',
        description: 'Pago proveedor',
        notes: null,
        reversalOfId: null,
      },
    ];
    render(<AccountDetailPage />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta (inclusive)'), { target: { value: '2026-10-03' } });
    expect(mock.statement).toHaveBeenLastCalledWith(
      sourceId,
      expect.objectContaining({
        from: localDateBound('2026-10-01'),
        to: localDateBound('2026-10-03', true),
        page: 1,
      }),
      true,
    );
    const end = new Date(localDateBound('2026-10-03', true)!);
    expect(end.getHours()).toBe(23);
    expect(end.getMilliseconds()).toBe(999);
    expect(screen.getByText('ARS 9.999,4321')).toBeTruthy();
  });
  it('uses movement-create permission for opening, retains signed decimal payload and surfaces refusal', async () => {
    mock.permissions.add('treasury.movements.create');
    mock.opening.mockRejectedValue(new Error('La cuenta ya tiene movimientos.'));
    render(<AccountDetailPage />);
    fireEvent.click(screen.getByText('Cargar saldo inicial'));
    fireEvent.change(screen.getByLabelText('Importe (ARS)'), { target: { value: '-10.1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar saldo inicial' }));
    await waitFor(() =>
      expect(mock.opening).toHaveBeenCalledWith({ id: sourceId, input: { amount: '-10.1234', notes: '' } }),
    );
    expect(await screen.findByText('La cuenta ya tiene movimientos.')).toBeTruthy();
  });
});
describe('Treasury forms', () => {
  it('clears optional metadata using null and cannot edit type/currency/code', async () => {
    render(
      <AccountForm
        account={{ ...account, type: 'BANK_ACCOUNT', alias: 'antes', notes: 'antes' }}
        onSaved={vi.fn()}
      />,
    );
    expect((screen.getByLabelText('Moneda') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Código') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Alias'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Notas'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Guardar cuenta'));
    await waitFor(() =>
      expect(mock.update).toHaveBeenCalledWith({
        id: sourceId,
        input: expect.objectContaining({ alias: null, notes: null, branchId: null }),
      }),
    );
    expect(mock.update.mock.calls[0][0].input).not.toHaveProperty('currencyId');
  });
  it('clears all drafts on company switch and ignores late completion navigation', async () => {
    let resolve!: (value: unknown) => void;
    mock.create.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const onSaved = vi.fn();
    const ui = () => (
      <TreasuryLayout>
        <AccountForm onSaved={onSaved} />
      </TreasuryLayout>
    );
    const view = render(ui());
    fireEvent.change(screen.getByLabelText('Código'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Empresa A' } });
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: currencyId } });
    fireEvent.click(screen.getByText('Guardar cuenta'));
    await waitFor(() => expect(mock.create).toHaveBeenCalled());
    mock.company = 'company-b';
    view.rerender(ui());
    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('');
    resolve({ account });
    await waitFor(() => expect(onSaved).not.toHaveBeenCalled());
  });
  it('filters destinations by currency, clears destination on source change and submits decimal string', async () => {
    render(<TransferForm onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Cuenta de origen'), { target: { value: sourceId } });
    const destination = screen.getByLabelText('Cuenta de destino') as HTMLSelectElement;
    expect([...destination.options].map((o) => o.value)).toEqual(['', destinationId]);
    fireEvent.change(destination, { target: { value: destinationId } });
    fireEvent.change(screen.getByLabelText('Importe (ARS)'), { target: { value: '1.1234' } });
    fireEvent.click(screen.getByText('Guardar borrador'));
    await waitFor(() =>
      expect(mock.createTransfer).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: '1.1234',
          sourceAccountId: sourceId,
          destinationAccountId: destinationId,
        }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Cuenta de origen'), { target: { value: destinationId } });
    expect(destination.value).toBe('');
  });
  it('edits draft notes without truncating its original timestamp or decimal amount', async () => {
    const original = { ...transfer, occurredAt: '2026-10-03T12:30:47.123Z', notes: 'Antes' };
    render(<TransferForm transfer={original} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Notas'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Guardar borrador'));
    await waitFor(() =>
      expect(mock.updateTransfer).toHaveBeenCalledWith({
        id: transfer.id,
        input: expect.objectContaining({ notes: null, amount: '100.1234', occurredAt: original.occurredAt }),
      }),
    );
  });
  it('drops transfer account selections and amounts on company change', () => {
    const ui = () => (
      <TreasuryLayout>
        <TransferForm onSaved={vi.fn()} />
      </TreasuryLayout>
    );
    const view = render(ui());
    fireEvent.change(screen.getByLabelText('Cuenta de origen'), { target: { value: sourceId } });
    fireEvent.change(screen.getByLabelText('Cuenta de destino'), { target: { value: destinationId } });
    fireEvent.change(screen.getByLabelText('Importe (ARS)'), { target: { value: '1.2345' } });
    mock.company = 'company-b';
    view.rerender(ui());
    expect((screen.getByLabelText('Cuenta de origen') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Cuenta de destino') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Importe') as HTMLInputElement).value).toBe('');
  });
  it('confirm and cancellation require their own permissions and explicit review', async () => {
    mock.permissions = new Set(['treasury.transfers.read', 'treasury.transfers.confirm']);
    render(<TransferDetailPage />);
    expect(screen.queryByText('Anular transferencia')).toBeNull();
    expect(screen.queryByText('Editar borrador')).toBeNull();
    fireEvent.click(screen.getByText('Confirmar transferencia'));
    expect(mock.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Sí, confirmar'));
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledWith(transfer.id));
  });
  it.each(['DRAFT', 'CANCELLED'] as const)(
    'does not offer cancellation for %s even with cancel permission',
    (status) => {
      mock.permissions = new Set(['treasury.transfers.read', 'treasury.transfers.cancel']);
      mock.transfer = { ...transfer, status };
      render(<TransferDetailPage />);
      expect(screen.queryByText('Anular transferencia')).toBeNull();
      expect(screen.queryByText('Sí, anular')).toBeNull();
      expect(mock.cancel).not.toHaveBeenCalled();
    },
  );
  it('confirmed transfers cannot be edited and cancellation describes compensating entries', async () => {
    mock.permissions = new Set([
      'treasury.transfers.read',
      'treasury.transfers.update',
      'treasury.transfers.confirm',
      'treasury.transfers.cancel',
      'treasury.accounts.read',
    ]);
    mock.transfer = { ...transfer, status: 'CONFIRMED' };
    render(<TransferDetailPage />);
    expect(screen.queryByText('Editar borrador')).toBeNull();
    expect(screen.queryByText('Confirmar transferencia')).toBeNull();
    fireEvent.click(screen.getByText('Anular transferencia'));
    expect(screen.getByText(/movimientos compensatorios/)).toBeTruthy();
    fireEvent.click(screen.getByText('Sí, anular'));
    await waitFor(() => expect(mock.cancel).toHaveBeenCalledWith(transfer.id));
  });
});
