'use client';

import { useState } from 'react';
import { useInventoryLookup } from '@/lib/auth-client';

export interface VariantPickerSelection {
  variantId: string;
  productId: string;
  label: string;
  sku: string | null;
  productType: string;
}

/**
 * Search-as-you-type variant picker for adjustment/initial-balance lines —
 * built on the inventory-aware lookup (see docs/inventory.md) rather than
 * the plain product lookup, so it can eventually surface `available` per
 * warehouse. Service products are filtered out client-side by default (a
 * UX shortcut — the backend independently rejects non-trackable products
 * with `PRODUCT_DOES_NOT_TRACK_INVENTORY` regardless of what this shows);
 * pass `allowServices` for callers like Sales where a SERVICE line is
 * legitimate.
 */
export function VariantPicker({
  warehouseId,
  excludeVariantIds = [],
  allowServices = false,
  onSelect,
}: {
  warehouseId: string | null;
  excludeVariantIds?: string[];
  /** Sales lines may include non-inventory SERVICE products (see docs/sales.md); adjustment/initial-balance lines never can. */
  allowServices?: boolean;
  onSelect: (selection: VariantPickerSelection) => void;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);

  const lookupQuery = useInventoryLookup(
    { search: term.trim() || undefined, warehouseId: warehouseId ?? undefined, limit: 8 },
    { enabled: term.trim().length > 0 },
  );
  const items = (lookupQuery.data?.items ?? []).filter(
    (item) => (allowServices || item.productType !== 'SERVICE') && !excludeVariantIds.includes(item.variantId),
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar producto por nombre, SKU o código…"
        className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {open && term.trim() && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md">
          {items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {lookupQuery.isLoading ? 'Buscando…' : 'Sin resultados.'}
            </p>
          )}
          {items.map((item) => (
            <button
              key={item.variantId}
              type="button"
              className="flex w-full flex-col items-start px-3 py-1.5 text-left text-sm hover:bg-muted"
              onMouseDown={(e) => {
                // Prevent the input's onBlur from closing the list before the click registers.
                e.preventDefault();
                onSelect({
                  variantId: item.variantId,
                  productId: item.productId,
                  label: item.variantName ? `${item.name} · ${item.variantName}` : item.name,
                  sku: item.sku,
                  productType: item.productType,
                });
                setTerm('');
                setOpen(false);
              }}
            >
              <span className="font-medium">
                {item.name}
                {item.variantName ? ` · ${item.variantName}` : ''}
              </span>
              {item.sku && <span className="text-xs text-muted-foreground">{item.sku}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
