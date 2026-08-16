import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthorizationService } from '../authorization.service';
import { PermissionDeniedException } from '../authorization.exceptions';
import { REQUIRED_PERMISSIONS_KEY } from '../authorization.constants';

/**
 * Runs after JwtAuthGuard + CompanyContextGuard (see @RequirePermissions(),
 * which applies all three in order) — it needs `request.companyContext`
 * already populated and validated. Never trusts a companyId from
 * anywhere else. See CLAUDE.md.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger('Security');

  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const ctx = request.companyContext;
    if (!ctx) {
      // Programming error: @RequirePermissions() always applies
      // CompanyContextGuard first, so this should be unreachable.
      throw new PermissionDeniedException();
    }

    const allowed = await this.authorizationService.hasAllPermissions(
      ctx.userId,
      ctx.companyId,
      required,
    );
    if (!allowed) {
      this.logger.warn({
        event: 'permission_denied',
        userId: ctx.userId,
        companyId: ctx.companyId,
        required,
      });
      throw new PermissionDeniedException();
    }

    return true;
  }
}
