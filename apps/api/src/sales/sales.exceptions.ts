import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Same "don't reveal existence outside the caller's scope" reasoning used
 * throughout the codebase — see CLAUDE.md.
 */
export class SaleNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Venta no encontrada.', code: 'SALE_NOT_FOUND' });
  }
}

/** DRAFT-only operation attempted on a CONFIRMED or CANCELLED sale — see docs/sales.md's state machine. */
export class SaleNotEditableException extends ConflictException {
  constructor() {
    super({
      message: 'La venta no está en borrador y no puede modificarse.',
      code: 'SALE_NOT_EDITABLE',
    });
  }
}

/** Distinct from SALE_NOT_EDITABLE so a retried confirm() gets an idempotency-friendly signal rather than a generic conflict — see docs/sales.md. */
export class SaleAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'La venta ya fue confirmada.',
      code: 'SALE_ALREADY_CONFIRMED',
    });
  }
}

/** A sale-local rule, not a general Customer rule — see docs/sales.md and docs/customers.md (no CUSTOMER_INACTIVE exists there). */
export class SaleCustomerInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'El cliente está inactivo.',
      code: 'SALE_CUSTOMER_INACTIVE',
    });
  }
}

/** Covers "not active" and "does not allow sales" for the selected warehouse, and branch/warehouse mismatch — see docs/sales.md. */
export class SaleWarehouseInvalidException extends ConflictException {
  constructor(message = 'El depósito seleccionado no es válido para ventas.') {
    super({ message, code: 'SALE_WAREHOUSE_INVALID' });
  }
}

/** Covers "not active" and "wrong company" for the selected price list — see docs/sales.md. */
export class SalePriceListInvalidException extends ConflictException {
  constructor(
    message = 'La lista de precios seleccionada no es válida para ventas.',
  ) {
    super({ message, code: 'SALE_PRICE_LIST_INVALID' });
  }
}
