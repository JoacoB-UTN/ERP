import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import type { StockTransferDetail, StockTransferSummary } from '@erp/shared';
import TransferenciasPage from '@/app/(app)/stock/transferencias/page';
import TransferenciaDetailPage from '@/app/(app)/stock/transferencias/[id]/page';

/**
 * What these screens must never get wrong — see docs/inventory.md:
 *
 *  - Every action is gated by its own permission. The frontend check is UX
 *    only (the API gates independently), but an operator seeing a button
 *    they cannot use is a bug either way.
 *  - A CONFIRMED transfer is immutable: no Editar, no re-Confirmar.
 *  - Cancelling a CONFIRMED transfer writes compensating movements to the
 *    ledger. The confirmation prompt has to say so — a draft cancellation
 *    and a confirmed one are very different acts behind the same word.
 */

const mocks = vi.hoisted(() => ({
  permissions: [] as string[],
  listItems: [] as unknown[],
  listLoading: false,
  listError: false,
  detail: null as unknown,
  confirmMutate: vi.fn(),
  cancelMutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'transfer-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  usePermissions: () => ({
    can: (code: string) => mocks.permissions.includes(code),
    isLoading: false,
  }),
  useWarehouses: () => ({ data: { warehouses: [] }, isLoading: false }),
  useStockTransfers: () => ({
    data: mocks.listError
      ? undefined
      : {
          items: mocks.listItems,
          pagination: { page: 1, pageSize: 25, total: mocks.listItems.length },
        },
    isLoading: mocks.listLoading,
    isError: mocks.listError,
    refetch: vi.fn(),
  }),
  useStockTransfer: () => ({
    data: mocks.detail ? { transfer: mocks.detail } : undefined,
    isLoading: false,
    isError: false,
  }),
  useConfirmStockTransfer: () => ({ mutateAsync: mocks.confirmMutate, isPending: false }),
  useCancelStockTransfer: () => ({ mutateAsync: mocks.cancelMutate, isPending: false }),
}));

const ALL_PERMISSIONS = [
  'inventory.transfers.read',
  'inventory.transfers.create',
  'inventory.transfers.confirm',
  'inventory.transfers.cancel',
];

function summary(overrides: Partial<StockTransferSummary> = {}): StockTransferSummary {
  return {
    id: 'transfer-1',
    number: 'TR-000001',
    sourceWarehouseId: 'wh-src',
    sourceWarehouseName: 'Depósito Central',
    destinationWarehouseId: 'wh-dst',
    destinationWarehouseName: 'Sucursal Norte',
    reason: 'Reposición',
    status: 'DRAFT',
    occurredAt: '2026-09-14T10:00:00.000Z',
    lineCount: 2,
    createdBy: { id: 'user-1', name: 'Ana Gómez' },
    ...overrides,
  };
}

