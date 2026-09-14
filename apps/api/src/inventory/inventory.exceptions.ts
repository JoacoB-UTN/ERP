import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Effective negative-stock policy (Product AND Warehouse) forbids the projected result — see docs/inventory.md. */
export class InsufficientStockException extends ConflictException {
  constructor() {
    super({
      message:
        'Stock insuficiente para esta operación en el depósito seleccionado.',
      code: 'INSUFFICIENT_STOCK',
    });
  }
}

/** A reservation would exceed AVAILABLE (ON_HAND - RESERVED) — see docs/inventory.md. Over-reservation is never allowed in this task. */
export class InsufficientAvailableStockException extends ConflictException {
  constructor() {
    super({
      message: 'No hay stock disponible suficiente para reservar esa cantidad.',
      code: 'INSUFFICIENT_AVAILABLE_STOCK',
    });
  }
}

/** Includes SERVICE products by construction (trackInventory defaults false for them) — see docs/products.md. */
export class ProductDoesNotTrackInventoryException extends BadRequestException {
  constructor() {
    super({
      message: 'Este producto no controla stock.',
      code: 'PRODUCT_DOES_NOT_TRACK_INVENTORY',
    });
  }
}

export class InitialBalanceAlreadyEstablishedException extends ConflictException {
  constructor() {
    super({
      message:
        'Este artículo ya tiene movimientos en el depósito. Usá un ajuste de stock.',
      code: 'INITIAL_BALANCE_ALREADY_ESTABLISHED',
    });
  }
}

export class InvalidQuantityPrecisionException extends BadRequestException {
  constructor(unitName: string, decimalPlaces: number) {
    super({
      message: `La cantidad tiene más decimales de los que admite la unidad "${unitName}" (máximo ${decimalPlaces}).`,
      code: 'INVALID_QUANTITY_PRECISION',
    });
  }
}

export class StockMovementNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Movimiento no encontrado.',
      code: 'STOCK_MOVEMENT_NOT_FOUND',
    });
  }
}

export class StockAdjustmentNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Ajuste de stock no encontrado.',
      code: 'STOCK_ADJUSTMENT_NOT_FOUND',
    });
  }
}

/** Confirmed/cancelled adjustments are immutable — see CLAUDE.md and docs/inventory.md. */
export class StockAdjustmentNotDraftException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede modificar un ajuste en estado borrador.',
      code: 'STOCK_ADJUSTMENT_NOT_DRAFT',
    });
  }
}

export class StockTransferNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Transferencia no encontrada.',
      code: 'STOCK_TRANSFER_NOT_FOUND',
    });
  }
}

/** Confirmed/cancelled transfers are immutable — see CLAUDE.md and docs/inventory.md. */
export class StockTransferNotDraftException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede modificar una transferencia en borrador.',
      code: 'STOCK_TRANSFER_NOT_DRAFT',
    });
  }
}

/**
 * Raised when the conditional status UPDATE that opens `confirm()` matches
 * zero rows: another request confirmed (or cancelled) this transfer first.
 * The guard is what makes a double confirm impossible rather than merely
 * unlikely — see StockTransfersService.confirm.
 */
export class StockTransferAlreadyConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'Esta transferencia ya fue confirmada o anulada.',
      code: 'STOCK_TRANSFER_ALREADY_CONFIRMED',
    });
  }
}

/** Only a CONFIRMED transfer can be cancelled with compensating movements; a draft is cancelled without touching the ledger. */
export class StockTransferNotCancellableException extends ConflictException {
  constructor() {
    super({
      message: 'Esta transferencia ya fue anulada.',
      code: 'STOCK_TRANSFER_NOT_CANCELLABLE',
    });
  }
}

/** Source and destination must differ — a transfer to the same warehouse moves nothing and would write two cancelling movements. */
export class StockTransferSameWarehouseException extends BadRequestException {
  constructor() {
    super({
      message: 'El depósito de destino debe ser distinto al de origen.',
      code: 'STOCK_TRANSFER_SAME_WAREHOUSE',
    });
  }
}
