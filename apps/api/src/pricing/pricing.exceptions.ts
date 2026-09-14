import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/** Same "don't reveal existence outside the caller's scope" reasoning used throughout the codebase — see CLAUDE.md. */
export class PriceListNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Lista de precios no encontrada.',
      code: 'PRICE_LIST_NOT_FOUND',
    });
  }
}

/** Currencies are global reference data — see docs/pricing.md. Rejects an unknown or inactive currency (never trusted from the client as-is). */
export class CurrencyNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Moneda no encontrada o inactiva.',
      code: 'CURRENCY_NOT_FOUND',
    });
  }
}

export class PriceListCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una lista de precios con ese código en esta empresa.',
      code: 'PRICE_LIST_CODE_ALREADY_EXISTS',
    });
  }
}

export class PriceListNameAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una lista de precios con ese nombre en esta empresa.',
      code: 'PRICE_LIST_NAME_ALREADY_EXISTS',
    });
  }
}

/** Operational lookup rejects inactive lists — see docs/pricing.md. Administration/history may still display them. */
export class PriceListInactiveException extends ConflictException {
  constructor() {
    super({
      message: 'La lista de precios está inactiva.',
      code: 'PRICE_LIST_INACTIVE',
    });
  }
}

/** A derived list may never (directly or transitively) derive from itself — see docs/pricing.md. */
export class PriceListCycleException extends BadRequestException {
  constructor() {
    super({
      message: 'La lista base genera un ciclo de derivación de precios.',
      code: 'PRICE_LIST_CYCLE',
    });
  }
}

/** Derived lists never convert across currencies in this task — see docs/pricing.md. */
export class PriceListCurrencyMismatchException extends BadRequestException {
  constructor() {
    super({
      message:
        'La lista base debe estar en la misma moneda que la lista derivada.',
      code: 'PRICE_LIST_CURRENCY_MISMATCH',
    });
  }
}

export class PriceListNotFixedException extends BadRequestException {
  constructor() {
    super({
      message: 'Esta operación solo es válida para listas de precios fijas.',
      code: 'PRICE_LIST_NOT_FIXED',
    });
  }
}

export class PriceListNotDerivedException extends BadRequestException {
  constructor() {
    super({
      message:
        'Esta operación solo es válida para listas de precios derivadas.',
      code: 'PRICE_LIST_NOT_DERIVED',
    });
  }
}

/** Missing price is never silently treated as zero — see CLAUDE.md and docs/pricing.md. */
export class PriceNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'No hay un precio vigente para este producto en esta lista.',
      code: 'PRICE_NOT_FOUND',
    });
  }
}

export class PriceInvalidException extends BadRequestException {
  constructor(message = 'El precio ingresado no es válido.') {
    super({ message, code: 'PRICE_INVALID' });
  }
}

export class PriceValidityOverlapException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe un precio vigente que se superpone con ese período.',
      code: 'PRICE_VALIDITY_OVERLAP',
    });
  }
}

/**
 * The upload could not be read as a spreadsheet, or it is one but has no
 * row that looks like the expected header.
 *
 * One exception for both because the fix is the same — check the file — and
 * naming the columns we looked for is what makes it actionable, rather than
 * a bare "formato inválido".
 */
export class PriceFileUnreadableException extends BadRequestException {
  constructor(expectedHeaders: string[]) {
    super({
      message: `No pudimos leer el archivo. Tiene que ser un Excel (.xlsx) con las columnas: ${expectedHeaders.join(', ')}.`,
      code: 'PRICE_FILE_UNREADABLE',
      details: { expectedHeaders },
    });
  }
}

/**
 * The file was read fine and nothing in it changes anything. Refused rather
 * than reported as a successful import of zero rows: "listo" over a file
 * that did nothing is how someone concludes the prices were updated when
 * they were not.
 */
export class PriceFileNothingToApplyException extends BadRequestException {
  constructor() {
    super({
      message: 'El archivo no tiene ninguna fila que actualizar.',
      code: 'PRICE_FILE_NOTHING_TO_APPLY',
    });
  }
}
