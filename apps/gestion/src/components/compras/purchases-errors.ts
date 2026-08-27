import { ApiError } from '@erp/auth-client';

interface FlattenedZodError {
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

/**
 * Purchases business errors (SUPPLIER_TAX_ID_ALREADY_EXISTS,
 * PURCHASE_ORDER_NOT_EDITABLE, PURCHASE_ORDER_ALREADY_CONFIRMED,
 * PURCHASE_RECEIPT_ORDER_NOT_CONFIRMED, PURCHASE_ORDER_OVER_RECEIPT,
 * INSUFFICIENT_STOCK, ...) already carry a friendly Spanish `message` from
 * the backend — see apps/api/src/purchases/*.exceptions.ts and
 * docs/purchases.md.
 */
export function purchaseErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return err.message;
  }
  return 'Ocurrió un error inesperado.';
}

/** Same field-error mapping shape as customerFieldErrors — for the Supplier create/edit forms. */
export function supplierFieldErrors(err: unknown): { general?: string; taxId?: string } {
  if (!(err instanceof ApiError)) {
    return { general: 'Ocurrió un error inesperado.' };
  }
  if (err.code === 'SUPPLIER_TAX_ID_ALREADY_EXISTS') {
    return { taxId: err.message };
  }
  const details = err.details as FlattenedZodError | undefined;
  const taxIdError = details?.fieldErrors?.taxId?.[0];
  if (taxIdError) {
    return { taxId: taxIdError };
  }
  return { general: err.message };
}
