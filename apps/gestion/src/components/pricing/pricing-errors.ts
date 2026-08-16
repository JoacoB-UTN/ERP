import { ApiError } from '@erp/auth-client';

/**
 * Pricing business errors (PRICE_LIST_CYCLE, PRICE_LIST_CURRENCY_MISMATCH,
 * PRICE_VALIDITY_OVERLAP, PRICE_LIST_INACTIVE, ...) already carry a friendly
 * Spanish `message` from the backend (see
 * apps/api/src/pricing/pricing.exceptions.ts) — same pattern as
 * stock-errors.ts, just a safe fallback for non-API errors.
 */
export function pricingErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Ocurrió un error inesperado.';
}