function detail(overrides: Partial<StockTransferDetail> = {}): StockTransferDetail {
  return {
    ...summary(),
    notes: null,
    createdAt: '2026-09-14T09:00:00.000Z',
    confirmedAt: null,
    cancelledAt: null,
    lines: [
      {
        id: 'line-1',
        productVariantId: 'variant-1',
        productId: 'product-1',
        productName: 'Tornillo 5mm',
        variantName: null,
        sku: 'TOR-5',
        quantity: '10',
        notes: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mocks.permissions = [...ALL_PERMISSIONS];
  mocks.listItems = [summary()];
  mocks.listLoading = false;
  mocks.listError = false;
  mocks.detail = detail();
  mocks.confirmMutate = vi.fn().mockResolvedValue(undefined);
  mocks.cancelMutate = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Transferencias — listado', () => {
  it('niega el acceso sin inventory.transfers.read', () => {
    mocks.permissions = [];
    render(<TransferenciasPage />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('TR-000001')).toBeNull();
  });

  it('muestra origen y destino de cada transferencia', () => {
    render(<TransferenciasPage />);
    // Origen y destino comparten una celda, separados por un ícono, así que
    // se afirman sobre el texto de la fila y no como nodos sueltos.
    const row = screen.getByText('TR-000001').closest('tr');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Depósito Central');
    expect(row!.textContent).toContain('Sucursal Norte');
    expect(row!.textContent).toContain('Borrador');
  });

  it('oculta "Nueva transferencia" sin permiso de creación', () => {
    mocks.permissions = ['inventory.transfers.read'];
    render(<TransferenciasPage />);
    expect(screen.queryByText('Nueva transferencia')).toBeNull();
  });

  it('ofrece "Nueva transferencia" con permiso de creación', () => {
    render(<TransferenciasPage />);
    expect(screen.getByText('Nueva transferencia')).toBeTruthy();
  });
});

describe('Transferencias — detalle', () => {
  it('un borrador ofrece editar, confirmar y anular', () => {
    render(<TransferenciaDetailPage />);
    expect(screen.getByText('Editar')).toBeTruthy();
    expect(screen.getByText('Confirmar')).toBeTruthy();
    expect(screen.getByText('Anular borrador')).toBeTruthy();
  });

  it('una transferencia confirmada no se puede editar ni volver a confirmar', () => {
    mocks.detail = detail({ status: 'CONFIRMED', confirmedAt: '2026-09-14T11:00:00.000Z' });
    render(<TransferenciaDetailPage />);
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Confirmar')).toBeNull();
    // Sí se puede anular, y el texto cambia: ya no es un borrador.
    expect(screen.getByText('Anular transferencia')).toBeTruthy();
  });

  it('una transferencia anulada no ofrece ninguna acción', () => {
    mocks.detail = detail({ status: 'CANCELLED', cancelledAt: '2026-09-14T12:00:00.000Z' });
    render(<TransferenciaDetailPage />);
    expect(screen.queryByText('Editar')).toBeNull();
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(screen.queryByText('Anular borrador')).toBeNull();
    expect(screen.queryByText('Anular transferencia')).toBeNull();
  });

  it('oculta Confirmar sin inventory.transfers.confirm', () => {
    mocks.permissions = ALL_PERMISSIONS.filter((p) => p !== 'inventory.transfers.confirm');
    render(<TransferenciaDetailPage />);
    expect(screen.queryByText('Confirmar')).toBeNull();
    expect(screen.getByText('Editar')).toBeTruthy();
  });

  it('oculta Anular sin inventory.transfers.cancel', () => {
    mocks.permissions = ALL_PERMISSIONS.filter((p) => p !== 'inventory.transfers.cancel');
    render(<TransferenciaDetailPage />);
    expect(screen.queryByText('Anular borrador')).toBeNull();
    expect(screen.getByText('Confirmar')).toBeTruthy();
  });

  it('confirmar pide confirmación y nombra ambos depósitos', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TransferenciaDetailPage />);

    fireEvent.click(screen.getByText('Confirmar'));

    const prompt = confirmSpy.mock.calls[0][0] as string;
    expect(prompt).toContain('Depósito Central');
    expect(prompt).toContain('Sucursal Norte');
    await waitFor(() => expect(mocks.confirmMutate).toHaveBeenCalledWith('transfer-1'));
  });

  it('no confirma nada si el usuario cancela el diálogo', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TransferenciaDetailPage />);

    fireEvent.click(screen.getByText('Confirmar'));

    expect(mocks.confirmMutate).not.toHaveBeenCalled();
  });

  it('anular una confirmada avisa que se generan movimientos compensatorios', async () => {
    mocks.detail = detail({ status: 'CONFIRMED', confirmedAt: '2026-09-14T11:00:00.000Z' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TransferenciaDetailPage />);

    fireEvent.click(screen.getByText('Anular transferencia'));

    const prompt = confirmSpy.mock.calls[0][0] as string;
    expect(prompt).toContain('compensatorios');
    expect(prompt).toContain('Depósito Central');
    await waitFor(() => expect(mocks.cancelMutate).toHaveBeenCalledWith('transfer-1'));
  });

  it('anular un borrador aclara que todavía no hubo movimientos', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TransferenciaDetailPage />);

    fireEvent.click(screen.getByText('Anular borrador'));

    const prompt = confirmSpy.mock.calls[0][0] as string;
    expect(prompt).toContain('No se generó ningún movimiento');
    expect(prompt).not.toContain('compensatorios');
  });

  it('muestra el error del servidor si la confirmación falla', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.confirmMutate = vi.fn().mockRejectedValue(
      Object.assign(new Error('conflict'), {
        code: 'INSUFFICIENT_STOCK',
        body: { error: { code: 'INSUFFICIENT_STOCK' } },
      }),
    );
    render(<TransferenciaDetailPage />);

    fireEvent.click(screen.getByText('Confirmar'));

    // El mensaje exacto lo decide stockErrorMessage; lo que importa es que
    // el fallo se muestre en pantalla en vez de perderse en silencio.
    await waitFor(() => {
      const alerts = screen.getAllByText(/stock|error|intent/i);
      expect(alerts.length).toBeGreaterThan(0);
    });
  });
});
