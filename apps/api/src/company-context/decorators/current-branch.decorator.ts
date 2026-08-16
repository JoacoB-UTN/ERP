import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The validated active branchId, or undefined if the request didn't supply
 * X-Branch-Id — branch context is optional (see CLAUDE.md: not every
 * company-scoped operation is branch-scoped). Use only on routes guarded
 * by @CompanyScoped().
 */
export const CurrentBranch = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.companyContext!.branchId;
  },
);
