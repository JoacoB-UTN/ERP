'use client';

import { ChevronDown } from 'lucide-react';
import { useActiveWarehouse, usePermissions } from '@/lib/auth-client';
import { ContextField } from './context-field';

/**
 * Warehouse-selection FOUNDATION for a future Facturación/POS sales flow —
 * see docs/inventory.md. No sale/POS behavior lives here; this only
 * resolves which warehouse a future sale would use. Shown alongside
 * BranchSelector rather than derived from it — a branch can have zero,
 * one, or several eligible warehouses, never assumed 1:1 (see CLAUDE.md).
 * Unlike BranchSelector, zero eligible warehouses renders a visible empty
 * state instead of hiding — a future sales flow cannot proceed without
 * one, so the gap must be obvious, not silent.
 */
export function WarehouseSelector({ branchId }: { branchId: string | null }) {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const {
    isLoading,
    warehouses,
    activeWarehouseId,
    activeWarehouse,
    setActiveWarehouse,
    hasNoEligibleWarehouses,
  } = useActiveWarehouse();

  if (!branchId || permissionsLoading || !can('inventory.warehouses.read')) {
    return null;
  }
  if (isLoading) {
    return null;
  }

  if (hasNoEligibleWarehouses) {
    return (
      <ContextField label="Depósito" className="min-w-36">
        <span
          className="rounded-md bg-warning-muted px-2 py-1 text-xs font-medium text-warning"
          title="Ningún depósito habilitado para ventas en esta sucursal"
        >
          Sin depósito disponible
        </span>
      </ContextField>
    );
  }

  if (warehouses.length === 1) {
    return (
      <ContextField label="Depósito" className="min-w-32">
        <span className="max-w-44 truncate">{activeWarehouse?.name}</span>
      </ContextField>
    );
  }

  return (
    <ContextField label="Depósito" className="min-w-36">
      <div className="relative inline-flex min-w-0 items-center">
        <select
          aria-label="Depósito activo"
          value={activeWarehouseId ?? ''}
          onChange={(e) => setActiveWarehouse(e.target.value || null)}
          className="h-7 max-w-48 appearance-none rounded-md border border-border bg-card py-0 pl-2 pr-7 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {!activeWarehouseId && (
            <option value="" disabled>
              Elegir depósito…
            </option>
          )}
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
      </div>
    </ContextField>
  );
}
