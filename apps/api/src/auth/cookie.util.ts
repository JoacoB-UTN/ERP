import type { CookieOptions, Request } from 'express';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';
import { getRequestId } from '../common/utils/request-id.util';
import type { SessionMeta } from './session.service';

export function buildCookieOptions(
  configService: ConfigService<Env, true>,
  maxAgeMs: number,
): CookieOptions {
  const domain = configService.get('AUTH_COOKIE_DOMAIN', { infer: true });
  return {
    httpOnly: true,
    secure: configService.get('AUTH_COOKIE_SECURE', { infer: true }),
    // "lax" is enough here: browsers treat different localhost ports as the
    // same site, so Gestión/Facturación/API share cookies in dev without
    // needing "none" (which would also require Secure, i.e. HTTPS).
    sameSite: 'lax',
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: maxAgeMs,
  };
}

export function clearedCookieOptions(
  configService: ConfigService<Env, true>,
): CookieOptions {
  return buildCookieOptions(configService, 0);
}

export function getSessionMeta(req: Request): SessionMeta {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    requestId: getRequestId(req),
  };
}

/**
 * @types/express-serve-static-core declares `Request.cookies` as `any`
 * (cookie-parser isn't in Express core), which poisons any direct read
 * with `no-unsafe-assignment`/`no-unsafe-argument` regardless of the
 * `Express.Request.cookies` augmentation in `express.d.ts`. Centralizing
 * the read here with an explicit return type gives every caller a real
 * `string | undefined` instead of `any`.
 */
export function getCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined>;
  return cookies?.[name];
}
