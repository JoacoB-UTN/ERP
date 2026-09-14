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
  // Shape of a react-query result, only the fields PosWorkspace reads.
  // Default is "still in flight", which is what the checkout-snapshot
  // tests below want: they select a customer by hand, exactly as before
  // the walk-in resolver existed.
  customerLookup: { isSuccess: false, isError: false, data: undefined } as {
    isSuccess: boolean;
    isError: boolean;
    data: { items: unknown[] } | undefined;
  },
  // Per-company results. The real `useCustomerLookup` keys its query by
  // the active company, so switching companies yields a *different* cache
  // entry — pending until that company's own request lands, never the
  // previous company's rows. Tests that care about a company switch set
  // this; everything else falls back to `customerLookup` above.
  customerLookupByCompany: {} as Record<
    string,
    { isSuccess: boolean; isError: boolean; data: { items: unknown[] } | undefined }
  >,
  // `null` = every permission granted, which is what all the pre-existing
  // tests assume. A test that cares sets an explicit list.
  permissions: null as string[] | null,
  // The options `PosWorkspace` last passed to `useCustomerLookup`, so a
  // test can assert the query was never enabled rather than only that no
  // customer appeared — those are different failures.
  lastLookupOptions: undefined as { enabled?: boolean } | undefined,
}));

