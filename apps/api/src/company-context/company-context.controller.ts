import { Controller, Get, Param } from '@nestjs/common';
import type {
  CompaniesResponse,
  CompanyDetailResponse,
  BranchesResponse,
  CurrentContextResponse,
} from '@erp/shared';
import { Authenticated } from '../auth/decorators/authenticated.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { CompanyScoped } from './decorators/company-scoped.decorator';
import { CurrentRequestContext } from './decorators/current-request-context.decorator';
import { CompanyContextService } from './company-context.service';
import { InvalidCompanyContextException } from './company-context.exceptions';
import { isUuid } from './http.util';
import type { RequestContext } from './types';

/**
 * "Which companies may I operate?" — not a business feature. See
 * CLAUDE.md: authentication answers "who," this answers "which company,"
 * and a future authorization layer answers "what may they do there."
 */
@Controller('context')
export class CompanyContextController {
  constructor(private readonly companyContextService: CompanyContextService) {}

  @Authenticated()
  @Get('companies')
  async listCompanies(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompaniesResponse> {
    const companies = await this.companyContextService.listAccessibleCompanies(
      user.sub,
    );
    return { companies };
  }

  @Authenticated()
  @Get('companies/:companyId')
  async getCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
  ): Promise<CompanyDetailResponse> {
    if (!isUuid(companyId)) {
      throw new InvalidCompanyContextException();
    }
    const company = await this.companyContextService.getAccessibleCompany(
      user.sub,
      companyId,
    );
    return { company };
  }

  @Authenticated()
  @Get('companies/:companyId/branches')
  async listBranches(
    @CurrentUser() user: AuthenticatedUser,
    @Param('companyId') companyId: string,
  ): Promise<BranchesResponse> {
    if (!isUuid(companyId)) {
      throw new InvalidCompanyContextException();
    }
    const branches = await this.companyContextService.listActiveBranches(
      user.sub,
      companyId,
    );
    return { branches };
  }

  /** Verifies the @CompanyScoped() guard chain end-to-end. Not a business feature — see CLAUDE.md. */
  @CompanyScoped()
  @Get('current')
  current(
    @CurrentRequestContext() ctx: RequestContext,
  ): Promise<CurrentContextResponse> {
    return this.companyContextService.describeContext(ctx);
  }
}
