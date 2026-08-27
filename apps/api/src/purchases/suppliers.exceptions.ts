import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Same "don't reveal existence outside the caller's scope" reasoning used
 * throughout the codebase (CustomerNotFoundException, RoleNotFoundException)
 * — identical response whether the id doesn't exist at all or belongs to a
 * different company. See CLAUDE.md and docs/purchases.md.
 */
export class SupplierNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Proveedor no encontrado.', code: 'SUPPLIER_NOT_FOUND' });
  }
}

export class SupplierCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe un proveedor con ese código en esta empresa.',
      code: 'SUPPLIER_CODE_ALREADY_EXISTS',
    });
  }
}

/** Only checked against other ACTIVE suppliers — same rule as CustomerTaxIdAlreadyExistsException, see docs/purchases.md. */
export class SupplierTaxIdAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message:
        'Ya existe un proveedor activo con ese CUIT/documento en esta empresa.',
      code: 'SUPPLIER_TAX_ID_ALREADY_EXISTS',
    });
  }
}

/** A purchase-local rule (PurchaseOrder/PurchaseReceipt referencing an inactive supplier) — see docs/purchases.md. */
export class SupplierInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'El proveedor está inactivo.',
      code: 'SUPPLIER_INACTIVE',
    });
  }
}

/**
 * Raised by SuppliersService.update() using the EFFECTIVE documentType/
 * taxId pair (existing value merged with whatever the PATCH actually
 * changes) — the shared Zod schema's superRefine only sees the PATCH body
 * itself, so it can't catch e.g. `PATCH { taxId }` alone leaving an
 * existing CUIT supplier with an invalid checksum. See docs/purchases.md.
 */
export class SupplierInvalidTaxIdException extends BadRequestException {
  constructor(message: string) {
    super({ message, code: 'SUPPLIER_INVALID_TAX_ID' });
  }
}