vi.mock('@/lib/auth-client', () => ({
  usePermissions: () => ({
    can: (code: string) => mocks.permissions === null || mocks.permissions.includes(code),
    isLoading: false,
  }),
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
  useCustomerLookup: (_query: unknown, options?: { enabled?: boolean }) => {
    mocks.lastLookupOptions = options;
    // A disabled react-query never resolves and carries no data. Modelling
    // that matters: a mock that handed back rows regardless of `enabled`
    // would let a component that forgot the permission gate still pass.
    if (options?.enabled === false) {
      return { isSuccess: false, isError: false, data: undefined };
    }
    return mocks.customerLookupByCompany[mocks.companyId] ?? mocks.customerLookup;
  },
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

// Only the component is doubled. `toSelection` is kept REAL — PosWorkspace
// uses it to turn a lookup row into a selection, and a re-implementation
// here would test the copy instead of the mapping that ships.
vi.mock('@/components/ventas/customer-picker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ventas/customer-picker')>()),
  CustomerPicker: ({
    value,
    onSelect,
  }: {
    value: { displayName: string; customerId: string } | null;
    onSelect: (s: unknown) => void;
  }) =>
    value ? (
      <div data-testid="selected-customer" data-customer-id={value.customerId}>
        {value.displayName}
      </div>
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
  mocks.customerLookup = { isSuccess: false, isError: false, data: undefined };
  mocks.customerLookupByCompany = {};
  mocks.permissions = null;
  mocks.lastLookupOptions = undefined;
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

/**
 * The walk-in customer POS starts a sale with — see `default-customer.ts`
 * and docs/pos.md. What matters here is not that it selects something,
 * but that it only ever selects the *right* something and then gets out
 * of the operator's way: a wrong auto-selection silently invoices a
 * counter sale to another account.
 */
function cfItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'customer-cf',
    code: '000001',
    displayName: 'Consumidor Final',
    legalName: 'Consumidor Final',
    taxId: null,
    taxCondition: 'CONSUMIDOR_FINAL',
    status: 'ACTIVE',
    ...overrides,
  };
}

function resolvedWith(items: unknown[]) {
  return { isSuccess: true, isError: false, data: { items } };
}

/** The selected customer's id, or `null` when no customer is selected. */
function selectedCustomerId() {
  return screen.queryByTestId('selected-customer')?.getAttribute('data-customer-id') ?? null;
}

describe('PosWorkspace default (walk-in) customer', () => {
  it('selects the exact 000001 + CONSUMIDOR_FINAL match on open', async () => {
    mocks.customerLookup = resolvedWith([cfItem()]);
    render(<PosWorkspace />);

    await screen.findByTestId('selected-customer');
    expect(selectedCustomerId()).toBe('customer-cf');
    // Selected, not merely offered: the manual search affordance is gone.
    expect(screen.queryByText('select-customer')).toBeNull();
  });

  it('leaves POS on manual selection when the company has no walk-in customer', async () => {
    mocks.customerLookup = resolvedWith([]);
    render(<PosWorkspace />);

    // The picker stays in its "nothing chosen" state and POS is usable.
    await screen.findByText('select-customer');
    expect(screen.queryByTestId('selected-customer')).toBeNull();

    fireEvent.click(screen.getByText('select-customer'));
    await screen.findByTestId('selected-customer');
    expect(selectedCustomerId()).toBe('customer-1');
  });

  it('never settles for a near-miss', async () => {
    mocks.customerLookup = resolvedWith([
      // Right code, wrong tax condition — a real company that happens to
      // hold the first customer code.
      cfItem({ id: 'wrong-condition', taxCondition: 'RESPONSABLE_INSCRIPTO' }),
      // Right tax condition, different code: an ordinary walk-in buyer.
      cfItem({ id: 'wrong-code', code: '000042' }),
      // The code only as a substring — what `contains` can return.
      cfItem({ id: 'substring-code', code: '0000010' }),
      // Right name, nothing else: displayName must never be the signal.
      cfItem({ id: 'name-only', code: '000099', taxCondition: 'EXENTO' }),
      // Right code and condition but INACTIVE.
      cfItem({ id: 'inactive', status: 'INACTIVE' }),
    ]);
    render(<PosWorkspace />);

    await screen.findByText('select-customer');
    expect(screen.queryByTestId('selected-customer')).toBeNull();
  });

  it('does not guess when two rows both match', async () => {
    mocks.customerLookup = resolvedWith([cfItem({ id: 'dup-a' }), cfItem({ id: 'dup-b' })]);
    render(<PosWorkspace />);

    await screen.findByText('select-customer');
    expect(screen.queryByTestId('selected-customer')).toBeNull();
  });

  it('keeps POS working when the lookup fails', async () => {
    mocks.customerLookup = { isSuccess: false, isError: true, data: undefined };
    render(<PosWorkspace />);

    await screen.findByText('select-customer');
    expect(screen.queryByTestId('selected-customer')).toBeNull();
    // And the cart still works — a failed lookup is not a broken POS.
    fireEvent.click(screen.getByText('add-product'));
    expect(await screen.findByText('Café 1 kg')).toBeTruthy();
  });

  it('drops the previous company default customer before resolving the new one', async () => {
    mocks.customerLookupByCompany = {
      'company-1': resolvedWith([cfItem({ id: 'cf-company-1' })]),
      // company-2 deliberately absent: the real hook keys its query by
      // company, so right after the switch there is nothing resolved yet.
    };
    const { rerender } = render(<PosWorkspace />);
    await screen.findByTestId('selected-customer');
    expect(selectedCustomerId()).toBe('cf-company-1');

    mocks.companyId = 'company-2';
    rerender(<PosWorkspace />);

    // No `waitFor`: the very first render of company 2 must already be
    // free of company 1's customer. An effect-based reset would only
    // clear it on a later pass, and this assertion is what catches that.
    expect(selectedCustomerId()).toBeNull();
    expect(screen.getByText('select-customer')).toBeTruthy();

    // Then company 2's own walk-in row lands and is selected.
    mocks.customerLookupByCompany['company-2'] = resolvedWith([cfItem({ id: 'cf-company-2' })]);
    rerender(<PosWorkspace />);
    await waitFor(() => expect(selectedCustomerId()).toBe('cf-company-2'));
  });

  it('drops a MANUALLY chosen customer on the first render of the new company', async () => {
    // The dangerous case: an explicit choice is state the operator made,
    // so it survives everything except a company switch — and it must not
    // survive that even for one paint.
    mocks.customerLookupByCompany = { 'company-1': resolvedWith([]) };
    const { rerender } = render(<PosWorkspace />);
    fireEvent.click(await screen.findByText('select-customer'));
    await screen.findByTestId('selected-customer');
    expect(selectedCustomerId()).toBe('customer-1');

    mocks.companyId = 'company-2';
    rerender(<PosWorkspace />);

    expect(selectedCustomerId()).toBeNull();
    expect(screen.queryByText('Consumidor Final')).toBeNull();

    // And company 2 starts over at "the operator has not decided yet", so
    // its own walk-in customer is free to fill the slot.
    mocks.customerLookupByCompany['company-2'] = resolvedWith([cfItem({ id: 'cf-company-2' })]);
    rerender(<PosWorkspace />);
    await waitFor(() => expect(selectedCustomerId()).toBe('cf-company-2'));
  });

  it('never asks for customers without customers.read', async () => {
    // A custom cashier role: can build and confirm a sale, cannot read the
    // customer list. `GET /customers/lookup` is guarded by `customers.read`,
    // so enabling the query here would fire a request that returns 403 the
    // moment POS opens.
    mocks.permissions = ['sales.documents.create', 'sales.documents.confirm'];
    mocks.customerLookup = resolvedWith([cfItem()]);
    render(<PosWorkspace />);

    await screen.findByText('select-customer');
    expect(mocks.lastLookupOptions?.enabled).toBe(false);
    // Asserted separately from `enabled` on purpose: a disabled query that
    // still auto-selected from cached data would be a different bug.
    expect(screen.queryByTestId('selected-customer')).toBeNull();
  });

  it('asks for customers when the role does hold customers.read', async () => {
    // The complement of the test above — otherwise `enabled: false`
    // everywhere would also pass it.
    mocks.permissions = ['sales.documents.create', 'sales.documents.confirm', 'customers.read'];
    mocks.customerLookup = resolvedWith([cfItem()]);
    render(<PosWorkspace />);

    await screen.findByTestId('selected-customer');
    expect(mocks.lastLookupOptions?.enabled).toBe(true);
    expect(selectedCustomerId()).toBe('customer-cf');
  });

  it('does not overwrite a customer the operator picked first', async () => {
    render(<PosWorkspace />);
    fireEvent.click(screen.getByText('select-customer'));
    await screen.findByTestId('selected-customer');
    expect(selectedCustomerId()).toBe('customer-1');

    // The walk-in lookup settles afterwards, offering a different row.
    mocks.customerLookup = resolvedWith([cfItem()]);
    fireEvent.click(screen.getByText('add-product'));
    await waitFor(() => expect(screen.getByText('Café 1 kg')).toBeTruthy());
    expect(selectedCustomerId()).toBe('customer-1');
  });

  it('does not re-select after the operator clears with F2', async () => {
    mocks.customerLookup = resolvedWith([cfItem()]);
    render(<PosWorkspace />);
    await screen.findByTestId('selected-customer');

    fireEvent.keyDown(window, { key: 'F2' });

    // Cleared, and it stays cleared — the resolver has had its one turn
    // for this company and must not fight the operator for the field.
    await screen.findByText('select-customer');
    fireEvent.click(screen.getByText('add-product'));
    await waitFor(() => expect(screen.getByText('Café 1 kg')).toBeTruthy());
    expect(screen.queryByTestId('selected-customer')).toBeNull();
  });

  it('keeps the customer through a sale and "Nueva venta"', async () => {
    mocks.customerLookup = resolvedWith([cfItem()]);
    mocks.createSale.mockResolvedValueOnce({ salesDocument: { id: 'sale-A', total: '22000' } });
    render(<PosWorkspace />);
    await screen.findByTestId('selected-customer');

    fireEvent.click(screen.getByText('add-product'));
    openCheckout();
    await screen.findByText('Confirmar y cobrar');
    fireEvent.click(screen.getByText('Tarjeta'));
    mocks.confirmSale.mockResolvedValueOnce({ salesDocument: fakeConfirmedSale({ total: '22000' }) });
    fireEvent.click(screen.getByText('Confirmar y cobrar'));
    await screen.findByText('Venta confirmada');

    fireEvent.click(screen.getByText('Nueva venta'));

    // Cart gone, customer still there — docs/pos.md's persistence rule,
    // unchanged by the resolver.
    await waitFor(() => expect(screen.queryByText('Café 1 kg')).toBeNull());
    expect(selectedCustomerId()).toBe('customer-cf');
  });
});
