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
