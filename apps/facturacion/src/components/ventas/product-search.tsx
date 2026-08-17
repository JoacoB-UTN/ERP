'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { formatMoney } from '@erp/shared';
import type { InventoryLookupItem, InventoryLookupResponse } from '@erp/shared';
import { useInventoryLookup, apiFetch } from '@/lib/auth-client';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { usePriceMap } from './use-price-map';

export interface ProductSearchSelection {
  variantId: string;
  productId: string;
  label: string;
  sku: string | null;
  productType: string;
}

export interface ProductSearchHandle {
  focus: () => void;
}

function toSelection(item: InventoryLookupItem): ProductSearchSelection {
  return {
    variantId: item.variantId,
    productId: item.productId,
    label: item.variantName ? `${item.name} · ${item.variantName}` : item.name,
    sku: item.sku,
    productType: item.productType,
  };
}

/** Debounces a value by `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * The core product-entry interaction — search by name/SKU/barcode, see
 * real price and warehouse availability, add to the sale. Built on the
 * shared inventory-aware lookup (`GET /inventory/lookup`, see
 * docs/inventory.md), never a duplicate query implementation.
 *
 * Barcode-scanner behavior (docs/facturacion.md): a scanner that types
 * fast and sends Enter is treated the same as manual typing — on Enter,
 * a fresh (non-debounced) lookup runs for the exact current text; exactly
 * one result adds immediately, zero shows "Producto no encontrado", more
 * than one opens the list with the first result highlighted so a second
 * Enter (or arrow keys + Enter) disambiguates without re-querying.
 */
export const ProductSearch = forwardRef<
  ProductSearchHandle,
  {
    warehouseId: string | null;
    priceListId: string | null;
    disabled?: boolean;
    appearance?: 'default' | 'primary';
    /** Overrides the `appearance="primary"` corner hint (default "Ctrl K"). Pass `null` to hide it — e.g. POS, where the field is always auto-focused and Ctrl+K isn't the relevant shortcut. */
    shortcutHint?: string | null;
    onSelect: (selection: ProductSearchSelection) => void;
  }
>(function ProductSearch(
  { warehouseId, priceListId, disabled, appearance = 'default', shortcutHint = 'Ctrl K', onSelect },
  ref,
) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [scanResults, setScanResults] = useState<InventoryLookupItem[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  const debouncedTerm = useDebounced(term, 200);
  const liveQuery = useInventoryLookup(
    { search: debouncedTerm.trim() || undefined, warehouseId: warehouseId ?? undefined, limit: 8 },
    { enabled: debouncedTerm.trim().length > 0 && scanResults === null },
  );
  const items = scanResults ?? liveQuery.data?.items ?? [];
  const { prices: priceMap, currencyCode } = usePriceMap(
    priceListId,
    items.map((i) => i.variantId),
  );

  function reset() {
    setTerm('');
    setOpen(false);
    setScanResults(null);
    setNotFound(false);
    setHighlight(0);
  }

  function select(item: InventoryLookupItem) {
    onSelect(toSelection(item));
    reset();
  }

  async function handleEnter() {
    const raw = term.trim();
    if (!raw) return;

    // Already showing an ambiguous list from a previous Enter — a second
    // Enter (or arrow-then-Enter) picks the highlighted one, no re-query.
    if (scanResults && scanResults.length > 1) {
      const picked = scanResults[highlight];
      if (picked) select(picked);
      return;
    }

    setSearching(true);
    setNotFound(false);
    try {
      const params = new URLSearchParams({ search: raw, limit: '8' });
      if (warehouseId) params.set('warehouseId', warehouseId);
      const res = await apiFetch<InventoryLookupResponse>(`/inventory/lookup?${params.toString()}`);
      if (res.items.length === 1) {
        select(res.items[0]);
      } else if (res.items.length === 0) {
        setNotFound(true);
        setScanResults(null);
      } else {
        setScanResults(res.items);
        setHighlight(0);
        setOpen(true);
      }
    } catch {
      setNotFound(true);
      setScanResults(null);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="relative">
      {appearance === 'primary' && (
        <Search
          className="pointer-events-none absolute top-3.5 left-3.5 z-[1] size-5 text-primary"
          aria-hidden="true"
        />
      )}
      <Input
        ref={inputRef}
        value={term}
        disabled={disabled}
        onChange={(e) => {
          setTerm(e.target.value);
          setScanResults(null);
          setNotFound(false);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            reset();
            e.currentTarget.blur();
          } else if (e.key === 'ArrowDown' && items.length > 0) {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, items.length - 1));
          } else if (e.key === 'ArrowUp' && items.length > 0) {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            void handleEnter();
          }
        }}
        placeholder="Buscar por nombre, SKU o código de barras…"
        aria-label="Buscar producto"
        aria-expanded={open}
        className={cn(
          appearance === 'primary' &&
            'h-12 border-primary/35 bg-card pr-20 pl-11 text-base ring-4 ring-primary/5 placeholder:text-muted-foreground/80 focus-visible:border-primary',
        )}
      />
      {appearance === 'primary' && shortcutHint && (
        <span className="pointer-events-none absolute top-3 right-3 rounded border border-border bg-muted px-1.5 py-0.5 text-[0.625rem] font-semibold text-muted-foreground">
          {shortcutHint}
        </span>
      )}
      {open && (term.trim() || notFound) && (
        <div
          className={cn(
            'absolute z-10 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-border bg-popover shadow-md',
            appearance === 'primary' && 'rounded-md shadow-lg',
          )}
        >
          {notFound && <p className="px-3 py-2 text-sm text-destructive">Producto no encontrado.</p>}
          {!notFound && items.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {liveQuery.isLoading || searching ? 'Buscando…' : 'Sin resultados.'}
            </p>
          )}
          {items.map((item, index) => {
            const price = priceMap[item.variantId];
            const isService = item.productType === 'SERVICE';
            const isUnavailable = !isService && item.available !== null && Number(item.available) <= 0;
            const isMissingPrice = price === null;
            return (
              <button
                key={item.variantId}
                type="button"
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted',
                  index === highlight && 'bg-muted',
                  appearance === 'primary' && 'min-h-14 border-b border-border/70 last:border-b-0',
                )}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(item);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {item.variantName ? `${item.name} · ${item.variantName}` : item.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.sku ?? item.productCode}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={cn('block font-medium tabular-nums', isMissingPrice && 'text-destructive')}
                  >
                    {!priceListId
                      ? '—'
                      : price === undefined
                        ? '…'
                        : price === null || !currencyCode
                          ? 'Sin precio'
                          : formatMoney(price, currencyCode)}
                  </span>
                  <span
                    className={cn(
                      'block text-xs text-muted-foreground',
                      appearance === 'primary' && isService && 'text-primary',
                      appearance === 'primary' && isUnavailable && 'text-warning',
                      appearance === 'primary' &&
                        !isService &&
                        !isUnavailable &&
                        item.available !== null &&
                        'text-success',
                    )}
                  >
                    {isService
                      ? 'Servicio'
                      : !warehouseId
                        ? '—'
                        : appearance === 'primary' && isUnavailable
                          ? 'Sin stock disponible'
                          : `Disponible: ${item.available ?? '0'}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
