import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The tenant derived from the active company — never read from a client
 * header. Use only on routes guarded by @CompanyScoped().
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.companyContext!.tenantId;
  },
);
