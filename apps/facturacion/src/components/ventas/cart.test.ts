import { describe, expect, it } from 'vitest';
import { computeCartTotals, toSaleLineInputs, type SaleLineDraft } from './cart';

function line(overrides: Partial<SaleLineDraft> = {}): SaleLineDraft {
  return {
    key: 'k1',
    variantId: 'v1',
    label: 'Producto',
    sku: 'SKU-1',
    productType: 'PRODUCT',
    quantity: '1',
    discountPercentage: '0',
    ...overrides,
  };
}

describe('computeCartTotals', () => {
  it('sums a single priced line with no discount', () => {
    const totals = computeCartTotals([line({ quantity: '2' })], { v1: '100' });
    expect(totals.subtotal).toBe(200);
    expect(totals.discountTotal).toBe(0);
    expect(totals.total).toBe(200);
    expect(totals.allPriced).toBe(true);
  });

  it('applies a line discount percentage', () => {
    const totals = computeCartTotals(
      [line({ quantity: '2', discountPercentage: '10' })],
      { v1: '100' },
    );
    expect(totals.subtotal).toBe(180);
    expect(totals.discountTotal).toBe(20);
    expect(totals.total).toBe(180);
  });

  it('excludes a line with no resolved price and flags allPriced=false', () => {
    const totals = computeCartTotals([line({ variantId: 'v2' })], { v2: null });
    expect(totals.subtotal).toBe(0);
    expect(totals.allPriced).toBe(false);
  });

  it('treats a price not yet present in the map (still loading) as unpriced', () => {
    const totals = computeCartTotals([line({ variantId: 'v3' })], {});
    expect(totals.allPriced).toBe(false);
    expect(totals.subtotal).toBe(0);
  });

  it('sums multiple lines, mixing priced and unpriced', () => {
    const totals = computeCartTotals(
      [
        line({ key: 'a', variantId: 'v1', quantity: '3' }),
        line({ key: 'b', variantId: 'v2', quantity: '1' }),
      ],
      { v1: '10', v2: null },
    );
    expect(totals.subtotal).toBe(30);
    expect(totals.allPriced).toBe(false);
  });

  it('handles fractional quantities (e.g. weighed goods) without rounding', () => {
    const totals = computeCartTotals([line({ quantity: '0.5' })], { v1: '3' });
    expect(totals.subtotal).toBe(1.5);
  });
});

describe('toSaleLineInputs', () => {
  it('maps draft fields to the sales API input shape', () => {
    const inputs = toSaleLineInputs([line({ quantity: '4', discountPercentage: '15' })]);
    expect(inputs).toEqual([{ productVariantId: 'v1', quantity: '4', discountPercentage: '15' }]);
  });

  it('defaults an empty discount to "0" rather than submitting a blank string', () => {
    const inputs = toSaleLineInputs([line({ discountPercentage: '' })]);
    expect(inputs[0].discountPercentage).toBe('0');
  });
});
