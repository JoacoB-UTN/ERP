'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PriceListDto, PriceListsResponse } from '@erp/shared';
import type { CompanyContextStore } from './company-context-store';

interface PriceListContextClientConfig {
  store: CompanyContextStore;
  usePriceLists: () => { data?: PriceListsResponse; isLoading: boolean; isSuccess: boolean };
  useActiveCompanyId: () => string | null;
}

/**
 * Facturación price-context FOUNDATION only — no cart/invoice/order/checkout
 * functionality lives here (see docs/pricing.md and CLAUDE.md's explicit
 * "deferred" list). Mirrors warehouse-context-hooks.ts's shape exactly:
 * eligible = active price lists for the current company; a remembered
 * selection (`activePriceListId`, UX-only — never authorization) wins if
 * still eligible, otherwise exactly one eligible list auto-selects, otherwise
 * the list marked `isDefault` is preferred, otherwise the caller must render
 * a selector (`needsSelection`) or an empty state (`hasNoEligibleLists`).
 * Switching companies clears the remembered list (see
 * company-context-store.ts's setActiveCompanyId) so this re-evaluates from
 * scratch instead of carrying over a selection that may not even exist, let
 * alone be active, in the new company. The backend independently
 * re-validates company+active on every real pricing operation regardless of
 * what this hook resolves.
 */
export function createPriceListContextClient(config: PriceListContextClientConfig) {
  const { store, usePriceLists, useActiveCompanyId } = config;

  function useActivePriceListId(): string | null {
    return useSyncExternalStore(
      store.subscribe,
      () => store.getActivePriceListId(),
      () => null,
    );
  }

  function useActivePriceList() {
    const companyId = useActiveCompanyId();
    const priceListsQuery = usePriceLists();
    const storedId = useActivePriceListId();

    const all = priceListsQuery.data?.priceLists ?? [];
    const eligible: PriceListDto[] = useMemo(() => all.filter((pl) => pl.active), [all]);

    const resolvedId = useMemo(() => {
      if (!priceListsQuery.isSuccess) return storedId;
      if (storedId && eligible.some((pl) => pl.id === storedId)) return storedId;
      if (eligible.length === 1) return eligible[0].id;
      const defaultList = eligible.find((pl) => pl.isDefault);
      if (defaultList) return defaultList.id;
      return null;
    }, [priceListsQuery.isSuccess, storedId, eligible]);

    useEffect(() => {
      if (priceListsQuery.isSuccess && resolvedId !== storedId) {
        store.setActivePriceListId(resolvedId);
      }
      // Re-evaluate whenever the active company changes, even before the
      // list query resolves, so a stale resolvedId from the previous
      // company's list is never shown while the new one loads.
    }, [priceListsQuery.isSuccess, resolvedId, storedId, companyId]);

    const activePriceList: PriceListDto | null = eligible.find((pl) => pl.id === resolvedId) ?? null;

    return {
      isLoading: priceListsQuery.isLoading,
      priceLists: eligible,
      activePriceListId: resolvedId,
      activePriceList,
      needsSelection: priceListsQuery.isSuccess && eligible.length > 1 && !resolvedId,
      hasNoEligibleLists: priceListsQuery.isSuccess && eligible.length === 0,
      setActivePriceList: (priceListId: string | null) => store.setActivePriceListId(priceListId),
    };
  }

  return { useActivePriceListId, useActivePriceList };
}
