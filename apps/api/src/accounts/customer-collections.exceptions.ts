import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Same "don't reveal existence outside the caller's scope" reasoning used throughout the codebase — see CLAUDE.md. */
export class CustomerCollectionNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Cobro no encontrado.',
      code: 'CUSTOMER_COLLECTION_NOT_FOUND',
    });
  }
}

/** DRAFT-only operation attempted on a CONFIRMED or CANCELLED collection — see docs/current-accounts.md. */
export class CustomerCollectionNotEditableException extends ConflictException {
  constructor() {
    super({
      message: 'El cobro no está en borrador y no puede modificarse.',
      code: 'CUSTOMER_COLLECTION_NOT_EDITABLE',
    });
  }
}

/** Distinct from NOT_EDITABLE so a retried confirm() gets an idempotency-friendly signal — mirrors PurchaseReceiptAlreadyConfirmedException. */
export class CustomerCollectionAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'El cobro ya fue confirmado.',
      code: 'CUSTOMER_COLLECTION_ALREADY_CONFIRMED',
    });
  }
}

/** A retried/concurrent cancel on an already-CANCELLED collection — same idempotency-friendly-signal reasoning. */
export class CustomerCollectionAlreadyCancelledException extends ConflictException {
  constructor() {
    super({
      message: 'El cobro ya fue anulado.',
      code: 'CUSTOMER_COLLECTION_ALREADY_CANCELLED',
    });
  }
}

/** A client-supplied branchId that exists but belongs to a different company — see CustomerCollectionsService.assertBranchBelongsToCompany. */
export class CustomerCollectionInvalidBranchException extends BadRequestException {
  constructor() {
    super({
      message: 'La sucursal seleccionada no pertenece a esta empresa.',
      code: 'CUSTOMER_COLLECTION_INVALID_BRANCH',
    });
  }
}

/** An application target SalesDocument that doesn't belong to this company, or doesn't belong to the collection's customerId — see docs/current-accounts.md's application validation rules. */
export class CustomerCollectionApplicationSaleMismatchException extends ConflictException {
  constructor() {
    super({
      message: 'La venta indicada no pertenece a este cliente.',
      code: 'CUSTOMER_COLLECTION_APPLICATION_SALE_MISMATCH',
    });
  }
}

/** Only a CONFIRMED sale can be the target of an application — see docs/current-accounts.md. */
export class CustomerCollectionApplicationSaleNotConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede aplicar un cobro a una venta confirmada.',
      code: 'CUSTOMER_COLLECTION_APPLICATION_SALE_NOT_CONFIRMED',
    });
  }
}

/** The application's currency must match both the collection's and the sale's currency — no FX conversion in this task, see docs/current-accounts.md. */
export class CustomerCollectionApplicationCurrencyMismatchException extends ConflictException {
  constructor() {
    super({
      message: 'La moneda de la aplicación no coincide con la de la venta.',
      code: 'CUSTOMER_COLLECTION_APPLICATION_CURRENCY_MISMATCH',
    });
  }
}

/** SUM(applications.amount) must never exceed the collection's own total amount — see docs/current-accounts.md. */
export class CustomerCollectionApplicationsExceedAmountException extends ConflictException {
  constructor() {
    super({
      message: 'La suma de las aplicaciones supera el importe del cobro.',
      code: 'CUSTOMER_COLLECTION_APPLICATIONS_EXCEED_AMOUNT',
    });
  }
}

/**
 * Applying this collection would push a SalesDocument's outstanding below
 * zero — the authoritative, lock-protected over-application guard raised
 * inside confirm(). See docs/current-accounts.md's "Concurrency" section.
 */
export class CustomerCollectionOverApplicationException extends ConflictException {
  constructor() {
    super({
      message: 'El importe aplicado supera el saldo pendiente de la venta.',
      code: 'CUSTOMER_COLLECTION_OVER_APPLICATION',
    });
  }
}
