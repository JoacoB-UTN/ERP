import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { formatMoney } from '@erp/shared';
import { PosWorkspace } from './pos-workspace';

/**
 * Regression coverage for the checkout-snapshot-consistency fix (see the
 * `checkoutSaleId` comment in `pos-workspace.tsx` and docs/pos.md): the
 * total the operator approves in `PaymentPanel` must be the exact total
 * the backend confirms. These tests fail against the previous
 * implementation, which called `persistDraft()` a second time inside
 * `handleCheckoutConfirm` — that second call is asserted against
 * directly below (never a second `createSale`/`updateSale` call between
 * opening checkout and a successful/failed confirm).
 *
 * `ProductSearch`/`CustomerPicker` are replaced with minimal test
 * doubles — their own search/selection behavior is covered by their own
 * tests and isn't what this file is about; only their `onSelect` contract
 * matters here.
 */

const mocks = vi.hoisted(() => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  confirmSale: vi.fn(),
  companyId: 'company-1',
}));

vi.mock('@/lib/auth-client', () => ({
  usePermissions: () => ({ can: () => true, isLoading: false }),
  useActiveWarehouse: () => ({
    activeWarehouseId: 'warehouse-1',
    isLoading: false,
    hasNoEligibleWarehouses: false,
  }),
  useActivePriceList: () => ({
    activePriceListId: 'price-list-1',
    activePriceList: { id: 'price-list-1', currencyCode: 'ARS' },
    isLoading: false,
    hasNoEligibleLists: false,
  }),
  useActiveCompanyId: () => mocks.companyId,
  useCreateSale: () => ({ mutateAsync: mocks.createSale }),
  useUpdateSale: () => ({ mutateAsync: mocks.updateSale }),
  useConfirmSale: () => ({ mutateAsync: mocks.confirmSale }),
  apiFetch: vi.fn(async (url: string) => {
    if (url.includes('/pricing/lookup/batch')) {
      return { items: [], currencyCode: 'ARS' };
    }
    throw new Error(`unexpected apiFetch call in pos-workspace test: ${url}`);
  }),
}));

vi.mock('next/link', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ventas/product-search', () => ({
  ProductSearch: ({ onSelect }: { onSelect: (s: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          variantId: 'variant-1',
          productId: 'product-1',
          label: 'Café 1 kg',
          sku: 'CAFE-1KG',
          productType: 'PRODUCT',
        })
      }
    >
      add-product
    </button>
  ),
}));

vi.mock('@/components/ventas/customer-picker', () => ({
  CustomerPicker: ({
    value,
    onSelect,
  }: {
    value: { displayName: string } | null;
    onSelect: (s: unknown) => void;
  }) =>
    value ? (
      <div>{value.displayName}</div>
    ) : (
      <button
        type="button"
        onClick={() =>
          onSelect({
            customerId: 'customer-1',
            displayName: 'Consumidor Final',
            code: '000001',
            taxId: null,
            taxCondition: null,
          })
        }
      >
        select-customer
      </button>
    ),
}));

function fakeConfirmedSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sale-A',
    number: 'VTA-000001',
    documentType: 'SALE',
    status: 'CONFIRMED',
    occurredAt: '2026-08-16T00:00:00.000Z',
    customer: { id: 'customer-1', code: '000001', legalName: 'Consumidor Final' },
    warehouse: { id: 'warehouse-1', code: 'CENTRAL', name: 'Depósito Central' },
    priceList: { id: 'price-list-1', code: 'MIN', name: 'Minorista' },
    currencyCode: 'ARS',
    total: '22000',
    lineCount: 1,
    createdBy: null,
    branchId: null,
    subtotal: '22000',
    discountTotal: '0',
    taxTotal: '0',
    notes: null,
    lines: [],
    tender: null,
    createdAt: '2026-08-16T00:00:00.000Z',
    confirmedAt: '2026-08-16T00:00:01.000Z',
    confirmedBy: null,
    cancelledAt: null,
    cancelledBy: null,
    ...overrides,
  };
}

/** Product + customer, the minimum state `validate()` requires to open checkout. */
async function fillCart() {
  fireEvent.click(screen.getByText('add-product'));
  fireEvent.click(screen.getByText('select-customer'));
  await screen.findByText('Consumidor Final');
}

function openCheckout() {
  fireEvent.keyDown(window, { key: 'F10' });
}

beforeEach(() => {
  mocks.createSale.mockReset();
  mocks.updateSale.mockReset();
  mocks.confirmSale.mockReset();
  mocks.companyId = 'company-1';
});

// vitest auto-cleanup isn't configured globally in this project (no
// setupFiles) — clean up the DOM between tests explicitly instead.
afterEach(() => cleanup());

