import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Authenticated + valid company context, but missing a required
 * permission. Deliberately generic — never states which permission was
 * missing (see CLAUDE.md: "avoid leaking permission details"). The
 * required codes are still safe to log server-side (PermissionGuard does).
 */
export class PermissionDeniedException extends HttpException {
  constructor() {
    super(
      {
        message: 'No tenés permisos para realizar esta acción.',
        code: 'PERMISSION_DENIED',
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
