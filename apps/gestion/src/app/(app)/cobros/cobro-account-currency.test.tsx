import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import NuevoCobroPage from '@/app/(app)/cobros/nuevo/page';

/**
 * The Cobro form's account selector, against the one rule Treasury will not
 * bend: the money has to land in an account held in the document's currency
 * (docs/treasury.md). The API rejects the pair outright, so anything this
 * screen offers that the API would refuse is a form built to fail on submit.
 *
 * Two behaviours are load-bearing, and the second is the one that actually
 * bit: filtering the list is not enough if a selection made *before* the
 * currency changed survives it. A field that looks filled and then fails is
 * worse than an empty one.
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
  useCustomerLookup: () => ({ data: { items: [] }, isLoading: false }),
  useCustomerOpenSales: () => ({ data: undefined, isLoading: false }),
  useCreateCustomerCollection: () => ({
    mutateAsync: mocks.createMutate,
    isPending: false,
  }),
  useTreasuryAccountOptions: () => ({
    data: { accounts: mocks.accounts },
    isLoading: false,
    isError: false,
  }),
}));

function account(id: string, name: string, currencyId: string, currencyCode: string) {
  return { id, code: id, name, type: 'CASH_BOX', currencyId, currencyCode, active: true };
}

beforeEach(() => {
  mocks.accounts = [
    account('acc-ars', 'Caja pesos', ARS, 'ARS'),
    account('acc-usd', 'Caja dólares', USD, 'USD'),
  ];
});

afterEach(cleanup);

function selector(): HTMLSelectElement {
  return screen.getByLabelText('Cuenta de tesorería') as HTMLSelectElement;
}

/**
 * The offered accounts, by id. Read off the `<option>` values rather than
 * matched by label: each option renders `{name} ({code})` across several
 * text nodes, which `getByText` will not match as one string.
 */
function offered(): string[] {
  return Array.from(selector().options)
    .map((option) => option.value)
    .filter((value) => value !== '');
}

describe('Cobro · cuenta de tesorería y moneda', () => {
  it('offers only the accounts held in the selected currency', () => {
    render(<NuevoCobroPage />);

    // ARS is the first currency, so it is the one in force.
    expect(offered()).toEqual(['acc-ars']);
  });

  it('follows the currency when it changes', () => {
    render(<NuevoCobroPage />);
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: USD } });

    expect(offered()).toEqual(['acc-usd']);
  });

  it('drops an account the new currency no longer allows', () => {
    // The defect worth a test of its own. Choosing the peso box and then
    // switching to dollars used to leave `treasuryAccountId` pointing at the
    // peso box: the select rendered blank because no option matched, but the
    // value was still there and went out with the submit.
    render(<NuevoCobroPage />);
    fireEvent.change(selector(), { target: { value: 'acc-ars' } });
    expect(selector().value).toBe('acc-ars');

    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: USD } });
    expect(selector().value).toBe('');
  });

  it('keeps an account that is valid in both, rather than clearing on any change', () => {
    mocks.accounts = [
      account('acc-ars', 'Caja pesos', ARS, 'ARS'),
      account('acc-ars-2', 'Caja pesos chica', ARS, 'ARS'),
    ];
    render(<NuevoCobroPage />);
    fireEvent.change(selector(), { target: { value: 'acc-ars-2' } });

    // Re-selecting the same currency must not wipe a valid choice.
    fireEvent.change(screen.getByLabelText('Moneda'), { target: { value: ARS } });
    expect(selector().value).toBe('acc-ars-2');
  });

  it('distinguishes "none loaded" from "none in this currency"', () => {
    mocks.accounts = [account('acc-usd', 'Caja dólares', USD, 'USD')];
    render(<NuevoCobroPage />);

    // ARS is in force and only a USD box exists: saying "none loaded" here
    // would send the operator to create an account they already have.
    expect(screen.getByText(/Ninguna caja ni cuenta bancaria/)).toBeTruthy();
    expect(screen.queryByText(/cargadas todavía/)).toBeNull();

    cleanup();
    mocks.accounts = [];
    render(<NuevoCobroPage />);
    expect(screen.getByText(/cargadas todavía/)).toBeTruthy();
  });
});
