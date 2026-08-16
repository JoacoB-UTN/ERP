import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';
import { PrismaService } from '../database/prisma.service';
import { parseDurationMs } from '../common/utils/duration';
import { TokenService } from './token.service';
import type { UserSession } from '../generated/prisma/client';

export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
  /** For AuditLog.requestId correlation — see docs/audit-architecture.md. Not persisted on UserSession itself. */
  requestId?: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  private refreshTtlMs(): number {
    return parseDurationMs(
      this.configService.get('AUTH_REFRESH_TOKEN_TTL', { infer: true }),
    );
  }

  async createSession(
    userId: string,
    meta: SessionMeta,
  ): Promise<{ session: UserSession; rawToken: string }> {
    const rawToken = this.tokenService.generateOpaqueToken();
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    const session = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    return { session, rawToken };
  }

  /**
   * Validates a raw refresh token and, if valid, atomically revokes it and
   * issues a replacement (rotation) — the old credential can never be used
   * again, which is what makes basic refresh-token replay detectable/
   * preventable.
   */
  async rotateSession(
    rawToken: string,
    meta: SessionMeta,
  ): Promise<{
    session: UserSession;
    rawToken: string;
    userId: string;
  } | null> {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const existing = await this.prisma.userSession.findUnique({
      where: { tokenHash },
    });

    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() < Date.now()
    ) {
      return null;
    }

    const newRawToken = this.tokenService.generateOpaqueToken();
    const newTokenHash = this.tokenService.hashOpaqueToken(newRawToken);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs());

    const [, session] = await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      }),
      this.prisma.userSession.create({
        data: {
          userId: existing.userId,
          tokenHash: newTokenHash,
          expiresAt,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      }),
    ]);

    return { session, rawToken: newRawToken, userId: existing.userId };
  }

  /**
   * Idempotent: revoking an already-revoked/unknown token is not an error
   * — returns null in that case (repeated logout must never fail, and a
   * repeat that finds nothing is not a new fact worth auditing; see
   * AuthService.logout). Returns the session identity on a real
   * revocation, so the caller can attribute an audit record to it.
   */
  async revokeByRawToken(
    rawToken: string,
  ): Promise<{ id: string; userId: string } | null> {
    const tokenHash = this.tokenService.hashOpaqueToken(rawToken);
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
    });
    if (!session || session.revokedAt) {
      return null;
    }
    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return { id: session.id, userId: session.userId };
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
