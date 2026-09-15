import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Not found and not-yours are the same answer on purpose — see
 * docs/multi-company-architecture.md. Distinguishing them would confirm
 * that another company's account exists.
 */
export class TreasuryAccountNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'La cuenta de tesorería no existe.',
      code: 'TREASURY_ACCOUNT_NOT_FOUND',
    });
  }
}

export class TreasuryAccountCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una cuenta de tesorería con ese código.',
      code: 'TREASURY_ACCOUNT_CODE_ALREADY_EXISTS',
    });
  }
}

/**
 * A drawer holding minus five thousand pesos does not exist. A bank
 * account may go negative when `allowsNegativeBalance` says so — an
 * overdraft is a real thing, an impossible cash box is not.
 */
export class InsufficientTreasuryFundsException extends ConflictException {
  constructor() {
    super({
      message:
        'La cuenta no tiene saldo suficiente para registrar este movimiento.',
      code: 'INSUFFICIENT_TREASURY_FUNDS',
    });
  }
}

/**
 * No exchange rates exist in this module. A document in one currency
 * cannot land in an account of another, and the answer is a rejection
 * rather than a conversion nobody asked for.
 */
export class TreasuryCurrencyMismatchException extends BadRequestException {
  constructor() {
    super({
      message:
        'La moneda del movimiento no coincide con la moneda de la cuenta de tesorería.',
      code: 'TREASURY_CURRENCY_MISMATCH',
    });
  }
}

/** A cash box is physical money; it cannot be configured to go negative. */
export class CashBoxCannotAllowNegativeException extends BadRequestException {
  constructor() {
    super({
      message: 'Una caja no puede quedar en negativo.',
      code: 'CASH_BOX_CANNOT_ALLOW_NEGATIVE',
    });
  }
}

/** Posting to a retired account would silently reopen it. */
export class TreasuryAccountInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'La cuenta de tesorería está inactiva.',
      code: 'TREASURY_ACCOUNT_INACTIVE',
    });
  }
}

/**
 * The opening balance is what was already in the account when it was
 * first loaded into the system. Once the ledger has started, a
 * correction is an adjustment — never a second "opening".
 */
export class TreasuryOpeningBalanceAlreadySetException extends ConflictException {
  constructor() {
    super({
      message:
        'Esta cuenta ya tiene movimientos. Para corregir el saldo, registrá un ajuste.',
      code: 'TREASURY_OPENING_BALANCE_ALREADY_SET',
    });
  }
}

export class InvalidTreasuryAmountException extends BadRequestException {
  constructor() {
    super({
      message: 'El importe debe ser un número válido distinto de cero.',
      code: 'INVALID_TREASURY_AMOUNT',
    });
  }
}

export class CurrencyNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'La moneda indicada no existe.',
      code: 'CURRENCY_NOT_FOUND',
    });
  }
}

export class TreasuryTransferNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'La transferencia de tesorería no existe.',
      code: 'TREASURY_TRANSFER_NOT_FOUND',
    });
  }
}

/**
 * The guard that makes a confirm, an edit and a cancellation serialize.
 * A 409 rather than a 404: the document exists, it just is not a draft
 * any more — most often because another terminal got there first.
 */
export class TreasuryTransferNotDraftException extends ConflictException {
  constructor() {
    super({
      message: 'La transferencia ya no está en borrador.',
      code: 'TREASURY_TRANSFER_NOT_DRAFT',
    });
  }
}

export class TreasuryTransferNotConfirmedException extends ConflictException {
  constructor() {
    super({
      message: 'Solo se puede anular una transferencia confirmada.',
      code: 'TREASURY_TRANSFER_NOT_CONFIRMED',
    });
  }
}

/** Money that goes nowhere is not a transfer. */
export class TreasuryTransferSameAccountException extends BadRequestException {
  constructor() {
    super({
      message: 'El origen y el destino tienen que ser cuentas distintas.',
      code: 'TREASURY_TRANSFER_SAME_ACCOUNT',
    });
  }
}

/**
 * A document naming an account it cannot reach. Rejected at write time
 * rather than at confirmation: a Cobro that can never be confirmed is not
 * a draft, it is a trap, and the operator should hear about it while the
 * form is still open.
 */
export class TreasuryAccountNotUsableException extends BadRequestException {
  constructor(reason: 'currency' | 'inactive') {
    super({
      message:
        reason === 'currency'
          ? 'La cuenta de tesorería es de otra moneda.'
          : 'La cuenta de tesorería está inactiva.',
      code:
        reason === 'currency'
          ? 'TREASURY_CURRENCY_MISMATCH'
          : 'TREASURY_ACCOUNT_INACTIVE',
    });
  }
}

/**
 * A negative opening on an account that can never hold a negative
 * balance. Its own code rather than reusing INSUFFICIENT_TREASURY_FUNDS,
 * which would read as "there is not enough money" when the real answer is
 * "this account cannot be overdrawn at all".
 */
export class NegativeOpeningBalanceException extends BadRequestException {
  constructor() {
    super({
      message:
        'Solo una cuenta bancaria con descubierto habilitado puede abrir con saldo negativo.',
      code: 'NEGATIVE_OPENING_BALANCE_NOT_ALLOWED',
    });
  }
}
