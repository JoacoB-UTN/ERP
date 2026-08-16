import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from '../token.service';
import { ACCESS_TOKEN_COOKIE } from '../auth.constants';
import { getCookie } from '../cookie.util';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = getCookie(request, ACCESS_TOKEN_COOKIE);

    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    const user = this.verify(token);

    // The JWT itself stays cryptographically valid until it naturally
    // expires (short TTL), but logout/logout-all/password-reset revoke the
    // underlying session immediately. Checking it here (instead of only at
    // refresh time) is what makes "log out of all devices" actually
    // instant instead of "instant for future refreshes, but the current
    // access token still works for up to AUTH_ACCESS_TOKEN_TTL".
    const session = await this.prisma.userSession.findUnique({
      where: { id: user.sid },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException('Session has been revoked.');
    }

    request.user = user;
    return true;
  }

  private verify(token: string) {
    try {
      return this.tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Authentication required.');
    }
  }
}
