/**
 * CUIT/CUIL normalization + checksum validation — see docs/customers.md.
 * Stored value is always normalized digits only (no dashes/spaces); the
 * dashed "30-12345678-9" form is a display/input convenience, never
 * persisted. Shared between frontend and backend so both enforce the
 * exact same rule (see CLAUDE.md — don't duplicate validation logic).
 */

/** Strips everything but digits — safe to call on already-normalized input too. */
export function normalizeTaxId(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** "30123456789" -> "30-12345678-9". Returns the input unchanged if it isn't exactly 11 digits. */
export function formatCuit(normalized: string): string {
  if (!/^\d{11}$/.test(normalized)) {
    return normalized;
  }
  return `${normalized.slice(0, 2)}-${normalized.slice(2, 10)}-${normalized.slice(10)}`;
}

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Standard mod-11 CUIT/CUIL checksum. Structurally-invalid input (wrong length, non-digits) is simply invalid, not an error. */
export function isValidCuitChecksum(normalized: string): boolean {
  if (!/^\d{11}$/.test(normalized)) {
    return false;
  }
  const digits = normalized.split('').map(Number);
  const sum = digits.slice(0, 10).reduce((acc, digit, i) => acc + digit * CUIT_WEIGHTS[i], 0);
  const remainder = sum % 11;
  let checkDigit = 11 - remainder;
  if (checkDigit === 11) checkDigit = 0;
  if (checkDigit === 10) return false; // no valid check digit exists for this base — structurally invalid
  return checkDigit === digits[10];
}

/**
 * Only CUIT/CUIL receive checksum validation (see CLAUDE.md — never apply
 * CUIT-specific rules to other document types like DNI/PASSPORT). Empty
 * input is valid here (taxId is optional at the schema level) — required-
 * ness is a separate concern.
 */
export function validateTaxIdForDocumentType(
  documentType: string | null | undefined,
  normalizedTaxId: string,
): { valid: true } | { valid: false; message: string } {
  if (!normalizedTaxId) {
    return { valid: true };
  }
  if (documentType === 'CUIT' || documentType === 'CUIL') {
    if (!/^\d{11}$/.test(normalizedTaxId)) {
      return { valid: false, message: `El ${documentType} debe tener 11 dígitos.` };
    }
    if (!isValidCuitChecksum(normalizedTaxId)) {
      return { valid: false, message: `El ${documentType} ingresado no es válido.` };
    }
  }
  return { valid: true };
}
