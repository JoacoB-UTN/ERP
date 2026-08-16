'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { WarehouseDto, WarehousesResponse } from '@erp/shared';
import type { CompanyContextStore } from './company-context-store';

interface WarehouseContextClientConfig {
  store: CompanyContextStore;
  useWarehouses: () => { data?: WarehousesResponse; isLoading: boolean; isSuccess: boolean };
  useActiveBranchId: () => string | null;
}

/**
 * Facturación/POS warehouse-selection FOUNDATION only — no sale/POS
 * behavior lives here (see docs/inventory.md and CLAUDE.md's explicit
 * "deferred" list). Never assumes branch === warehouse: a branch can have
 * zero, one, or several eligible warehouses, and a warehouse with no
 * branchId is treated as available to every branch. Eligible = ACTIVE +
 * allowsSales. Auto-selects only when exactly one eligible warehouse
 * exists; otherwise the caller must render a picker (`needsSelection`) or
 * an empty state (`hasNoEligibleWarehouses`). Revalidates synchronously
 * whenever the active branch changes — `activeWarehouseId` is derived at
 * render time, never left stale while a new branch's warehouses load.
 */
export function createWarehouseContextClient(config: WarehouseContextClientConfig) {
  const { store, useWarehouses, useActiveBranchId } = config;

  function useActiveWarehouseId(): string | null {
    return useSyncExternalStore(
      store.subscribe,
      () => store.getActiveWarehouseId(),
      () => null,
    );
  }

  function useActiveWarehouse() {
    const branchId = useActiveBranchId();
    const warehousesQuery = useWarehouses();
    const storedId = useActiveWarehouseId();

    const all = warehousesQuery.data?.warehouses ?? [];
    const eligible: WarehouseDto[] = useMemo(
      () => all.filter((w) => w.status === 'ACTIVE' && w.allowsSales && (!w.branchId || w.branchId === branchId)),
      [all, branchId],
    );

    const resolvedId = useMemo(() => {
      if (!warehousesQuery.isSuccess) return storedId;
      if (storedId && eligible.some((w) => w.id === storedId)) return storedId;
      if (eligible.length === 1) return eligible[0].id;
      return null;
    }, [warehousesQuery.isSuccess, storedId, eligible]);

    useEffect(() => {
      if (warehousesQuery.isSuccess && resolvedId !== storedId) {
        store.setActiveWarehouseId(resolvedId);
      }
    }, [warehousesQuery.isSuccess, resolvedId, storedId]);

    const activeWarehouse: WarehouseDto | null = eligible.find((w) => w.id === resolvedId) ?? null;

    return {
      isLoading: warehousesQuery.isLoading,
      warehouses: eligible,
      activeWarehouseId: resolvedId,
      activeWarehouse,
      needsSelection: warehousesQuery.isSuccess && eligible.length > 1 && !resolvedId,
      hasNoEligibleWarehouses: warehousesQuery.isSuccess && eligible.length === 0,
      setActiveWarehouse: (warehouseId: string | null) => store.setActiveWarehouseId(warehouseId),
    };
  }

  return { useActiveWarehouseId, useActiveWarehouse };
}
