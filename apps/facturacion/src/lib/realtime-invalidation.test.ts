import { describe, it, expect } from 'vitest';
import { invalidationKeysFor } from '@erp/auth-client';

/**
 * The event → TanStack Query invalidation mapping is the main frontend
 * behavior this milestone adds (see docs/desktop-lan-architecture.md
 * "Realtime architecture"). Every expected key here is copy-pasted from
 * the exact prefix the corresponding domain's own local-mutation hooks
 * already invalidate (sales-hooks.ts/inventory-hooks.ts/customers-hooks.ts/
 * products-hooks.ts/pricing-hooks.ts/dashboard-hooks.ts) — this test
 * exists to catch drift between the two, not to re-derive the mapping.
 */
describe('realtime invalidationKeysFor', () => {
  const companyId = 'company-1';
  const otherCompanyId = 'company-2';

  it('sale.confirmed invalidates sales and the dashboard summary, scoped to the event company', () => {
    const keys = invalidationKeysFor('sale.confirmed', { companyId, saleId: 'sale-1' });
    expect(keys).toContainEqual(['company', companyId, 'sales']);
    expect(keys).toContainEqual(['company', companyId, 'dashboard', 'summary']);
    expect(keys.flat()).not.toContain(otherCompanyId);
  });

  it('sale.cancelled invalidates the same keys as sale.confirmed', () => {
    const keys = invalidationKeysFor('sale.cancelled', { companyId, saleId: 'sale-1' });
    expect(keys).toContainEqual(['company', companyId, 'sales']);
    expect(keys).toContainEqual(['company', companyId, 'dashboard', 'summary']);
  });

  it('stock.changed invalidates the broad inventory prefix (stock, movements, adjustments, product/variant-stock in one key)', () => {
    const keys = invalidationKeysFor('stock.changed', {
      companyId,
      warehouseId: 'wh-1',
      productVariantId: 'variant-1',
    });
    expect(keys).toEqual([['company', companyId, 'inventory']]);
  });

  it('customer.updated invalidates list, lookup, and the specific customer detail key', () => {
    const keys = invalidationKeysFor('customer.updated', { companyId, customerId: 'cust-1' });
    expect(keys).toContainEqual(['company', companyId, 'customers', 'list']);
    expect(keys).toContainEqual(['company', companyId, 'customers', 'lookup']);
    expect(keys).toContainEqual(['company', companyId, 'customers', 'detail', 'cust-1']);
  });

  it('product.updated invalidates list, lookup, the specific product detail key, and inventory lookup (Facturación/POS search)', () => {
    const keys = invalidationKeysFor('product.updated', { companyId, productId: 'prod-1' });
    expect(keys).toContainEqual(['company', companyId, 'products', 'list']);
    expect(keys).toContainEqual(['company', companyId, 'products', 'lookup']);
    expect(keys).toContainEqual(['company', companyId, 'products', 'detail', 'prod-1']);
    expect(keys).toContainEqual(['company', companyId, 'inventory', 'lookup']);
  });

  it('price.changed invalidates the broad pricing prefix regardless of whether a productVariantId is present', () => {
    const withVariant = invalidationKeysFor('price.changed', {
      companyId,
      priceListId: 'pl-1',
      productVariantId: 'variant-1',
    });
    const withoutVariant = invalidationKeysFor('price.changed', {
      companyId,
      priceListId: 'pl-1',
    });
    expect(withVariant).toEqual([['company', companyId, 'pricing']]);
    expect(withoutVariant).toEqual([['company', companyId, 'pricing']]);
  });

  it('never mixes a different company id into the returned keys', () => {
    const keys = invalidationKeysFor('customer.updated', {
      companyId: otherCompanyId,
      customerId: 'cust-9',
    });
    for (const key of keys) {
      expect(key[1]).toBe(otherCompanyId);
      expect(key).not.toContain(companyId);
    }
  });
});
