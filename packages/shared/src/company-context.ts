import type { CompanyStatus, BranchStatus } from './enums';

/**
 * Deliberately omits `tenantId`. Tenant is an architectural/security
 * concept the backend derives and enforces internally — the frontend
 * operates around Company identity only, so there is no reason to expose
 * it here. See docs/multi-company-architecture.md ("Tenant exposure").
 */
export interface CompanySummary {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  status: CompanyStatus;
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  status: BranchStatus;
}

export interface CompaniesResponse {
  companies: CompanySummary[];
}

export interface CompanyDetailResponse {
  company: CompanySummary;
}

export interface BranchesResponse {
  branches: BranchSummary[];
}

/** Response shape of GET /context/current — a minimal echo, not a business resource. */
export interface CurrentContextResponse {
  userId: string;
  company: { id: string; tradeName: string };
  branch: { id: string; name: string } | null;
}

export const COMPANY_ID_HEADER = 'x-company-id';
export const BRANCH_ID_HEADER = 'x-branch-id';
