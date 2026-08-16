import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Same "don't reveal existence outside the caller's scope" reasoning used
 * throughout the codebase — see CLAUDE.md.
 */
export class WarehouseNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Depósito no encontrado.', code: 'WAREHOUSE_NOT_FOUND' });
  }
}

export class WarehouseCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe un depósito con ese código en esta empresa.',
      code: 'WAREHOUSE_CODE_ALREADY_EXISTS',
    });
  }
}

/** The branch must belong to the same company as the warehouse — see CLAUDE.md's company-isolation rule. */
export class WarehouseInvalidBranchException extends BadRequestException {
  constructor() {
    super({
      message: 'La sucursal seleccionada no pertenece a esta empresa.',
      code: 'WAREHOUSE_INVALID_BRANCH',
    });
  }
}

/** See docs/inventory.md — deactivation is blocked while physical stock would become hidden. */
export class WarehouseHasStockException extends ConflictException {
  constructor() {
    super({
      message:
        'No se puede desactivar: el depósito todavía tiene existencias físicas.',
      code: 'WAREHOUSE_HAS_STOCK',
    });
  }
}

export class WarehouseHasActiveReservationsException extends ConflictException {
  constructor() {
    super({
      message:
        'No se puede desactivar: el depósito todavía tiene reservas activas.',
      code: 'WAREHOUSE_HAS_ACTIVE_RESERVATIONS',
    });
  }
}
