import { ApiError } from '@erp/auth-client';

interface FlattenedZodError {
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

/**
 * Maps a failed product create/update request to per-field messages —
 * Zod validation failures carry `details.fieldErrors` (see
 * ZodValidationPipe), while business conflicts (duplicate code/SKU/
 * barcode) come back as a top-level message with a stable `code` instead.
 * Never show the raw technical code to the user (see CLAUDE.md).
 */
export function productFieldErrors(err: unknown): { general?: string; sku?: string; barcode?: string } {
  if (!(err instanceof ApiError)) {
    return { general: 'Ocurrió un error inesperado.' };
  }
  if (err.code === 'PRODUCT_SKU_ALREADY_EXISTS') {
    return { sku: err.message };
  }
  if (err.code === 'PRODUCT_BARCODE_ALREADY_EXISTS') {
    return { barcode: err.message };
  }
  const details = err.details as FlattenedZodError | undefined;
  const skuError = details?.fieldErrors?.sku?.[0];
  if (skuError) {
    return { sku: skuError };
  }
  return { general: err.message };
}
