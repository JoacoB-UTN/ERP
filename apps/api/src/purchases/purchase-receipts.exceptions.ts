import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Same "don't reveal existence outside the caller's scope" reasoning used throughout the codebase — see CLAUDE.md. */
export class PurchaseReceiptNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Recepción no encontrada.',
      code: 'PURCHASE_RECEIPT_NOT_FOUND',
    });
  }
}

/** DRAFT-only operation attempted on a CONFIRMED or CANCELLED receipt — see docs/purchases.md. */
export class PurchaseReceiptNotEditableException extends ConflictException {
  constructor() {
    super({
      message: 'La recepción no está en borrador y no puede modificarse.',
      code: 'PURCHASE_RECEIPT_NOT_EDITABLE',
    });
  }
}

/** Distinct from PURCHASE_RECEIPT_NOT_EDITABLE so a retried confirm() gets an idempotency-friendly signal — mirrors SaleAlreadyConfirmedException. */
export class PurchaseReceiptAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'La recepción ya fue confirmada.',
      code: 'PURCHASE_RECEIPT_ALREADY_CONFIRMED',
    });
  }
}

/** A retried/concurrent cancel on an already-CANCELLED receipt — same idempotency-friendly-signal reasoning as PURCHASE_RECEIPT_ALREADY_CONFIRMED. */
export class PurchaseReceiptAlreadyCancelledException extends ConflictException {
  constructor() {
    super({
      message: 'La recepción ya fue anulada.',
      code: 'PURCHASE_RECEIPT_ALREADY_CANCELLED',
    });
  }
}

export class PurchaseReceiptSupplierInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'El proveedor está inactivo.',
      code: 'PURCHASE_RECEIPT_SUPPLIER_INACTIVE',
    });
  }
}

/** Covers "not active" and "does not allow purchases" for the selected warehouse — see docs/purchases.md. */
export class PurchaseReceiptWarehouseInvalidException extends ConflictException {
  constructor(
    message = 'El depósito seleccionado no es válido para recepciones.',
  ) {
    super({ message, code: 'PURCHASE_RECEIPT_WAREHOUSE_INVALID' });
  }
}

/** A direct receipt (no purchaseOrderId) requires an explicit currencyId — see docs/purchases.md. */
export class PurchaseReceiptCurrencyRequiredException extends BadRequestException {
  constructor() {
    super({
      message: 'Elegí una moneda para una recepción directa.',
      code: 'PURCHASE_RECEIPT_CURRENCY_REQUIRED',
    });
  }
}

/** Only a CONFIRMED order can be received against — see docs/purchases.md. */
export class PurchaseReceiptOrderNotConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede recibir contra una orden de compra confirmada.',
      code: 'PURCHASE_RECEIPT_ORDER_NOT_CONFIRMED',
    });
  }
}

/** The receipt's supplierId must match the referenced order's supplier — see docs/purchases.md. */
export class PurchaseReceiptSupplierMismatchException extends ConflictException {
  constructor() {
    super({
      message:
        'El proveedor de la recepción no coincide con el de la orden de compra.',
      code: 'PURCHASE_RECEIPT_SUPPLIER_MISMATCH',
    });
  }
}

/** A line's purchaseOrderLineId doesn't belong to the referenced order, or its productVariantId doesn't match that order line — see docs/purchases.md. */
export class PurchaseReceiptLineNotFromOrderException extends ConflictException {
  constructor() {
    super({
      message:
        'Una línea de la recepción no corresponde a la orden de compra indicada.',
      code: 'PURCHASE_RECEIPT_LINE_NOT_FROM_ORDER',
    });
  }
}

/**
 * Receiving would push a PurchaseOrderLine's total received quantity past
 * what was ordered — see docs/purchases.md's partial-receipt / concurrency
 * section. Raised both as an advisory check at create/update time and as
 * the authoritative, lock-protected check inside confirm().
 */
export class PurchaseOrderOverReceiptException extends ConflictException {
  constructor() {
    super({
      message:
        'La cantidad a recibir supera la cantidad pendiente de la orden de compra.',
      code: 'PURCHASE_ORDER_OVER_RECEIPT',
    });
  }
}
