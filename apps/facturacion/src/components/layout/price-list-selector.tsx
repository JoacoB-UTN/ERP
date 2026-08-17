'use client';

import { ChevronDown } from 'lucide-react';
import { useActivePriceList, usePermissions } from '@/lib/auth-client';
import { ContextField } from './context-field';

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
  const {
    isLoading,
    priceLists,
    activePriceListId,
    activePriceList,
    setActivePriceList,
    hasNoEligibleLists,
  } = useActivePriceList();

  if (permissionsLoading || !can('pricing.prices.read')) {
    return null;
  }
  if (isLoading) {
    return null;
  }

  if (hasNoEligibleLists) {
    return (
      <ContextField label="Lista de precios" className="min-w-36">
        <span
          className="rounded-md bg-warning-muted px-2 py-1 text-xs font-medium text-warning"
          title="Ninguna lista de precios activa en esta empresa"
        >
          Sin lista de precios
        </span>
      </ContextField>
    );
  }

  if (priceLists.length === 1) {
    return (
      <ContextField label="Lista de precios" className="min-w-36">
        <span className="max-w-44 truncate">{activePriceList?.name}</span>
      </ContextField>
    );
  }

  return (
    <ContextField label="Lista de precios" className="min-w-36">
      <div className="relative inline-flex min-w-0 items-center">
        <select
          aria-label="Lista de precios activa"
          value={activePriceListId ?? ''}
          onChange={(e) => setActivePriceList(e.target.value || null)}
          className="h-7 max-w-48 appearance-none rounded-md border border-border bg-card py-0 pl-2 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
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
        <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
      </div>
    </ContextField>
  );
}
