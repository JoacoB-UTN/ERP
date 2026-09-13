import { ConflictException } from '@nestjs/common';

export class ProductLineAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una línea con ese nombre en esta empresa.',
      code: 'PRODUCT_LINE_ALREADY_EXISTS',
    });
  }
}
