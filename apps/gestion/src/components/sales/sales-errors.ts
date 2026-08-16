import { ApiError } from '@erp/auth-client';

/**
 * Sales business errors (SALE_NOT_EDITABLE, SALE_ALREADY_CONFIRMED,
 * SALE_CUSTOMER_INACTIVE, SALE_WAREHOUSE_INVALID, SALE_PRICE_LIST_INVALID,
 * PRICE_NOT_FOUND, INSUFFICIENT_STOCK, ...) already carry a friendly
 * Spanish `message` from the backend — see
 * apps/api/src/sales/sales.exceptions.ts and docs/sales.md.
 */
export function saleErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Ocurrió un error inesperado.';
}
