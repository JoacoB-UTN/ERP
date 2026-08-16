import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Used for both "role doesn't exist" and "role belongs to a different
 * company" — identical response either way, same reasoning as
 * CompanyAccessDeniedException in company-context: never reveal whether a
 * resource outside the caller's scope exists. See CLAUDE.md.
 */
export class RoleNotFoundException extends NotFoundException {
  constructor() {
    super({ message: 'Rol no encontrado.', code: 'ROLE_NOT_FOUND' });
  }
}

export class SystemRoleProtectedException extends BadRequestException {
  constructor() {
    super({
      message:
        'No se pueden modificar las propiedades protegidas de un rol del sistema.',
      code: 'SYSTEM_ROLE_PROTECTED',
    });
  }
}

export class UnknownPermissionCodeException extends BadRequestException {
  constructor(codes: string[]) {
    super({
      message: 'Uno o más códigos de permiso no son válidos.',
      code: 'UNKNOWN_PERMISSION_CODE',
      details: { codes },
    });
  }
}

export class UserNotCompanyMemberException extends BadRequestException {
  constructor() {
    super({
      message: 'El usuario no tiene acceso activo a esta empresa.',
      code: 'USER_NOT_COMPANY_MEMBER',
    });
  }
}

export class DuplicateRoleAssignmentException extends ConflictException {
  constructor() {
    super({
      message: 'El usuario ya tiene asignado ese rol.',
      code: 'DUPLICATE_ROLE_ASSIGNMENT',
    });
  }
}

/**
 * See docs/authorization.md ("privilege accident" protection, CLAUDE.md
 * section 54 of Prompt #4): refuses an action that would leave the
 * company with zero users able to manage roles/permissions.
 */
export class LastSecurityAdminException extends ConflictException {
  constructor() {
    super({
      message:
        'Esta acción dejaría a la empresa sin ningún usuario con permisos para administrar roles. Asigná el permiso a otro usuario primero.',
      code: 'LAST_SECURITY_ADMIN',
    });
  }
}

/**
 * Same "don't reveal existence outside the caller's scope" reasoning as
 * RoleNotFoundException — used both when the id doesn't exist at all and
 * when it belongs to a different company. See CLAUDE.md.
 */
export class AuditLogNotFoundException extends NotFoundException {
  constructor() {
    super({
      message: 'Registro de auditoría no encontrado.',
      code: 'AUDIT_LOG_NOT_FOUND',
    });
  }
}

export class UnsupportedAuditEntityTypeException extends BadRequestException {
  constructor(entityType: string) {
    super({
      message: 'Tipo de entidad no soportado para historial de auditoría.',
      code: 'UNSUPPORTED_AUDIT_ENTITY_TYPE',
      details: { entityType },
    });
  }
}
