'use client';

import { ChevronDown } from 'lucide-react';
import { useActivePriceList, usePermissions } from '@/lib/auth-client';

/**
 * Price-context FOUNDATION for a future Facturación/POS sales flow — see
 * docs/pricing.md. No cart/invoice/order/checkout functionality lives
 * here; this only resolves which price list a future sale would price
 * against. Company-scoped, not branch-scoped (a price list is never tied
 * to a specific branch — see CLAUDE.md), so unlike WarehouseSelector this
 * needs no parent id prop. Zero eligible (active) price lists renders a
 * visible empty state instead of hiding — same "the gap must be obvious,
 * not silent" reasoning as WarehouseSelector, since a future sales flow
 * cannot price anything without one. The remembered selection is UX-only:
 * the backend independently re-validates company+active on every real
 * pricing operation regardless of what this selector shows.
 */
export function PriceListSelector() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const { isLoading, priceLists, activePriceListId, activePriceList, setActivePriceList, hasNoEligibleLists } =
    useActivePriceList();

  if (permissionsLoading || !can('pricing.prices.read')) {
    return null;
  }
  if (isLoading) {
    return null;
  }

  if (hasNoEligibleLists) {
    return (
      <span
        className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"
        title="Ninguna lista de precios activa en esta empresa"
      >
        Sin lista de precios
      </span>
    );
  }

  if (priceLists.length === 1) {
    return <span className="text-sm text-muted-foreground">{activePriceList?.name}</span>;
  }

  return (
    <div className="relative inline-flex items-center">
      <select
        aria-label="Lista de precios activa"
        value={activePriceListId ?? ''}
        onChange={(e) => setActivePriceList(e.target.value || null)}
        className="appearance-none rounded-md border border-border bg-background py-1 pl-2 pr-7 text-sm text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {!activePriceListId && (
          <option value="" disabled>
            Elegir lista…
          </option>
        )}
        {priceLists.map((pl) => (
          <option key={pl.id} value={pl.id}>
            {pl.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
    </div>
  );
}
