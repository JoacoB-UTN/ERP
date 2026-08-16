import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * Same "don't reveal existence outside the caller's scope" reasoning used
 * throughout the codebase (RoleNotFoundException, AuditLogNotFoundException)
 * — identical response whether the id doesn't exist at all or belongs to a
 * different company. See CLAUDE.md.
 *
 * INVALID_TAX_ID is deliberately NOT a service-level exception here: CUIT/
 * CUIL structural + checksum validation happens in the shared Zod schema
 * (packages/shared/src/customers.ts, via tax-id.ts), which both frontend
 * and backend validate against before a request ever reaches CustomersService
 * — see docs/customers.md. Duplicating that check here would be dead code.
 */
export class CustomerNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Cliente no encontrado.', code: 'CUSTOMER_NOT_FOUND' });
  }
}

export class CustomerCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe un cliente con ese código en esta empresa.',
      code: 'CUSTOMER_CODE_ALREADY_EXISTS',
    });
  }
}

/** Only checked against other ACTIVE customers — see docs/customers.md. */
export class CustomerTaxIdAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message:
        'Ya existe un cliente activo con ese CUIT/documento en esta empresa.',
      code: 'CUSTOMER_TAX_ID_ALREADY_EXISTS',
    });
  }
}

/** Used both for a direct category lookup and for validating categoryIds referenced from a customer create/update payload. */
export class CustomerCategoryNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Una o más categorías no son válidas para esta empresa.',
      code: 'CUSTOMER_CATEGORY_NOT_FOUND',
    });
  }
}

export class CustomerCategoryAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una categoría con ese nombre en esta empresa.',
      code: 'CUSTOMER_CATEGORY_ALREADY_EXISTS',
    });
  }
}

export class CustomerAddressNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Domicilio no encontrado.',
      code: 'CUSTOMER_ADDRESS_NOT_FOUND',
    });
  }
}

export class CustomerContactNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Contacto no encontrado.',
      code: 'CUSTOMER_CONTACT_NOT_FOUND',
    });
  }
}
