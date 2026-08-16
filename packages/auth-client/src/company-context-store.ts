/**
 * Plain (non-React) storage for the active company/branch selection.
 * Framework-agnostic on purpose: `api-client.ts` reads it synchronously on
 * every request to attach X-Company-Id/X-Branch-Id, and
 * `company-context-hooks.ts` wraps it for React via useSyncExternalStore.
 *
 * localStorage, namespaced per app (`keyPrefix`) — the selected company id
 * is not a secret (see CLAUDE.md), so this is a convenience persistence,
 * never an authorization mechanism. Namespacing lets Gestión and
 * Facturación hold different active companies/branches at the same time,
 * per CLAUDE.md's product boundary.
 */
export interface CompanyContextStore {
  getActiveCompanyId(): string | null;
  getActiveBranchId(): string | null;
  /** See docs/inventory.md's Facturación preparation section — warehouse selection, not a business operation. */
  getActiveWarehouseId(): string | null;
  /** See docs/pricing.md's Facturación preparation section — UX-only remembered selection, never authorization (backend always re-validates company+active). */
  getActivePriceListId(): string | null;
  /** Selecting a company always clears the branch, warehouse, and price list — all belong to a company/branch. */
  setActiveCompanyId(id: string | null): void;
  /** Selecting a branch always clears the warehouse — a branch may have several eligible warehouses, never assumed 1:1 (see docs/inventory.md). Price list is company-scoped, not branch-scoped, so it is left untouched. */
  setActiveBranchId(id: string | null): void;
  setActiveWarehouseId(id: string | null): void;
  setActivePriceListId(id: string | null): void;
  subscribe(listener: () => void): () => void;
}

export function createCompanyContextStore(keyPrefix: string): CompanyContextStore {
  const companyKey = `erp.${keyPrefix}.activeCompanyId`;
  const branchKey = `erp.${keyPrefix}.activeBranchId`;
  const warehouseKey = `erp.${keyPrefix}.activeWarehouseId`;
  const priceListKey = `erp.${keyPrefix}.activePriceListId`;
  const listeners = new Set<() => void>();

  function read(key: string): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  }

  function write(key: string, value: string | null): void {
    if (typeof window === 'undefined') return;
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  return {
    getActiveCompanyId: () => read(companyKey),
    getActiveBranchId: () => read(branchKey),
    getActiveWarehouseId: () => read(warehouseKey),
    getActivePriceListId: () => read(priceListKey),
    setActiveCompanyId: (id) => {
      write(companyKey, id);
      write(branchKey, null);
      write(warehouseKey, null);
      write(priceListKey, null);
      notify();
    },
    setActiveBranchId: (id) => {
      write(branchKey, id);
      write(warehouseKey, null);
      notify();
    },
    setActiveWarehouseId: (id) => {
      write(warehouseKey, id);
      notify();
    },
    setActivePriceListId: (id) => {
      write(priceListKey, id);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
