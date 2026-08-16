import { Injectable } from '@nestjs/common';
import type {
  CompanySummary,
  BranchSummary,
  CurrentContextResponse,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import {
  CompanyAccessDeniedException,
  CompanyInactiveException,
  BranchAccessInvalidException,
} from './company-context.exceptions';
import type { RequestContext } from './types';
import type { Company } from '../generated/prisma/client';

interface ValidatedCompanyAccess {
  companyId: string;
  tenantId: string;
  company: Company;
}

function toCompanySummary(company: Company): CompanySummary {
  return {
    id: company.id,
    legalName: company.legalName,
    tradeName: company.tradeName,
    taxId: company.taxId,
    status: company.status,
  };
}

@Injectable()
export class CompanyContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The single place that decides "may this user act as this company right
   * now." Never trust a companyId from the client without going through
   * this. Distinguishes "no membership at all" (COMPANY_ACCESS_DENIED —
   * also covers companies belonging to another tenant, or that don't
   * exist: same response either way, see CLAUDE.md) from "membership
   * exists but something in the chain is inactive" (COMPANY_INACTIVE),
   * since only the latter is safe to state plainly to someone who does
   * have history with the company.
   */
  async validateCompanyAccess(
    userId: string,
    companyId: string,
  ): Promise<ValidatedCompanyAccess> {
    const membership = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
      include: { company: { include: { tenant: true } } },
    });

    if (!membership) {
      throw new CompanyAccessDeniedException();
    }
    if (
      !membership.active ||
      membership.company.status !== 'ACTIVE' ||
      membership.company.tenant.status !== 'ACTIVE'
    ) {
      throw new CompanyInactiveException();
    }

    return {
      companyId: membership.companyId,
      tenantId: membership.tenantId,
      company: membership.company,
    };
  }

  /** Only reachable after validateCompanyAccess — branchId must belong to that exact company. */
  async validateBranchAccess(
    companyId: string,
    branchId: string,
  ): Promise<string> {
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
    });
    if (
      !branch ||
      branch.companyId !== companyId ||
      branch.status !== 'ACTIVE'
    ) {
      throw new BranchAccessInvalidException();
    }
    return branch.id;
  }

  async listAccessibleCompanies(userId: string): Promise<CompanySummary[]> {
    const memberships = await this.prisma.userCompany.findMany({
      where: {
        userId,
        active: true,
        company: { status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      },
      include: { company: true },
      orderBy: { company: { legalName: 'asc' } },
    });
    return memberships.map((m) => toCompanySummary(m.company));
  }

  async getAccessibleCompany(
    userId: string,
    companyId: string,
  ): Promise<CompanySummary> {
    const { company } = await this.validateCompanyAccess(userId, companyId);
    return toCompanySummary(company);
  }

  async listActiveBranches(
    userId: string,
    companyId: string,
  ): Promise<BranchSummary[]> {
    // Access check first — never leak whether a company has branches to
    // someone who can't see the company at all.
    await this.validateCompanyAccess(userId, companyId);
    const branches = await this.prisma.branch.findMany({
      where: { companyId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
    return branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      status: b.status,
    }));
  }

  /**
   * Minimal display data for GET /context/current — a verification/test
   * endpoint for the context infrastructure itself (see CLAUDE.md), not a
   * business feature. Kept separate from the CompanySummary/BranchSummary
   * shapes used elsewhere since it only needs a label, not a full record.
   */
  async describeContext(ctx: RequestContext): Promise<CurrentContextResponse> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { id: true, tradeName: true, legalName: true },
    });
    const branch = ctx.branchId
      ? await this.prisma.branch.findUniqueOrThrow({
          where: { id: ctx.branchId },
          select: { id: true, name: true },
        })
      : null;

    return {
      userId: ctx.userId,
      company: {
        id: company.id,
        tradeName: company.tradeName ?? company.legalName,
      },
      branch,
    };
  }
}
