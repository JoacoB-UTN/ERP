import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { SafeUser } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService, type SessionMeta } from './session.service';
import {
  PASSWORD_RESET_DELIVERY,
  PASSWORD_RESET_TOKEN_TTL_MS,
} from './auth.constants';
import type { PasswordResetDelivery } from './password-reset-delivery';
import type { User } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuditRecordInput } from '../audit/audit.types';

const GENERIC_LOGIN_ERROR = 'Invalid email or password.';
const GENERIC_RESET_ERROR = 'This reset link is invalid or has expired.';

export interface AuthResult {
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    status: user.status,
  };
}

@Injectable()
export class AuthService {
  /** Security event log — distinct from the future business AuditLog (see CLAUDE.md). */
  private readonly securityLogger = new Logger('Security');

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    @Inject(PASSWORD_RESET_DELIVERY)
    private readonly passwordResetDelivery: PasswordResetDelivery,
  ) {}

  /**
   * Best-effort: an audit-table hiccup must never block authentication —
   * unlike the RBAC mutations in RolesService (which commit atomically
   * with their audit record inside a $transaction because CLAUDE.md
   * requires it for those critical business mutations), auth/security
   * events here are traceability on top of an already-committed outcome.
   * Failure is logged, never rethrown. See docs/audit-architecture.md.
   */
  private async safeAudit(input: AuditRecordInput): Promise<void> {
    try {
      await this.auditService.record(input);
    } catch (error) {
      this.securityLogger.warn({
        event: 'audit_write_failed',
        action: input.action,
        entityType: input.entityType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async login(
    email: string,
    password: string,
    meta: SessionMeta,
  ): Promise<AuthResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      this.securityLogger.warn({
        event: 'login_failure',
        reason: 'unknown_email',
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    if (user.status !== 'ACTIVE') {
      this.securityLogger.warn({
        event: 'login_failure',
        reason: 'inactive_user',
        userId: user.id,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordOk = await this.passwordService.verify(
      user.passwordHash,
      password,
    );
    if (!passwordOk) {
      this.securityLogger.warn({
        event: 'login_failure',
        reason: 'bad_password',
        userId: user.id,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const { session, rawToken } = await this.sessionService.createSession(
      user.id,
      meta,
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      sid: session.id,
    });
    this.securityLogger.log({ event: 'login_success', userId: user.id });

    // tenantId/companyId are intentionally omitted — company selection
    // happens after login (see docs/audit-architecture.md and CLAUDE.md's
    // "don't force a fake companyId" rule); a user's UserCompany
    // memberships can in principle span more than one tenant.
    await this.safeAudit({
      userId: user.id,
      sessionId: session.id,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
    });

    return {
      user: toSafeUser(user),
      accessToken,
      refreshToken: rawToken,
      refreshTokenExpiresAt: session.expiresAt,
    };
  }

  async refresh(
    rawRefreshToken: string,
    meta: SessionMeta,
  ): Promise<AuthResult> {
    const rotated = await this.sessionService.rotateSession(
      rawRefreshToken,
      meta,
    );
    if (!rotated) {
      this.securityLogger.warn({
        event: 'refresh_failure',
        reason: 'invalid_or_expired_session',
      });
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
    });
    if (!user || user.status !== 'ACTIVE') {
      await this.sessionService.revokeAllForUser(rotated.userId);
      this.securityLogger.warn({
        event: 'refresh_failure',
        reason: 'user_unavailable',
        userId: rotated.userId,
      });
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    const accessToken = this.tokenService.signAccessToken({
      sub: user.id,
      email: user.email,
      sid: rotated.session.id,
    });

    return {
      user: toSafeUser(user),
      accessToken,
      refreshToken: rotated.rawToken,
      refreshTokenExpiresAt: rotated.session.expiresAt,
    };
  }

  /**
   * Idempotent by design — repeated logout must never error. Only writes
   * an audit record when a real session was revoked; a repeat call that
   * finds nothing is not a new fact (see CLAUDE.md — audit describes what
   * actually happened).
   */
  async logout(
    rawRefreshToken: string | undefined,
    meta: SessionMeta,
  ): Promise<void> {
    if (!rawRefreshToken) return;
    const revoked = await this.sessionService.revokeByRawToken(rawRefreshToken);
    this.securityLogger.log({ event: 'logout' });
    if (revoked) {
      await this.safeAudit({
        userId: revoked.userId,
        sessionId: revoked.id,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: revoked.userId,
      });
    }
  }

  async logoutAll(userId: string, meta: SessionMeta): Promise<void> {
    const count = await this.sessionService.revokeAllForUser(userId);
    this.securityLogger.log({ event: 'sessions_revoked', userId, count });
    if (count > 0) {
      await this.safeAudit({
        userId,
        requestId: meta.requestId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        action: 'SESSION_REVOKE',
        entityType: 'User',
        entityId: userId,
        metadata: { numberOfSessionsRevoked: count },
      });
    }
  }

  async getMe(userId: string): Promise<{ user: SafeUser }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }
    return { user: toSafeUser(user) };
  }

  /**
   * Changing your password revokes every OTHER session (compromised
   * credential should not leave other devices logged in) but keeps the
   * session that made this request alive, identified by the `sid` claim
   * embedded in its access token — no re-login needed on the device that
   * just changed the password.
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    meta: SessionMeta,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
    }

    const currentOk = await this.passwordService.verify(
      user.passwordHash,
      currentPassword,
    );
    if (!currentOk) {
      this.securityLogger.warn({
        event: 'password_change_failure',
        reason: 'bad_current_password',
        userId,
      });
      throw new BadRequestException('Current password is incorrect.');
    }

    const newHash = await this.passwordService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
    const revoked = await this.sessionService.revokeAllForUser(
      userId,
      currentSessionId,
    );

    this.securityLogger.log({
      event: 'password_changed',
      userId,
      otherSessionsRevoked: revoked,
    });

    // Never include old/new password or hash in metadata — see CLAUDE.md.
    await this.safeAudit({
      userId,
      sessionId: currentSessionId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      action: 'PASSWORD_CHANGE',
      entityType: 'User',
      entityId: userId,
      metadata: {
        otherSessionsRevoked: revoked > 0,
        sessionsRevokedCount: revoked,
      },
    });
  }

  /** Always resolves — the controller returns the same generic message whether or not the account exists. */
  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (!user || user.status !== 'ACTIVE') {
      this.securityLogger.log({
        event: 'password_reset_requested',
        outcome: 'no_matching_active_user',
      });
      return;
    }

    const rawToken = this.tokenService.generateOpaqueToken();
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
    await this.passwordResetDelivery.deliver({
      email: user.email,
      token: rawToken,
      expiresAt,
    });

    this.securityLogger.log({
      event: 'password_reset_requested',
      outcome: 'delivered',
      userId: user.id,
    });
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    meta: SessionMeta,
  ): Promise<void> {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      this.securityLogger.warn({
        event: 'password_reset_failure',
        reason: 'invalid_expired_or_used_token',
      });
      throw new BadRequestException(GENERIC_RESET_ERROR);
    }

    const newHash = await this.passwordService.hash(newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: newHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    this.securityLogger.log({
      event: 'password_reset_completed',
      userId: record.userId,
    });

    // Never include the reset token (raw or hashed) — see CLAUDE.md.
    await this.safeAudit({
      userId: record.userId,
      requestId: meta.requestId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      action: 'PASSWORD_RESET',
      entityType: 'User',
      entityId: record.userId,
    });
  }
}
