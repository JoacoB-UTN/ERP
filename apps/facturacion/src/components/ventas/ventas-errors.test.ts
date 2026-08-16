import { describe, expect, it } from 'vitest';
import { ApiError } from '@erp/auth-client';
import { saleErrorMessage } from './ventas-errors';

describe('saleErrorMessage', () => {
  it('surfaces the backend-provided Spanish message for a business ApiError', () => {
    const err = new ApiError(409, 'El cliente está inactivo.', undefined, 'SALE_CUSTOMER_INACTIVE');
    expect(saleErrorMessage(err)).toBe('El cliente está inactivo.');
  });

  it('falls back to a generic Spanish message for a non-ApiError (never a raw internal exception)', () => {
    expect(saleErrorMessage(new TypeError('Cannot read property of undefined'))).toBe(
      'Ocurrió un error inesperado.',
    );
    expect(saleErrorMessage('some string')).toBe('Ocurrió un error inesperado.');
    expect(saleErrorMessage(undefined)).toBe('Ocurrió un error inesperado.');
  });
});
