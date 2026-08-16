import { ApiError } from '@erp/auth-client';

/**
 * Inventory business errors (INSUFFICIENT_STOCK, INVALID_QUANTITY_PRECISION,
 * PRODUCT_DOES_NOT_TRACK_INVENTORY, INITIAL_BALANCE_ALREADY_ESTABLISHED,
 * WAREHOUSE_HAS_STOCK, ...) already carry a friendly Spanish `message` from
 * the backend (see apps/api/src/inventory/inventory.exceptions.ts) — unlike
 * product/customer forms there's no per-field mapping to do here, just a
 * safe fallback for non-API errors.
 */
export function stockErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Ocurrió un error inesperado.';
}
