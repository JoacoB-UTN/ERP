import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import NuevoPagoPage from '@/app/(app)/pagos/nuevo/page';

/**
 * The Pago form's mirror of the Cobro rule — see
 * `cobros/cobro-account-currency.test.tsx` for the reasoning, which is the
 * same on this side with the sign flipped.
 *
 * Covered separately rather than assumed: the two pages carry the same logic
 * in two files, which is exactly how one of them ends up fixed and the other
 * left behind. The backend defect this pairs with was duplicated in both
 * services for that reason.
 */

const ARS = 'currency-ars';
const USD = 'currency-usd';

const mocks = vi.hoisted(() => ({
  accounts: [] as unknown[],
  createMutate: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  usePermissions: () => ({ can: () => true, isLoading: false }),
  useCurrencies: () => ({
    data: {
      currencies: [
        { id: ARS, code: 'ARS', displayName: 'Peso argentino', symbol: '$' },
        { id: USD, code: 'USD', displayName: 'Dólar', symbol: 'US$' },
      ],
    },
    isLoading: false,
  }),
  useSupplierLookup: () => ({ data: { items: [] }, isLoading: false }),
  useSupplierOpenReceipts: () => ({ data: undefined, isLoading: false }),
  useCreateSupplierPayment: () => ({
    mutateAsync: mocks.createMutate,
    isPending: false,
  }),
  useTreasuryAccountOptions: () => ({
    data: { accounts: mocks.accounts },
    isLoading: false,
    isError: false,
  }),
}));

beforeEach(() => {
  mocks.accounts = [
    {
      id: 'acc-ars',
      code: 'acc-ars',
      name: 'Caja pesos',
      type: 'CASH_BOX',
      currencyId: ARS,
      currencyCode: 'ARS',
      active: true,
    },
    {
      id: 'acc-usd',
      code: 'acc-usd',
      name: 'Caja dólares',
      type: 'CASH_BOX',
      currencyId: USD,
      currencyCode: 'USD',
      active: true,
    },
  ];
});

afterEach(cleanup);

function selector(): HTMLSelectElement {
  return screen.getByLabelText('Cuenta de tesorería') as HTMLSelectElement;
}

function offered(): string[] {
  return Array.from(selector().options)
    .map((option) => option.value)
    .filter((value) => value !== '');
}

describe('Pago · cuenta de tesorería y moneda', () => {
  it('offers only the accounts held in the selected currency', () => {
    render(<NuevoPagoPage />);
    expect(offered()).toEqual(['acc-ars']);

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: USD } });
    expect(offered()).toEqual(['acc-usd']);
  });

  it('drops an account the new currency no longer allows', () => {
    render(<NuevoPagoPage />);
    fireEvent.change(selector(), { target: { value: 'acc-ars' } });
    expect(selector().value).toBe('acc-ars');

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: USD } });
    expect(selector().value).toBe('');
  });

  it('distinguishes "none loaded" from "none in this currency"', () => {
    mocks.accounts = [
      {
        id: 'acc-usd',
        code: 'acc-usd',
        name: 'Caja dólares',
        type: 'CASH_BOX',
        currencyId: USD,
        currencyCode: 'USD',
        active: true,
      },
    ];
    render(<NuevoPagoPage />);
    expect(screen.getByText(/Ninguna caja ni cuenta bancaria/)).toBeTruthy();
    expect(screen.queryByText(/cargadas todavía/)).toBeNull();
  });
});
