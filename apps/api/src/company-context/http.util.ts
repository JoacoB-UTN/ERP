import type { Request } from 'express';
import { z } from 'zod';

const uuidSchema = z.string().uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/** A request may carry the same header twice; only the first value is meaningful here. */
export function getHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
