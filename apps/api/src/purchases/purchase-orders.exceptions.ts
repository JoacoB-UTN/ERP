import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Same "don't reveal existence outside the caller's scope" reasoning used throughout the codebase — see CLAUDE.md. */
export class PurchaseOrderNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Orden de compra no encontrada.',
      code: 'PURCHASE_ORDER_NOT_FOUND',
    });
  }
}

/** DRAFT-only operation attempted on a CONFIRMED or CANCELLED order — see docs/purchases.md's state machine. */
export class PurchaseOrderNotEditableException extends ConflictException {
  constructor() {
    super({
      message: 'La orden de compra no está en borrador y no puede modificarse.',
      code: 'PURCHASE_ORDER_NOT_EDITABLE',
    });
  }
}

/** Distinct from PURCHASE_ORDER_NOT_EDITABLE so a retried confirm() gets an idempotency-friendly signal — mirrors SaleAlreadyConfirmedException. */
export class PurchaseOrderAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'La orden de compra ya fue confirmada.',
      code: 'PURCHASE_ORDER_ALREADY_CONFIRMED',
    });
  }
}

export class PurchaseOrderSupplierInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'El proveedor está inactivo.',
      code: 'PURCHASE_ORDER_SUPPLIER_INACTIVE',
    });
  }
}

/** Same shape as WarehouseInvalidBranchException — a branchId that exists but belongs to a different company. */
export class PurchaseOrderInvalidBranchException extends BadRequestException {
  constructor() {
    super({
      message: 'La sucursal seleccionada no pertenece a esta empresa.',
      code: 'PURCHASE_ORDER_INVALID_BRANCH',
    });
  }
}
