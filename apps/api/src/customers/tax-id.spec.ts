import {
  normalizeTaxId,
  formatCuit,
  isValidCuitChecksum,
  validateTaxIdForDocumentType,
} from '@erp/shared';

// Mandatory unit coverage for CUIT normalization/validation — section 14/98/99
// of the Customers task. See docs/customers.md.
describe('CUIT/CUIL normalization and validation', () => {
  it('normalizes equivalent inputs (dashed and plain digits) to the same value', () => {
    expect(normalizeTaxId('30-71234567-1')).toBe('30712345671');
    expect(normalizeTaxId('30712345671')).toBe('30712345671');
    expect(normalizeTaxId(' 30 71234567 1 ')).toBe('30712345671');
  });

  it('formats a normalized CUIT back to the dashed display form', () => {
    expect(formatCuit('30712345671')).toBe('30-71234567-1');
  });

  it('returns the input unchanged if it is not exactly 11 digits', () => {
    expect(formatCuit('12345')).toBe('12345');
  });

  it('accepts a structurally valid CUIT with a correct checksum', () => {
    expect(isValidCuitChecksum('30712345671')).toBe(true);
    expect(isValidCuitChecksum('30334455668')).toBe(true);
  });

  it('rejects a CUIT with an incorrect checksum', () => {
    expect(isValidCuitChecksum('30712345670')).toBe(false);
  });

  it('rejects a value that is not exactly 11 digits', () => {
    expect(isValidCuitChecksum('307123456')).toBe(false);
    expect(isValidCuitChecksum('307123456712')).toBe(false);
    expect(isValidCuitChecksum('3071234567a')).toBe(false);
  });

  it('validates CUIT/CUIL document types against the checksum', () => {
    expect(validateTaxIdForDocumentType('CUIT', '30712345671')).toEqual({
      valid: true,
    });
    expect(validateTaxIdForDocumentType('CUIL', '30712345671')).toEqual({
      valid: true,
    });
    expect(validateTaxIdForDocumentType('CUIT', '30712345670').valid).toBe(
      false,
    );
    expect(validateTaxIdForDocumentType('CUIT', '123').valid).toBe(false);
  });

  it('never applies CUIT-specific checksum rules to other document types', () => {
    // Structurally CUIT-shaped but checksum-invalid — must still pass for DNI/PASSPORT/OTHER.
    expect(validateTaxIdForDocumentType('DNI', '30712345670')).toEqual({
      valid: true,
    });
    expect(validateTaxIdForDocumentType('PASSPORT', 'AB123456')).toEqual({
      valid: true,
    });
    expect(validateTaxIdForDocumentType('OTHER', 'anything')).toEqual({
      valid: true,
    });
    expect(validateTaxIdForDocumentType(null, '30712345670')).toEqual({
      valid: true,
    });
  });

  it('treats empty input as valid (requiredness is a separate concern)', () => {
    expect(validateTaxIdForDocumentType('CUIT', '')).toEqual({ valid: true });
  });
});
