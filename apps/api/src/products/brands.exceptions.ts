import { ConflictException } from '@nestjs/common';

export class BrandAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una marca con ese nombre en esta empresa.',
      code: 'BRAND_ALREADY_EXISTS',
    });
  }
}
