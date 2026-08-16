import type { AuthenticatedUser } from './types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      cookies: Record<string, string | undefined>;
    }
  }
}

export {};
