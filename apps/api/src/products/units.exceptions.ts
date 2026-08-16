import { ConflictException } from '@nestjs/common';

export class UnitCodeAlreadyExistsException extends ConflictException {
  constructor() {
    super({
      message: 'Ya existe una unidad de medida con ese código en esta empresa.',
      code: 'UNIT_CODE_ALREADY_EXISTS',
    });
  }
}
