import { applyDecorators, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

/** Marks a route as requiring a valid access token. No permissions/RBAC yet — that's a later task. */
export function Authenticated() {
  return applyDecorators(UseGuards(JwtAuthGuard));
}
