/**
 * Framework-agnostic mirrors of the Prisma enums in apps/api.
 * Kept here (rather than importing the generated Prisma client) so that
 * apps/web can use the same string literal unions without depending on
 * backend-only generated code.
 */

export const TenantStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export const CompanyStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type CompanyStatus = (typeof CompanyStatus)[keyof typeof CompanyStatus];

export const BranchStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type BranchStatus = (typeof BranchStatus)[keyof typeof BranchStatus];

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  BLOCKED: 'BLOCKED',
  PENDING: 'PENDING',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
