import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER, BRANCH_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

interface ErrorEnvelope {
  error: { code: string; message: string };
}

interface CompaniesBody {
  companies: { id: string }[];
}

/**
 * Mandatory tenant/company/branch isolation coverage per CLAUDE.md and
 * docs/multi-company-architecture.md. Every fixture is created and torn
 * down within this file — it deliberately does not depend on the dev
 * seed, so it stays correct regardless of what's in prisma/seed.ts.
 */
describe('Company context (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const suffix = Date.now();
  const userEmail = `e2e-company-context-${suffix}@example.com`;
  const userPassword = 'e2e-test-password-1234';
  let userId: string;

  let tenantA: string;
  let tenantB: string;

  // Tenant A companies
  let companyA: string; // active membership — the "success" baseline
  let companyASameTenantNoAccess: string; // tenant A, no membership at all
  let companyAInactiveMembership: string; // membership exists but active:false
  let companyAInactiveStatus: string; // active membership, but company.status !== ACTIVE

  // Tenant B (wholly different tenant)
  let companyB: string; // no membership — cross-tenant isolation

  let branchOfCompanyA: string;
  let branchOfCompanyB: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);

    const tA = await prisma.tenant.create({
      data: { name: `E2E Tenant A ${suffix}`, slug: `e2e-tenant-a-${suffix}` },
    });
    const tB = await prisma.tenant.create({
      data: { name: `E2E Tenant B ${suffix}`, slug: `e2e-tenant-b-${suffix}` },
    });
    tenantA = tA.id;
    tenantB = tB.id;

    const cA = await prisma.company.create({
      data: {
        tenantId: tenantA,
        legalName: 'E2E Company A',
        taxId: `e2e-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const cASameTenant = await prisma.company.create({
      data: {
        tenantId: tenantA,
        legalName: 'E2E Company A (no access)',
        taxId: `e2e-a-noaccess-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const cAInactiveMembership = await prisma.company.create({
      data: {
        tenantId: tenantA,
        legalName: 'E2E Company A (inactive membership)',
        taxId: `e2e-a-inactive-membership-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const cAInactiveStatus = await prisma.company.create({
      data: {
        tenantId: tenantA,
        legalName: 'E2E Company A (inactive company)',
        taxId: `e2e-a-inactive-status-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
        status: 'INACTIVE',
      },
    });
    const cB = await prisma.company.create({
      data: {
        tenantId: tenantB,
        legalName: 'E2E Company B',
        taxId: `e2e-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });

    companyA = cA.id;
    companyASameTenantNoAccess = cASameTenant.id;
    companyAInactiveMembership = cAInactiveMembership.id;
    companyAInactiveStatus = cAInactiveStatus.id;
    companyB = cB.id;

    const bA = await prisma.branch.create({
      data: {
        tenantId: tenantA,
        companyId: companyA,
        code: 'MAIN',
        name: 'Branch A',
      },
    });
    const bB = await prisma.branch.create({
      data: {
        tenantId: tenantB,
        companyId: companyB,
        code: 'MAIN',
        name: 'Branch B',
      },
    });
    branchOfCompanyA = bA.id;
    branchOfCompanyB = bB.id;

    const passwordHash = await argon2.hash(userPassword, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'CompanyContext',
        email: userEmail,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    userId = user.id;

    await prisma.userCompany.create({
      data: { userId, tenantId: tenantA, companyId: companyA, active: true },
    });
    await prisma.userCompany.create({
      data: {
        userId,
        tenantId: tenantA,
        companyId: companyAInactiveMembership,
        active: false,
      },
    });
    await prisma.userCompany.create({
      data: {
        userId,
        tenantId: tenantA,
        companyId: companyAInactiveStatus,
        active: true,
      },
    });
    // Deliberately NO membership row for companyASameTenantNoAccess or companyB.
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({ where: { userId } });
    await prisma.userCompany.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.branch.deleteMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    await prisma.company.deleteMany({
      where: { tenantId: { in: [tenantA, tenantB] } },
    });
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantA, tenantB] } },
    });
    await app.close();
  });

  async function loginAgent() {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: userEmail, password: userPassword });
    expect(res.status).toBe(200);
    return agent;
  }

  it('allows a company-scoped request for a company the user has active access to', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyA);
    expect(res.status).toBe(200);
    const body = res.body as { company: { id: string } };
    expect(body.company.id).toBe(companyA);
  });

  // Section 37 — cross-tenant isolation is mandatory.
  it('denies a company belonging to a different tenant the user has no membership in', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyB);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'COMPANY_ACCESS_DENIED',
    );
  });

  // Section 38 — same-tenant does not imply access.
  it('denies a company in the SAME tenant the user has no membership in', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyASameTenantNoAccess);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'COMPANY_ACCESS_DENIED',
    );
  });

  // Section 39
  it('rejects a company-scoped request with no X-Company-Id header', async () => {
    const agent = await loginAgent();
    const res = await agent.get('/api/v1/context/current');
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'COMPANY_CONTEXT_REQUIRED',
    );
  });

  // Section 40 — malformed input must never reach a 500.
  it('rejects a malformed X-Company-Id cleanly, not as a server error', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, 'not-a-uuid');
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'INVALID_COMPANY_CONTEXT',
    );
  });

  // Section 41
  it('denies access when the membership itself is inactive', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyAInactiveMembership);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe('COMPANY_INACTIVE');
  });

  // Section 42
  it('denies access when the company itself is inactive', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyAInactiveStatus);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe('COMPANY_INACTIVE');
  });

  // Section 43 — mandatory branch isolation test.
  it('accepts a branch that belongs to the active company', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyA)
      .set(BRANCH_ID_HEADER, branchOfCompanyA);
    expect(res.status).toBe(200);
    const body = res.body as { branch: { id: string } | null };
    expect(body.branch?.id).toBe(branchOfCompanyA);
  });

  it('rejects a branch that belongs to a DIFFERENT company than the active one', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get('/api/v1/context/current')
      .set(COMPANY_ID_HEADER, companyA)
      .set(BRANCH_ID_HEADER, branchOfCompanyB);
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'BRANCH_ACCESS_INVALID',
    );
  });

  // Section 44 — the company list must never leak inaccessible companies.
  it('GET /context/companies returns only companies the user actually has active access to', async () => {
    const agent = await loginAgent();
    const res = await agent.get('/api/v1/context/companies');
    expect(res.status).toBe(200);
    const ids = (res.body as CompaniesBody).companies.map((c) => c.id);
    expect(ids).toContain(companyA);
    expect(ids).not.toContain(companyB);
    expect(ids).not.toContain(companyASameTenantNoAccess);
    expect(ids).not.toContain(companyAInactiveMembership);
    expect(ids).not.toContain(companyAInactiveStatus);
  });
});
