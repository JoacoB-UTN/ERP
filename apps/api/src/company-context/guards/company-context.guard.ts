import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { COMPANY_ID_HEADER, BRANCH_ID_HEADER } from '@erp/shared';
import type { AuthenticatedUser } from '../../auth/types';
import { CompanyContextService } from '../company-context.service';
import {
  CompanyContextRequiredException,
  InvalidCompanyContextException,
  BranchAccessInvalidException,
} from '../company-context.exceptions';
import { getHeader, isUuid } from '../http.util';
import { getRequestId } from '../../common/utils/request-id.util';

/**
 * Enforces the request-scoped company context described in
 * docs/multi-company-architecture.md. Must run AFTER JwtAuthGuard (see
 * @CompanyScoped(), which applies both in order) — it needs `request.user`
 * already populated.
 *
 * Steps (per CLAUDE.md): read X-Company-Id → validate UUID → validate
 * membership/company/tenant are active → optionally validate X-Branch-Id
 * the same way, scoped to that company → attach the validated
 * RequestContext. Any failure rejects the request; nothing here is ever
 * inferred from data the client sent without a DB check.
 */
@Injectable()
export class CompanyContextGuard implements CanActivate {
  constructor(private readonly companyContextService: CompanyContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser;

    const companyIdHeader = getHeader(request, COMPANY_ID_HEADER);
    if (!companyIdHeader) {
      throw new CompanyContextRequiredException();
    }
    if (!isUuid(companyIdHeader)) {
      throw new InvalidCompanyContextException();
    }

    const { companyId, tenantId } =
      await this.companyContextService.validateCompanyAccess(
        user.sub,
        companyIdHeader,
      );

    const branchIdHeader = getHeader(request, BRANCH_ID_HEADER);
    let branchId: string | undefined;
    if (branchIdHeader) {
      if (!isUuid(branchIdHeader)) {
        throw new BranchAccessInvalidException();
      }
      branchId = await this.companyContextService.validateBranchAccess(
        companyId,
        branchIdHeader,
      );
    }

    request.companyContext = {
      userId: user.sub,
      companyId,
      tenantId,
      branchId,
      sessionId: user.sid,
      requestId: getRequestId(request),
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
    };
    return true;
  }
}
