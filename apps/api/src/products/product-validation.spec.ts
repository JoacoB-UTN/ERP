import { createProductSchema, productCodeInputSchema } from '@erp/shared';

/**
 * Mandatory inventory-configuration and barcode-format unit coverage —
 * see docs/products.md ("Inventory configuration (not inventory)") and
 * the task spec's "Tests — service rules" / "Tests — lot/serial
 * configuration" sections. packages/shared has no test runner configured
 * (same precedent as tax-id.spec.ts), so this lives in apps/api.
 */
describe('createProductSchema — inventory configuration rules', () => {
  const base = {
    name: 'Test Product',
    baseUnitId: '11111111-1111-1111-1111-111111111111',
  };

  it('rejects a SERVICE that explicitly requests trackInventory: true', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'SERVICE',
      trackInventory: true,
    });
    expect(result.success).toBe(false);
  });

  it('defaults trackInventory to false for a SERVICE when omitted', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'SERVICE',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trackInventory).toBe(false);
  });

  it('defaults trackInventory to true for a PRODUCT when omitted', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'PRODUCT',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trackInventory).toBe(true);
  });

  it('rejects trackLots: true when the effective trackInventory is false', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'PRODUCT',
      trackInventory: false,
      trackLots: true,
    });
    expect(result.success).toBe(false);
  });

  it('accepts trackLots: true when trackInventory is true', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'PRODUCT',
      trackInventory: true,
      trackLots: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects trackSerials: true for a SERVICE (effective trackInventory resolves to false)', () => {
    const result = createProductSchema.safeParse({
      ...base,
      productType: 'SERVICE',
      trackSerials: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload that mixes the simple-product SKU field with an explicit variants array', () => {
    const result = createProductSchema.safeParse({
      ...base,
      sku: 'SOME-SKU',
      variants: [{ name: 'Negro / M', codes: [] }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a plain simple product with no variants and no SKU', () => {
    const result = createProductSchema.safeParse(base);
    expect(result.success).toBe(true);
  });
});

describe('productCodeInputSchema — barcode formatting', () => {
  it('preserves leading zeros in a barcode (never coerced to a number)', () => {
    const result = productCodeInputSchema.safeParse({
      type: 'BARCODE',
      code: '00012345',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe('00012345');
  });

  it('trims surrounding whitespace but leaves internal formatting untouched', () => {
    const result = productCodeInputSchema.safeParse({
      type: 'BARCODE',
      code: '  7791234567890  ',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.code).toBe('7791234567890');
  });

  it('accepts non-numeric alphanumeric codes (e.g. Code 128 / internal codes)', () => {
    const result = productCodeInputSchema.safeParse({
      type: 'INTERNAL',
      code: 'DEP-044-A',
    });
    expect(result.success).toBe(true);
  });
});
