import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER, type CurrenciesResponse } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/** Run only against a disposable migrated database; no seed required. */
describe('Treasury currency catalog permissions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let companyId: string;
  let foreignCompanyId: string;
  let tenantId: string;
  let creator: request.Agent;
  let reader: request.Agent;
  let activeCurrencyId: string;
  let inactiveCurrencyId: string;
  const userIds: string[] = [];
  const currencyIds: string[] = [];
  const suffix = randomUUID();
  const password = 'Treasury-currencies-e2e-1234';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    const tenant = await prisma.tenant.create({
      data: { name: 'Currency test', slug: `currencies-${suffix}` },
    });
    tenantId = tenant.id;
    for (const foreign of [false, true]) {
      const company = await prisma.company.create({
        data: {
          tenantId,
          legalName: 'Currency test',
          taxId: `${foreign}-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      });
      if (foreign) foreignCompanyId = company.id;
      else companyId = company.id;
    }
    for (const active of [true, false]) {
      // Currency codes are free reference strings; unique to this suite.
      const currency = await prisma.currency.create({
        data: {
          code: `${active ? 'A' : 'I'}${suffix}`,
          name: 'Currency fixture',
          symbol: '$',
          active,
          decimalPlaces: 4,
        },
      });
      currencyIds.push(currency.id);
      if (active) activeCurrencyId = currency.id;
      else inactiveCurrencyId = currency.id;
    }
    for (const createOnly of [true, false]) {
      const code = createOnly
        ? 'treasury.accounts.create'
        : 'treasury.accounts.read';
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: 'treasury',
          resource: 'accounts',
          action: createOnly ? 'create' : 'read',
        },
      });
      const role = await prisma.role.create({
        data: {
          tenantId,
          companyId,
          name: code,
          rolePermissions: { create: { permissionId: permission.id } },
        },
      });
      const user = await prisma.user.create({
        data: {
          email: `${createOnly}-${suffix}@example.com`,
          firstName: 'Currency',
          lastName: 'Test',
          passwordHash: await argon2.hash(password),
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      await prisma.userCompany.create({
        data: { userId: user.id, tenantId, companyId, active: true },
      });
      await prisma.userRole.create({
        data: { userId: user.id, companyId, roleId: role.id },
      });
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);
      if (createOnly) creator = agent;
      else reader = agent;
    }
  });

  afterAll(async () => {
    if (prisma && tenantId) {
      await prisma.auditLog.deleteMany({
        where: { OR: [{ tenantId }, { userId: { in: userIds } }] },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.rolePermission.deleteMany({ where: { role: { tenantId } } });
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.userCompany.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.userSession.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.company.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
      await prisma.currency.deleteMany({ where: { id: { in: currencyIds } } });
    }
    await app?.close();
  });

  it('allows create-only without Pricing or account-read, returns only active public currency fields', async () => {
    const response = await creator
      .get('/api/v1/treasury/accounts/currencies')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(200);
    const { currencies } = response.body as CurrenciesResponse;
    expect(currencies.some((c) => c.id === inactiveCurrencyId)).toBe(false);
    expect(currencies.find((c) => c.id === activeCurrencyId)).toEqual({
      id: activeCurrencyId,
      code: `A${suffix}`,
      name: 'Currency fixture',
      symbol: '$',
      decimalPlaces: 4,
      active: true,
    });
    await creator
      .get('/api/v1/pricing/currencies')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(403);
    await creator
      .get('/api/v1/treasury/accounts')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(403);
  });
  it('rejects account-read without account-create', async () => {
    await reader
      .get('/api/v1/treasury/accounts/currencies')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(403);
  });
  it('requires authentication and validated company membership', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/treasury/accounts/currencies')
      .expect(401);
    await creator
      .get('/api/v1/treasury/accounts/currencies')
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(403);
  });
});
