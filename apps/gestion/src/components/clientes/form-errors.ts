import { ApiError } from '@erp/auth-client';

interface FlattenedZodError {
  fieldErrors?: Record<string, string[]>;
  formErrors?: string[];
}

/**
 * Maps a failed customer create/update request to per-field messages —
 * Zod validation failures carry `details.fieldErrors` (see
 * ZodValidationPipe), while business conflicts (duplicate tax id) come
 * back as a top-level message with a stable `code` instead. See CLAUDE.md
 * — never show the raw technical code to the user.
 */
export function customerFieldErrors(err: unknown): { general?: string; taxId?: string } {
  if (!(err instanceof ApiError)) {
    return { general: 'Ocurrió un error inesperado.' };
  }
  if (err.code === 'CUSTOMER_TAX_ID_ALREADY_EXISTS') {
    return { taxId: err.message };
  }
  const details = err.details as FlattenedZodError | undefined;
  const taxIdError = details?.fieldErrors?.taxId?.[0];
  if (taxIdError) {
    return { taxId: taxIdError };
  }
  return { general: err.message };
}
