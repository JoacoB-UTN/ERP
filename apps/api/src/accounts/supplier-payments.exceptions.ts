import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Same "don't reveal existence outside the caller's scope" reasoning used throughout the codebase — see CLAUDE.md. */
export class SupplierPaymentNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Pago no encontrado.',
      code: 'SUPPLIER_PAYMENT_NOT_FOUND',
    });
  }
}

/** DRAFT-only operation attempted on a CONFIRMED or CANCELLED payment — see docs/current-accounts.md. */
export class SupplierPaymentNotEditableException extends ConflictException {
  constructor() {
    super({
      message: 'El pago no está en borrador y no puede modificarse.',
      code: 'SUPPLIER_PAYMENT_NOT_EDITABLE',
    });
  }
}

/** Distinct from NOT_EDITABLE so a retried confirm() gets an idempotency-friendly signal — mirrors CustomerCollectionAlreadyConfirmedException. */
export class SupplierPaymentAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'El pago ya fue confirmado.',
      code: 'SUPPLIER_PAYMENT_ALREADY_CONFIRMED',
    });
  }
}

/** A retried/concurrent cancel on an already-CANCELLED payment — same idempotency-friendly-signal reasoning. */
export class SupplierPaymentAlreadyCancelledException extends ConflictException {
  constructor() {
    super({
      message: 'El pago ya fue anulado.',
      code: 'SUPPLIER_PAYMENT_ALREADY_CANCELLED',
    });
  }
}

/** A client-supplied branchId that exists but belongs to a different company. */
export class SupplierPaymentInvalidBranchException extends BadRequestException {
  constructor() {
    super({
      message: 'La sucursal seleccionada no pertenece a esta empresa.',
      code: 'SUPPLIER_PAYMENT_INVALID_BRANCH',
    });
  }
}

/** An application target PurchaseReceipt that doesn't belong to this company, or doesn't belong to the payment's supplierId — see docs/current-accounts.md's application validation rules. */
export class SupplierPaymentApplicationReceiptMismatchException extends ConflictException {
  constructor() {
    super({
      message: 'La recepción indicada no pertenece a este proveedor.',
      code: 'SUPPLIER_PAYMENT_APPLICATION_RECEIPT_MISMATCH',
    });
  }
}

/** Only a CONFIRMED receipt can be the target of an application — see docs/current-accounts.md. */
export class SupplierPaymentApplicationReceiptNotConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede aplicar un pago a una recepción confirmada.',
      code: 'SUPPLIER_PAYMENT_APPLICATION_RECEIPT_NOT_CONFIRMED',
    });
  }
}

/** The application's currency must match both the payment's and the receipt's currency — no FX conversion in this task, see docs/current-accounts.md. */
export class SupplierPaymentApplicationCurrencyMismatchException extends ConflictException {
  constructor() {
    super({
      message: 'La moneda de la aplicación no coincide con la de la recepción.',
      code: 'SUPPLIER_PAYMENT_APPLICATION_CURRENCY_MISMATCH',
    });
  }
}

/** SUM(applications.amount) must never exceed the payment's own total amount — see docs/current-accounts.md. */
export class SupplierPaymentApplicationsExceedAmountException extends ConflictException {
  constructor() {
    super({
      message: 'La suma de las aplicaciones supera el importe del pago.',
      code: 'SUPPLIER_PAYMENT_APPLICATIONS_EXCEED_AMOUNT',
    });
  }
}

/**
 * Applying this payment would push a PurchaseReceipt's outstanding below
 * zero — the authoritative, lock-protected over-application guard raised
 * inside confirm(). See docs/current-accounts.md's "Concurrency" section.
 */
export class SupplierPaymentOverApplicationException extends ConflictException {
  constructor() {
    super({
      message: 'El importe aplicado supera el saldo pendiente de la recepción.',
      code: 'SUPPLIER_PAYMENT_OVER_APPLICATION',
    });
  }
}

/**
 * A CONFIRMED PurchaseReceipt cannot be cancelled while it has active
 * (CONFIRMED-payment) applications — see docs/current-accounts.md and
 * SupplierAccountService.hasActiveConfirmedApplications. Raised from
 * PurchaseReceiptsService.cancel(), not from this module, but declared
 * here because it belongs to the payments/applications domain.
 */
export class PurchaseReceiptHasActivePaymentsException extends ConflictException {
  constructor() {
    super({
      message:
        'La recepción tiene pagos confirmados aplicados y no puede anularse.',
      code: 'PURCHASE_RECEIPT_HAS_ACTIVE_PAYMENTS',
    });
  }
}
