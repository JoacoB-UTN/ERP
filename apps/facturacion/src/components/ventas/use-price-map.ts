'use client';

import { useEffect, useState } from 'react';
import type { PriceLookupBatchResponse } from '@erp/shared';
import { apiFetch } from '@/lib/auth-client';

/**
 * Batch-prices a set of variantIds against one price list in a single
 * request (`POST /pricing/lookup/batch`, see docs/pricing.md) — shared by
 * the product-search dropdown and the cart/totals so both agree on the
 * same resolved prices. Never fabricates a price: unresolved/missing
 * stays `null` (or `undefined` while the request is still in flight),
 * distinct states a caller must render differently (see docs/facturacion.md).
 */
export function usePriceMap(
  priceListId: string | null,
  variantIds: string[],
): { prices: Record<string, string | null>; currencyCode: string | null } {
  const [state, setState] = useState<{ prices: Record<string, string | null>; currencyCode: string | null }>({
    prices: {},
    currencyCode: null,
  });
  const key = variantIds.slice().sort().join(',');
  const enabled = !!priceListId && variantIds.length > 0;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    apiFetch<PriceLookupBatchResponse>('/pricing/lookup/batch', {
      json: { priceListId, productVariantIds: variantIds },
    })
      .then((res) => {
        if (cancelled) return;
        const prices: Record<string, string | null> = {};
        for (const item of res.items) prices[item.productVariantId] = item.found ? item.price : null;
        setState({ prices, currencyCode: res.currencyCode });
      })
      .catch(() => {
        if (!cancelled) setState({ prices: {}, currencyCode: null });
      });
    return () => {
      cancelled = true;
    };
    // key already encodes variantIds; priceListId covers the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceListId, key, enabled]);

  // No priceListId or nothing to price — a plain derived empty result, never
  // synced through state (avoids a needless effect-driven render). While a
  // request for the current key is in flight, `state` still shows whatever
  // resolved for the previous key — callers treat an absent key as loading.
  if (!enabled) return { prices: {}, currencyCode: null };
  return state;
}
