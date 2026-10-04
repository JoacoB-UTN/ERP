import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER, type FiscalSettingsResponse } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ArcaConnectivityService } from '../src/fiscal/arca-connectivity.service';

describe('Fiscal homologation settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tenants: string[] = [],
    companies: string[] = [],
    users: string[] = [];
  const suffix = randomUUID();
  let admin: request.Agent, denied: request.Agent;
  const probe = jest.fn().mockResolvedValue({
    environment: 'HOMOLOGATION',
    checkedAt: new Date().toISOString(),
    status: 'AVAILABLE',
    services: { application: 'OK', database: 'OK', authentication: 'OK' },
    authorizationAvailable: false,
    message: 'Public probe only',
  });
  const url = '/api/v1/fiscal/settings';
  const payload = {
    vatCondition: 'RESPONSABLE_INSCRIPTO',
    testPointOfSale: 12,
    expectedRevision: 0,
  };
  const save = (body: object, company = companies[0]) =>
    admin.put(url).set(COMPANY_ID_HEADER, company).send(body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ArcaConnectivityService)
      .useValue({ check: probe })
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    for (let i = 0; i < 2; i++) {
      const tenant = await prisma.tenant.create({
        data: { name: 'Settings', slug: `fiscal-settings-${i}-${suffix}` },
      });
      tenants.push(tenant.id);
      const company = await prisma.company.create({
        data: {
          tenantId: tenant.id,
          legalName: 'Test issuer',
          taxId: '20123456786',
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      });
      companies.push(company.id);
    }
    for (let i = 0; i < 2; i++) {
      const password = 'Settings-test-only-1234';
      const user = await prisma.user.create({
        data: {
          email: `settings-${i}-${suffix}@example.com`,
          firstName: 'Test',
          lastName: 'Settings',
          status: 'ACTIVE',
          passwordHash: await argon2.hash(password),
        },
      });
      users.push(user.id);
      const code = i === 0 ? 'configuration.manage' : 'sales.invoices.create';
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: i === 0 ? 'configuration' : 'sales',
          resource: i === 0 ? 'configuration' : 'invoices',
          action: i === 0 ? 'manage' : 'create',
        },
      });
      for (let n = 0; n < 2; n++) {
        const role = await prisma.role.create({
          data: {
            tenantId: tenants[n],
            companyId: companies[n],
            name: `Settings ${i}`,
            rolePermissions: { create: { permissionId: permission.id } },
          },
        });
        await prisma.userCompany.create({
          data: {
            userId: user.id,
            tenantId: tenants[n],
            companyId: companies[n],
            active: true,
          },
        });
        await prisma.userRole.create({
          data: { userId: user.id, companyId: companies[n], roleId: role.id },
        });
      }
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);
      if (i === 0) admin = agent;
      else denied = agent;
    }
  });
  beforeEach(async () => {
    probe.mockClear();
    await prisma.fiscalSettings.deleteMany({
      where: { tenantId: { in: tenants } },
    });
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma) {
      await prisma.fiscalSettings.deleteMany({
        where: { tenantId: { in: tenants } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [{ tenantId: { in: tenants } }, { userId: { in: users } }],
        },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
      await prisma.rolePermission.deleteMany({
        where: { role: { tenantId: { in: tenants } } },
      });
      await prisma.role.deleteMany({ where: { tenantId: { in: tenants } } });
      await prisma.userCompany.deleteMany({ where: { userId: { in: users } } });
      await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.company.deleteMany({ where: { id: { in: companies } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
    }
    await app?.close();
  });
  it('requires configuration permission on every route, including public probe', async () => {
    await request(app.getHttpServer()).get(url).expect(401);
    await denied.get(url).set(COMPANY_ID_HEADER, companies[0]).expect(403);
    await denied
      .put(url)
      .set(COMPANY_ID_HEADER, companies[0])
      .send(payload)
      .expect(403);
    await denied
      .post(`${url}/connectivity`)
      .set(COMPANY_ID_HEADER, companies[0])
      .send({})
      .expect(403);
    expect(probe).not.toHaveBeenCalled();
  });
  it('keeps unknown values unset and separate across tenants, never authorizes', async () => {
    const empty = await admin
      .get(url)
      .set(COMPANY_ID_HEADER, companies[0])
      .expect(200);
    expect((empty.body as FiscalSettingsResponse).settings).toMatchObject({
      vatCondition: null,
      testPointOfSale: null,
      revision: 0,
      authorizationAvailable: false,
    });
    await save(payload).expect(200);
    const foreign = await admin
      .get(url)
      .set(COMPANY_ID_HEADER, companies[1])
      .expect(200);
    expect((foreign.body as FiscalSettingsResponse).settings.revision).toBe(0);
    const result = await admin
      .get(url)
      .set(COMPANY_ID_HEADER, companies[0])
      .expect(200);
    expect((result.body as FiscalSettingsResponse).settings).toMatchObject({
      vatCondition: payload.vatCondition,
      testPointOfSale: 12,
      revision: 1,
      authorizationAvailable: false,
    });
    expect(
      (result.body as FiscalSettingsResponse).settings.pendingRequirements
        .length,
    ).toBeGreaterThan(0);
    await save({
      vatCondition: null,
      testPointOfSale: null,
      expectedRevision: 1,
    }).expect(200);
    expect(
      await prisma.company.findUnique({ where: { id: companies[0] } }),
    ).toMatchObject({ taxId: '20123456786', legalName: 'Test issuer' });
  });
  it('checks local CUIT syntax without silently normalizing invalid master data or claiming registration', async () => {
    try {
      await prisma.company.update({
        where: { id: companies[0] },
        data: { taxId: 'abc20123456786' },
      });
      const response = await admin
        .get(url)
        .set(COMPANY_ID_HEADER, companies[0])
        .expect(200);
      expect(
        (response.body as FiscalSettingsResponse).settings.issuer,
      ).toMatchObject({ taxId: 'abc20123456786', taxIdFormatValid: false });
      expect(
        (response.body as FiscalSettingsResponse).settings
          .authorizationAvailable,
      ).toBe(false);
    } finally {
      await prisma.company.update({
        where: { id: companies[0] },
        data: { taxId: '20123456786' },
      });
    }
  });
  it('rejects ownership, secrets, production and out-of-range values', async () => {
    for (const body of [
      { ...payload, companyId: companies[1] },
      { ...payload, environment: 'PRODUCTION' },
      { ...payload, privateKey: 'not-a-real-secret' },
      { ...payload, testPointOfSale: 0 },
      { ...payload, testPointOfSale: 100000 },
      { ...payload, testPointOfSale: 1.5 },
      { ...payload, vatCondition: 'UNKNOWN' },
    ])
      await save(body).expect(400);
    await admin
      .post(`${url}/connectivity`)
      .set(COMPANY_ID_HEADER, companies[0])
      .send({ url: 'http://localhost/' })
      .expect(400);
    expect(probe).not.toHaveBeenCalled();
  });
  it('serializes creation and updates, refusing stale revisions', async () => {
    const creates = await Promise.all([save(payload), save(payload)]);
    expect(creates.map((r) => r.status).sort()).toEqual([200, 409]);
    const edits = await Promise.all([
      save({ ...payload, expectedRevision: 1, testPointOfSale: 13 }),
      save({ ...payload, expectedRevision: 1, testPointOfSale: 14 }),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.fiscalSettings.count({ where: { companyId: companies[0] } }),
    ).toBe(1);
    expect(
      await prisma.fiscalSettings.findUnique({
        where: { companyId: companies[0] },
      }),
    ).toMatchObject({ revision: 2 });
  });
  it('audits saves atomically and rolls back when audit fails', async () => {
    const count = await prisma.auditLog.count({
      where: { entityType: 'FiscalSettings', companyId: companies[0] },
    });
    await save(payload).expect(200);
    expect(
      await prisma.auditLog.count({
        where: { entityType: 'FiscalSettings', companyId: companies[0] },
      }),
    ).toBe(count + 1);
    const failing = jest
      .spyOn(app.get(AuditService), 'recordFromContext')
      .mockRejectedValueOnce(new Error('Intentional failure'));
    try {
      await save({
        ...payload,
        expectedRevision: 1,
        testPointOfSale: 77,
      }).expect(500);
    } finally {
      failing.mockRestore();
    }
    expect(
      await prisma.fiscalSettings.findUnique({
        where: { companyId: companies[0] },
      }),
    ).toMatchObject({ revision: 1, testPointOfSale: 12 });
  });
  it('returns the bounded public probe but does not persist authorization or change settings', async () => {
    const result = await admin
      .post(`${url}/connectivity`)
      .set(COMPANY_ID_HEADER, companies[0])
      .send({})
      .expect(201);
    expect(result.body).toMatchObject({
      status: 'AVAILABLE',
      authorizationAvailable: false,
    });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(
      await prisma.fiscalSettings.count({ where: { companyId: companies[0] } }),
    ).toBe(0);
  });
});
