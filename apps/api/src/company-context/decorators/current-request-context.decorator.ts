import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../types';

/**
 * The full validated RequestContext. Prefer this in application/domain
 * services over passing the raw HTTP request around — see CLAUDE.md.
 * Use only on routes guarded by @CompanyScoped().
 */
export const CurrentRequestContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.companyContext!;
  },
);
