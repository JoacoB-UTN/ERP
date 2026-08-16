import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';
import type { AuthenticatedUser } from './types';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  signAccessToken(payload: AuthenticatedUser): string {
    return this.jwtService.sign(payload, {
      secret: this.configService.get('AUTH_ACCESS_TOKEN_SECRET', {
        infer: true,
      }),
      expiresIn: this.configService.get('AUTH_ACCESS_TOKEN_TTL', {
        infer: true,
      }),
    });
  }

  verifyAccessToken(token: string): AuthenticatedUser {
    return this.jwtService.verify<AuthenticatedUser>(token, {
      secret: this.configService.get('AUTH_ACCESS_TOKEN_SECRET', {
        infer: true,
      }),
    });
  }

  /** A random opaque refresh/reset credential — never a JWT, never stored raw. */
  generateOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashOpaqueToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