describe('PosWorkspace checkout snapshot consistency', () => {
  it('TEST A — freezes persistence: confirm does not re-persist, and confirms the frozen id', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);

    await fillCart();
    openCheckout();

    await screen.findByText('Confirmar y cobrar');
    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).not.toHaveBeenCalled();
    // The frozen total is on screen before any confirmation happens.
    expect(screen.getByText(formatMoney('22000', 'ARS'))).toBeTruthy();

    fireEvent.click(screen.getByText('Tarjeta'));
    mocks.confirmSale.mockResolvedValueOnce({ salesDocument: fakeConfirmedSale({ total: '22000' }) });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));

    await screen.findByText('Venta confirmada');

    // Persistence happened exactly once, for opening checkout — never
    // again during final confirmation.
    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).not.toHaveBeenCalled();
    expect(mocks.confirmSale).toHaveBeenCalledTimes(1);
    expect(mocks.confirmSale).toHaveBeenCalledWith({ id: 'sale-A', tender: { method: 'CARD' } });
  });

  it('TEST B — cancel/edit/reopen: a fresh snapshot at a new total is what gets confirmed', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);

    await fillCart();
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText('Confirmar y cobrar')).toBeNull());

    // Modify the cart (bump the existing line via the same test double —
    // addLine increments quantity for an existing variantId).
    fireEvent.click(screen.getByText('add-product'));

    mocks.updateSale.mockResolvedValueOnce({ salesDocument: { total: '25000' } });
    openCheckout();

    await waitFor(() => expect(mocks.updateSale).toHaveBeenCalledTimes(1));
    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).toHaveBeenCalledWith({
      id: 'sale-A',
      input: expect.objectContaining({ customerId: 'customer-1' }),
    });

    // The panel now shows the NEW canonical total, not the stale one.
    await screen.findByText(formatMoney('25000', 'ARS'));
    expect(screen.queryByText(formatMoney('22000', 'ARS'))).toBeNull();

    mocks.confirmSale.mockResolvedValueOnce({ salesDocument: fakeConfirmedSale({ total: '25000' }) });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));
    await screen.findByText('Venta confirmada');

    // Still exactly one create + one update — final confirm persisted nothing.
    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).toHaveBeenCalledTimes(1);
    expect(mocks.confirmSale).toHaveBeenCalledWith({
      id: 'sale-A',
      tender: expect.objectContaining({ method: 'CASH' }),
    });
  });

  it('TEST C — the editable draft survives cancel, but the checkout snapshot does not', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);

    await fillCart();
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    fireEvent.click(screen.getByText('Cancelar'));
    await waitFor(() => expect(screen.queryByText('Confirmar y cobrar')).toBeNull());

    // Reopening WITHOUT editing the cart still must not reuse a stale
    // in-memory total — it re-persists the (unchanged) draft and gets a
    // fresh snapshot back from the backend, proving the checkout state
    // was actually discarded rather than merely hidden.
    mocks.updateSale.mockResolvedValueOnce({ salesDocument: { total: '22000' } });
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    // The DRAFT (savedSaleId) was reused for an UPDATE, not a fresh CREATE.
    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).toHaveBeenCalledWith({ id: 'sale-A', input: expect.anything() });
  });

  it('TEST D — CASH: change is computed off the frozen total, and confirm does not re-persist', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);

    await fillCart();
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    const receivedInput = screen.getByLabelText('Importe recibido');
    fireEvent.change(receivedInput, { target: { value: '25000' } });

    await screen.findByText(formatMoney('3000', 'ARS'));

    mocks.confirmSale.mockResolvedValueOnce({ salesDocument: fakeConfirmedSale({ total: '22000' }) });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));
    await screen.findByText('Venta confirmada');

    expect(mocks.createSale).toHaveBeenCalledTimes(1);
    expect(mocks.updateSale).not.toHaveBeenCalled();
    expect(mocks.confirmSale).toHaveBeenCalledWith({
      id: 'sale-A',
      tender: { method: 'CASH', amountReceived: '25000' },
    });
  });

  it('TEST E — reset: success, cancel, and Nueva venta all discard the checkout snapshot', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);

    await fillCart();
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    fireEvent.click(screen.getByText('Tarjeta'));
    mocks.confirmSale.mockResolvedValueOnce({ salesDocument: fakeConfirmedSale({ total: '22000' }) });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));
    await screen.findByText('Venta confirmada');

    fireEvent.click(screen.getByText('Nueva venta'));
    await waitFor(() => expect(screen.queryByText('Venta confirmada')).toBeNull());

    // A brand-new sale — a fresh product/customer round-trip must create
    // a NEW draft, never resurrect the confirmed one.
    fireEvent.click(screen.getByText('add-product'));
    // Customer persists across sales in POS (see docs/pos.md) — no need
    // to re-select it.
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-B', total: '22000' } });
    openCheckout();

    await waitFor(() => expect(mocks.createSale).toHaveBeenCalledTimes(2));
    expect(mocks.updateSale).not.toHaveBeenCalled();

    mocks.confirmSale.mockResolvedValueOnce({
      salesDocument: fakeConfirmedSale({ id: 'sale-B', number: 'VTA-000002', total: '22000' }),
    });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));
    await screen.findByText('Venta confirmada');
    expect(mocks.confirmSale).toHaveBeenLastCalledWith({ id: 'sale-B', tender: expect.anything() });
  });

  it('TEST E (company switch) — a company change discards any in-flight checkout snapshot', async () => {
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    const { rerender } = render(<PosWorkspace />);

    await fillCart();
    openCheckout();
    await screen.findByText('Confirmar y cobrar');

    mocks.companyId = 'company-2';
    rerender(<PosWorkspace />);

    await waitFor(() => expect(screen.queryByText('Confirmar y cobrar')).toBeNull());
    expect(screen.queryByText('Consumidor Final')).toBeNull();
  });
});
