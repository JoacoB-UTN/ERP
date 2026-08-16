import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { PricingService } from '../src/pricing/pricing.service';
import { PriceListNotFoundException } from '../src/pricing/pricing.exceptions';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface PriceListBody {
  id: string;
  code: string;
  isDefault: boolean;
  basePriceListId: string | null;
  active: boolean;
}
interface PriceSetResultBody {
  variantId: string;
  price: string;
  effectiveFrom: string;
}
interface LookupResultBody {
  price: string;
  source: 'FIXED' | 'DERIVED';
}
interface HistoryEntryBody {
  oldPrice: string | null;
  newPrice: string;
  changeType: string;
  reason: string | null;
  changedBy: { id: string; name: string | null } | null;
}
interface BulkAdjustPreviewLineBody {
  variantId: string;
  currentPrice: string;
  newPrice: string;
}

/**
 * Mandatory Pricing coverage per the Prompt #9 task spec — see
 * docs/pricing.md. Self-contained fixtures, not the dev seed. Mixes
 * supertest (HTTP contract, permissions, company isolation) with direct
 * `app.get(PricingService)` calls for a service-layer isolation check —
 * same pattern as inventory.e2e-spec.ts.
 */
describe('Pricing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pricingService: PricingService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let currencyArsId: string;
  let currencyUsdId: string;

  let productMainId: string; // companyA
  let productBId: string; // companyB

  let userAdminId: string; // full pricing perms, member of A AND B
  let userListsReadOnlyId: string;
  let userNoListsCreateId: string;
  let userNoListsUpdateId: string;
  let userNoListsDeactivateId: string;
  let userNoPricesReadId: string;
  let userNoPricesUpdateId: string;
  let userNoBulkUpdateId: string;
  let userNoAccessId: string;

  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    pricingService = app.get(PricingService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Pricing Tenant ${suffix}`,
        slug: `e2e-pricing-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Pricing Company A',
        taxId: `e2e-pricing-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Pricing Company B',
        taxId: `e2e-pricing-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    // Currency is global reference data (see docs/pricing.md) — upsert
    // by code, suffixed so this run never collides with dev-seed ARS/USD/EUR.
    const currencyArs = await prisma.currency.upsert({
      where: { code: `ARS-${suffix}` },
      update: {},
      create: {
        code: `ARS-${suffix}`,
        name: 'Peso (E2E)',
        symbol: '$',
        decimalPlaces: 2,
      },
    });
    const currencyUsd = await prisma.currency.upsert({
      where: { code: `USD-${suffix}` },
      update: {},
      create: {
        code: `USD-${suffix}`,
        name: 'Dólar (E2E)',
        symbol: 'US$',
        decimalPlaces: 2,
      },
    });
    currencyArsId = currencyArs.id;
    currencyUsdId = currencyUsd.id;

    const unit = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });
    const unitB = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });

    const productMain = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `MAIN-${suffix}`,
        name: 'Main Product',
        baseUnitId: unit.id,
        trackInventory: false,
        productType: 'PRODUCT',
      },
    });
    productMainId = productMain.id;

    const productB = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `B-${suffix}`,
        name: 'Company B Product',
        baseUnitId: unitB.id,
        trackInventory: false,
        productType: 'PRODUCT',
      },
    });
    productBId = productB.id;

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'pricing', resource, action },
      });
    }
    const permListsRead = await makePermission('pricing.lists.read');
    const permListsCreate = await makePermission('pricing.lists.create');
    const permListsUpdate = await makePermission('pricing.lists.update');
    const permListsDeactivate = await makePermission(
      'pricing.lists.deactivate',
    );
    const permPricesRead = await makePermission('pricing.prices.read');
    const permPricesUpdate = await makePermission('pricing.prices.update');
    const permPricesBulkUpdate = await makePermission(
      'pricing.prices.bulk_update',
    );

    const ALL_PERM_IDS = [
      permListsRead.id,
      permListsCreate.id,
      permListsUpdate.id,
      permListsDeactivate.id,
      permPricesRead.id,
      permPricesUpdate.id,
      permPricesBulkUpdate.id,
    ];

    async function makeRole(
      companyId: string,
      name: string,
      permissionIds: string[],
    ) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name },
      });
      if (permissionIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
        });
      }
      return role;
    }

    const roleFullA = await makeRole(
      companyAId,
      'Pricing E2E Full A',
      ALL_PERM_IDS,
    );
    const roleFullB = await makeRole(
      companyBId,
      'Pricing E2E Full B',
      ALL_PERM_IDS,
    );
    const roleListsReadOnly = await makeRole(
      companyAId,
      'Pricing E2E Lists Read Only',
      [permListsRead.id],
    );
    const roleNoListsCreate = await makeRole(
      companyAId,
      'Pricing E2E No Lists Create',
      ALL_PERM_IDS.filter((id) => id !== permListsCreate.id),
    );
    const roleNoListsUpdate = await makeRole(
      companyAId,
      'Pricing E2E No Lists Update',
      ALL_PERM_IDS.filter((id) => id !== permListsUpdate.id),
    );
    const roleNoListsDeactivate = await makeRole(
      companyAId,
      'Pricing E2E No Lists Deactivate',
      ALL_PERM_IDS.filter((id) => id !== permListsDeactivate.id),
    );
    const roleNoPricesRead = await makeRole(
      companyAId,
      'Pricing E2E No Prices Read',
      ALL_PERM_IDS.filter((id) => id !== permPricesRead.id),
    );
    const roleNoPricesUpdate = await makeRole(
      companyAId,
      'Pricing E2E No Prices Update',
      ALL_PERM_IDS.filter((id) => id !== permPricesUpdate.id),
    );
    const roleNoBulkUpdate = await makeRole(
      companyAId,
      'Pricing E2E No Bulk Update',
      ALL_PERM_IDS.filter((id) => id !== permPricesBulkUpdate.id),
    );
    const roleNoAccess = await makeRole(
      companyAId,
      'Pricing E2E No Access',
      [],
    );

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-pricing-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userAdmin = await makeUser('Admin');
    const userListsReadOnly = await makeUser('ListsReadOnly');
    const userNoListsCreate = await makeUser('NoListsCreate');
    const userNoListsUpdate = await makeUser('NoListsUpdate');
    const userNoListsDeactivate = await makeUser('NoListsDeactivate');
    const userNoPricesRead = await makeUser('NoPricesRead');
    const userNoPricesUpdate = await makeUser('NoPricesUpdate');
    const userNoBulkUpdate = await makeUser('NoBulkUpdate');
    const userNoAccess = await makeUser('NoAccess');

    userAdminId = userAdmin.id;
    userListsReadOnlyId = userListsReadOnly.id;
    userNoListsCreateId = userNoListsCreate.id;
    userNoListsUpdateId = userNoListsUpdate.id;
    userNoListsDeactivateId = userNoListsDeactivate.id;
    userNoPricesReadId = userNoPricesRead.id;
    userNoPricesUpdateId = userNoPricesUpdate.id;
    userNoBulkUpdateId = userNoBulkUpdate.id;
    userNoAccessId = userNoAccess.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userAdminId, companyBId);
    await membership(userListsReadOnlyId, companyAId);
    await membership(userNoListsCreateId, companyAId);
    await membership(userNoListsUpdateId, companyAId);
    await membership(userNoListsDeactivateId, companyAId);
    await membership(userNoPricesReadId, companyAId);
    await membership(userNoPricesUpdateId, companyAId);
    await membership(userNoBulkUpdateId, companyAId);
    await membership(userNoAccessId, companyAId);

    async function assignRole(
      userId: string,
      roleId: string,
      companyId: string,
    ) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userAdminId, roleFullA.id, companyAId);
    await assignRole(userAdminId, roleFullB.id, companyBId);
    await assignRole(userListsReadOnlyId, roleListsReadOnly.id, companyAId);
    await assignRole(userNoListsCreateId, roleNoListsCreate.id, companyAId);
    await assignRole(userNoListsUpdateId, roleNoListsUpdate.id, companyAId);
    await assignRole(
      userNoListsDeactivateId,
      roleNoListsDeactivate.id,
      companyAId,
    );
    await assignRole(userNoPricesReadId, roleNoPricesRead.id, companyAId);
    await assignRole(userNoPricesUpdateId, roleNoPricesUpdate.id, companyAId);
    await assignRole(userNoBulkUpdateId, roleNoBulkUpdate.id, companyAId);
    await assignRole(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceHistory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceListItem.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    // Clear self-references before deleting PriceList rows (no onDelete cascade).
    await prisma.priceList.updateMany({
      where: { companyId: { in: [companyAId, companyBId] } },
      data: { basePriceListId: null },
    });
    await prisma.priceList.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.currency.deleteMany({
      where: { id: { in: [currencyArsId, currencyUsdId] } },
    });
    await prisma.productVariant.deleteMany({
      where: { product: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.product.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.unitOfMeasure.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userRole.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.role.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId] } },
    });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  const agentByUser = new Map<string, request.Agent>();
  async function loginAs(userId: string) {
    const cached = agentByUser.get(userId);
    if (cached) return cached;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    expect(res.status).toBe(200);
    agentByUser.set(userId, agent);
    return agent;
  }

  async function freshVariant(productId = productMainId, label = 'v') {
    const variant = await prisma.productVariant.create({
      data: { productId, name: `${label}-${suffix}-${Math.random()}` },
    });
    return variant.id;
  }

  async function createFixedList(
    agent: request.Agent,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await agent
      .post('/api/v1/pricing/lists')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        code: `FIX-${suffix}-${Math.random().toString(36).slice(2)}`,
        name: `Fixed List ${Math.random()}`,
        currencyId: currencyArsId,
        includesTax: false,
        pricingMode: 'FIXED',
        isDefault: false,
        ...overrides,
      });
    expect(res.status).toBe(201);
    return (res.body as { priceList: PriceListBody }).priceList;
  }

  // ---------------------------------------------------------------------
  // FIXED resolution
  // ---------------------------------------------------------------------
  describe('FIXED resolution', () => {
    it('a price set on a FIXED list resolves back exactly (Café=100 → 100)', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant();

      const set = await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100' });
      expect(set.status).toBe(200);
      expect((set.body as { result: PriceSetResultBody }).result.price).toBe(
        '100',
      );

      const lookup = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: list.id, productVariantId: variantId })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(lookup.status).toBe(200);
      const result = (lookup.body as { result: LookupResultBody }).result;
      expect(result.price).toBe('100');
      expect(result.source).toBe('FIXED');
    });
  });

  // ---------------------------------------------------------------------
  // DERIVED resolution — percentage chain and fixed-amount, Decimal-safe
  // ---------------------------------------------------------------------
  describe('DERIVED resolution', () => {
    it('percentage chain: 100 +20% = 120, then -10% off that = 108', async () => {
      const agent = await loginAs(userAdminId);
      const base = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'chain');
      await agent
        .put(`/api/v1/pricing/lists/${base.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100' });

      const level1 = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `L1-${suffix}`,
          name: `Level 1 ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '20',
        });
      expect(level1.status).toBe(201);
      const level1Id = (level1.body as { priceList: PriceListBody }).priceList
        .id;

      const level2 = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `L2-${suffix}`,
          name: `Level 2 ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: level1Id,
          adjustmentType: 'PERCENTAGE_DECREASE',
          adjustmentValue: '10',
        });
      expect(level2.status).toBe(201);
      const level2Id = (level2.body as { priceList: PriceListBody }).priceList
        .id;

      const lookup1 = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: level1Id, productVariantId: variantId })
        .set(COMPANY_ID_HEADER, companyAId);
      expect((lookup1.body as { result: LookupResultBody }).result.price).toBe(
        '120',
      );

      const lookup2 = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: level2Id, productVariantId: variantId })
        .set(COMPANY_ID_HEADER, companyAId);
      const result2 = (lookup2.body as { result: LookupResultBody }).result;
      expect(result2.price).toBe('108');
      expect(result2.source).toBe('DERIVED');
    });

    it('fixed amount: 100+25=125, 100-25=75, and a fixed decrease never goes negative', async () => {
      const agent = await loginAs(userAdminId);
      const base = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'fixedamt');
      await agent
        .put(`/api/v1/pricing/lists/${base.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100' });

      const increase = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `FA-INC-${suffix}`,
          name: `Fixed Increase ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'FIXED_AMOUNT_INCREASE',
          adjustmentValue: '25',
        });
      const decrease = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `FA-DEC-${suffix}`,
          name: `Fixed Decrease ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'FIXED_AMOUNT_DECREASE',
          adjustmentValue: '25',
        });
      const overDecrease = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `FA-OVERDEC-${suffix}`,
          name: `Fixed Over Decrease ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'FIXED_AMOUNT_DECREASE',
          adjustmentValue: '250', // 100 - 250 would be negative
        });

      const increaseId = (increase.body as { priceList: PriceListBody })
        .priceList.id;
      const decreaseId = (decrease.body as { priceList: PriceListBody })
        .priceList.id;
      const overDecreaseId = (overDecrease.body as { priceList: PriceListBody })
        .priceList.id;

      async function lookupPrice(priceListId: string) {
        const res = await agent
          .get('/api/v1/pricing/lookup')
          .query({ priceListId, productVariantId: variantId })
          .set(COMPANY_ID_HEADER, companyAId);
        return (res.body as { result: LookupResultBody }).result.price;
      }
      expect(await lookupPrice(increaseId)).toBe('125');
      expect(await lookupPrice(decreaseId)).toBe('75');
      expect(await lookupPrice(overDecreaseId)).toBe('0');
    });

    it('decimal safety: 100.15 + 12.5% rounds HALF_UP with no float artifact (112.67)', async () => {
      const agent = await loginAs(userAdminId);
      const base = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'decimal');
      await agent
        .put(`/api/v1/pricing/lists/${base.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100.15' });

      const derived = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `DEC-${suffix}`,
          name: `Decimal ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '12.5',
        });
      const derivedId = (derived.body as { priceList: PriceListBody }).priceList
        .id;

      const lookup = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: derivedId, productVariantId: variantId })
        .set(COMPANY_ID_HEADER, companyAId);
      expect((lookup.body as { result: LookupResultBody }).result.price).toBe(
        '112.67',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Cycle prevention
  // ---------------------------------------------------------------------
  describe('cycle prevention', () => {
    it('rejects a DERIVED list whose basePriceListId is itself', async () => {
      const agent = await loginAs(userAdminId);
      const base = await createFixedList(agent);
      const created = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `SELF-${suffix}`,
          name: `Self ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '10',
        });
      const listId = (created.body as { priceList: PriceListBody }).priceList
        .id;

      const selfUpdate = await agent
        .patch(`/api/v1/pricing/lists/${listId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ basePriceListId: listId });
      expect(selfUpdate.status).toBe(400);
      expect((selfUpdate.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_CYCLE',
      );
    });

    it('rejects a two-list cycle (A→B, then B updated to base=A) with no partial update', async () => {
      const agent = await loginAs(userAdminId);
      const root = await createFixedList(agent);

      const listA = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `CYC-A-${suffix}`,
          name: `Cycle A ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: root.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '5',
        });
      const listAId = (listA.body as { priceList: PriceListBody }).priceList.id;

      const listB = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `CYC-B-${suffix}`,
          name: `Cycle B ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: listAId,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '5',
        });
      const listBId = (listB.body as { priceList: PriceListBody }).priceList.id;

      // A → B → A would be a cycle — rejected, and A's basePriceListId must stay unchanged.
      const cyclic = await agent
        .patch(`/api/v1/pricing/lists/${listAId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ basePriceListId: listBId });
      expect(cyclic.status).toBe(400);
      expect((cyclic.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_CYCLE',
      );

      const reloaded = await agent
        .get(`/api/v1/pricing/lists/${listAId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { priceList: PriceListBody }).priceList
          .basePriceListId,
      ).toBe(root.id); // unchanged — no partial update
    });
  });

  // ---------------------------------------------------------------------
  // Currency mismatch
  // ---------------------------------------------------------------------
  describe('currency mismatch', () => {
    it('rejects a DERIVED list whose currency differs from its base', async () => {
      const agent = await loginAs(userAdminId);
      const arsBase = await createFixedList(agent, {
        currencyId: currencyArsId,
      });

      const res = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `MISMATCH-${suffix}`,
          name: `Mismatch ${suffix}`,
          currencyId: currencyUsdId,
          pricingMode: 'DERIVED',
          basePriceListId: arsBase.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '10',
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_CURRENCY_MISMATCH',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Default list — atomic switch
  // ---------------------------------------------------------------------
  describe('default list', () => {
    it('setting a new default atomically clears the previous default', async () => {
      const agent = await loginAs(userAdminId);
      const first = await createFixedList(agent, { isDefault: true });
      expect(first.isDefault).toBe(true);

      const second = await createFixedList(agent, { isDefault: true });
      expect(second.isDefault).toBe(true);

      const reloadedFirst = await agent
        .get(`/api/v1/pricing/lists/${first.id}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloadedFirst.body as { priceList: PriceListBody }).priceList
          .isDefault,
      ).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Missing price — never zero
  // ---------------------------------------------------------------------
  describe('missing price', () => {
    it('a variant with no price on a FIXED list returns PRICE_NOT_FOUND, never 0', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'unpriced');

      const res = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: list.id, productVariantId: variantId })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('PRICE_NOT_FOUND');
    });

    it('batch lookup reports found:false and price:null for an unpriced variant, never 0', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const pricedId = await freshVariant(productMainId, 'batchpriced');
      const unpricedId = await freshVariant(productMainId, 'batchunpriced');
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${pricedId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '50' });

      const res = await agent
        .post('/api/v1/pricing/lookup/batch')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          priceListId: list.id,
          productVariantIds: [pricedId, unpricedId],
        });
      expect(res.status).toBe(201); // POST with no explicit @HttpCode — Nest's default
      const items = (
        res.body as {
          items: {
            productVariantId: string;
            found: boolean;
            price: string | null;
          }[];
        }
      ).items;
      const pricedItem = items.find((i) => i.productVariantId === pricedId);
      const unpricedItem = items.find((i) => i.productVariantId === unpricedId);
      expect(pricedItem?.found).toBe(true);
      expect(pricedItem?.price).toBe('50.00');
      expect(unpricedItem?.found).toBe(false);
      expect(unpricedItem?.price).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Historical price boundary + overlap + PriceHistory + audit
  // ---------------------------------------------------------------------
  describe('effective dates, overlap, history, and audit', () => {
    it('boundary lookup resolves the price effective on that exact date; a later price auto-closes the prior one', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'boundary');

      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100', effectiveFrom: '2026-08-01' });
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '120', effectiveFrom: '2026-08-15' });

      async function lookupOn(date: string) {
        const res = await agent
          .get('/api/v1/pricing/lookup')
          .query({ priceListId: list.id, productVariantId: variantId, date })
          .set(COMPANY_ID_HEADER, companyAId);
        return (res.body as { result: LookupResultBody }).result.price;
      }
      expect(await lookupOn('2026-08-10')).toBe('100');
      expect(await lookupOn('2026-08-20')).toBe('120');
    });

    it('rejects a price whose validity ambiguously overlaps existing rows', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'overlap');

      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '100', effectiveFrom: '2026-08-01' });
      // Auto-closes the 08-01 row to effectiveUntil=08-04, inserts a new open-ended row from 08-05.
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '120', effectiveFrom: '2026-08-05' });

      // 08-03 falls inside BOTH the closed 08-01..08-04 row and would overlap the open-ended
      // 08-05 row's window per the overlap query — ambiguous, must be rejected.
      const res = await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '999', effectiveFrom: '2026-08-03' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_VALIDITY_OVERLAP',
      );
    });

    it('records PriceHistory with old/new price, effective date, actor, and reason', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'history');

      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '18500', effectiveFrom: '2026-08-01' });
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          price: '20000',
          effectiveFrom: '2026-08-10',
          reason: 'Ajuste de costos',
        });

      const res = await agent
        .get(`/api/v1/pricing/lists/${list.id}/products/${variantId}/history`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const items = (res.body as { items: HistoryEntryBody[] }).items;
      expect(items).toHaveLength(2);

      const manualEntry = items.find((i) => i.changeType === 'MANUAL');
      expect(manualEntry?.oldPrice).toBe('18500');
      expect(manualEntry?.newPrice).toBe('20000');
      expect(manualEntry?.reason).toBe('Ajuste de costos');
      expect(manualEntry?.changedBy?.id).toBe(userAdminId);

      const initialEntry = items.find((i) => i.changeType === 'INITIAL');
      expect(initialEntry?.oldPrice).toBeNull();
      expect(initialEntry?.newPrice).toBe('18500');
    });

    it('a price update audits an UPDATE event on the PriceList, distinct from PriceHistory', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'audit');

      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '42' });

      const audit = await prisma.auditLog.findFirst({
        where: {
          companyId: companyAId,
          entityType: 'PriceList',
          entityId: list.id,
          action: 'UPDATE',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit).not.toBeNull();
      expect((audit?.metadata as { change?: string } | null)?.change).toBe(
        'price_set',
      );

      const historyCount = await prisma.priceHistory.count({
        where: {
          companyId: companyAId,
          priceListId: list.id,
          productVariantId: variantId,
        },
      });
      expect(historyCount).toBe(1); // one PriceHistory row — a separate record from the AuditLog row above
    });
  });

  // ---------------------------------------------------------------------
  // Batch set — transactional, whole-batch rollback
  // ---------------------------------------------------------------------
  describe('batch set atomicity', () => {
    it('one cross-company variant in a batch fails the whole operation, no partial apply', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const validVariantId = await freshVariant(productMainId, 'batchvalid');
      const crossCompanyVariantId = await freshVariant(
        productBId,
        'batchcross',
      );

      const res = await agent
        .put(`/api/v1/pricing/lists/${list.id}/prices`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          items: [
            { productVariantId: validVariantId, price: '10' },
            { productVariantId: crossCompanyVariantId, price: '20' },
          ],
        });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_VARIANT_NOT_FOUND',
      );

      const lookup = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: list.id, productVariantId: validVariantId })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(lookup.status).toBe(404); // the valid line never got applied either
      expect((lookup.body as ErrorEnvelope).error.code).toBe('PRICE_NOT_FOUND');
    });
  });

  // ---------------------------------------------------------------------
  // Bulk adjustment — preview (no writes) then confirm (transactional)
  // ---------------------------------------------------------------------
  describe('bulk adjustment', () => {
    it('previews with no DB writes, then confirms 100/200/300 +10% -> 110/220/330 with history + one parent audit event', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const v1 = await freshVariant(productMainId, 'bulk1');
      const v2 = await freshVariant(productMainId, 'bulk2');
      const v3 = await freshVariant(productMainId, 'bulk3');
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/prices`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          items: [
            { productVariantId: v1, price: '100' },
            { productVariantId: v2, price: '200' },
            { productVariantId: v3, price: '300' },
          ],
        });

      const auditCountBefore = await prisma.auditLog.count({
        where: {
          companyId: companyAId,
          entityType: 'PriceList',
          entityId: list.id,
        },
      });

      const preview = await agent
        .post(`/api/v1/pricing/lists/${list.id}/bulk-adjust/preview`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          adjustmentType: 'PERCENTAGE_INCREASE',
          value: '10',
          effectiveFrom: '2026-09-01',
          scope: 'ALL',
        });
      expect(preview.status).toBe(200);
      const previewLines = (
        preview.body as {
          affectedCount: number;
          lines: BulkAdjustPreviewLineBody[];
        }
      ).lines;
      expect(previewLines).toHaveLength(3);
      const byVariant = (id: string) =>
        previewLines.find((l) => l.variantId === id);
      expect(byVariant(v1)?.newPrice).toBe('110');
      expect(byVariant(v2)?.newPrice).toBe('220');
      expect(byVariant(v3)?.newPrice).toBe('330');

      // Preview must not have written anything yet.
      const stillOld = await agent
        .get('/api/v1/pricing/lookup')
        .query({ priceListId: list.id, productVariantId: v1 })
        .set(COMPANY_ID_HEADER, companyAId);
      expect((stillOld.body as { result: LookupResultBody }).result.price).toBe(
        '100',
      );

      const confirm = await agent
        .post(`/api/v1/pricing/lists/${list.id}/bulk-adjust`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          adjustmentType: 'PERCENTAGE_INCREASE',
          value: '10',
          effectiveFrom: '2026-09-01',
          scope: 'ALL',
          reason: 'Ajuste general',
        });
      expect(confirm.status).toBe(201);
      expect((confirm.body as { affectedCount: number }).affectedCount).toBe(3);

      // The bulk adjustment's effectiveFrom (2026-09-01) is in the future relative to
      // "now" — look up ON that date, not the default "today", to see the new price.
      async function priceOf(variantId: string) {
        const res = await agent
          .get('/api/v1/pricing/lookup')
          .query({
            priceListId: list.id,
            productVariantId: variantId,
            date: '2026-09-01',
          })
          .set(COMPANY_ID_HEADER, companyAId);
        return (res.body as { result: LookupResultBody }).result.price;
      }
      expect(await priceOf(v1)).toBe('110');
      expect(await priceOf(v2)).toBe('220');
      expect(await priceOf(v3)).toBe('330');

      // Exactly ONE new parent audit event for the whole bulk operation, not one per variant.
      const auditCountAfter = await prisma.auditLog.count({
        where: {
          companyId: companyAId,
          entityType: 'PriceList',
          entityId: list.id,
        },
      });
      expect(auditCountAfter).toBe(auditCountBefore + 1);
      const bulkAudit = await prisma.auditLog.findFirst({
        where: {
          companyId: companyAId,
          entityType: 'PriceList',
          entityId: list.id,
          action: 'UPDATE',
        },
        orderBy: { occurredAt: 'desc' },
      });
      expect(
        (
          bulkAudit?.metadata as {
            change?: string;
            affectedCount?: number;
          } | null
        )?.change,
      ).toBe('bulk_adjustment');
      expect(
        (bulkAudit?.metadata as { affectedCount?: number } | null)
          ?.affectedCount,
      ).toBe(3);

      // One PriceHistory row per affected variant, changeType BULK_ADJUSTMENT — the
      // commercial record stays separate from the single administrative audit event above.
      const bulkHistoryCount = await prisma.priceHistory.count({
        where: {
          companyId: companyAId,
          priceListId: list.id,
          productVariantId: { in: [v1, v2, v3] },
          changeType: 'BULK_ADJUSTMENT',
        },
      });
      expect(bulkHistoryCount).toBe(3);
    });

    it('rejects bulk-adjust on a DERIVED list', async () => {
      const agent = await loginAs(userAdminId);
      const base = await createFixedList(agent);
      const derived = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `BULK-DERIVED-${suffix}`,
          name: `Bulk Derived ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: base.id,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '10',
        });
      const derivedId = (derived.body as { priceList: PriceListBody }).priceList
        .id;

      const res = await agent
        .post(`/api/v1/pricing/lists/${derivedId}/bulk-adjust`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          adjustmentType: 'PERCENTAGE_INCREASE',
          value: '10',
          effectiveFrom: '2026-09-01',
          scope: 'ALL',
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_NOT_FIXED',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Company isolation
  // ---------------------------------------------------------------------
  describe('company isolation', () => {
    it('a PriceList from company B is not visible/reachable from company A', async () => {
      const agent = await loginAs(userAdminId);
      const listB = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyBId)
        .send({
          code: `ISO-B-${suffix}`,
          name: `Isolation B ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'FIXED',
        });
      expect(listB.status).toBe(201);
      const listBId = (listB.body as { priceList: PriceListBody }).priceList.id;

      const crossCompany = await agent
        .get(`/api/v1/pricing/lists/${listBId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(crossCompany.status).toBe(404);

      const sameCompany = await agent
        .get(`/api/v1/pricing/lists/${listBId}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(sameCompany.status).toBe(200); // proves the 404 above was isolation, not a broken route
    });

    it("company B's list can never be used as a derivation base from company A", async () => {
      const agent = await loginAs(userAdminId);
      const listB = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyBId)
        .send({
          code: `ISO-BASE-B-${suffix}`,
          name: `Isolation Base B ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'FIXED',
        });
      const listBId = (listB.body as { priceList: PriceListBody }).priceList.id;

      const res = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `ISO-DERIVED-A-${suffix}`,
          name: `Isolation Derived A ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'DERIVED',
          basePriceListId: listBId,
          adjustmentType: 'PERCENTAGE_INCREASE',
          adjustmentValue: '10',
        });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_NOT_FOUND',
      );
    });

    it('a company-A price is never resolvable through a company-B context at the service layer', async () => {
      const agent = await loginAs(userAdminId);
      const list = await createFixedList(agent);
      const variantId = await freshVariant(productMainId, 'isolation-service');
      await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '77' });

      await expect(
        pricingService.getPrice(companyBId, list.id, variantId),
      ).rejects.toBeInstanceOf(PriceListNotFoundException);
    });
  });

  // ---------------------------------------------------------------------
  // Permission enforcement — one dedicated case per pricing.* permission
  // ---------------------------------------------------------------------
  describe('permission enforcement', () => {
    it('403s a user with no pricing permissions at all', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('a lists.read-only user can read lists but not create/update/deactivate or read/update prices', async () => {
      const agent = await loginAs(userListsReadOnlyId);
      const read = await agent
        .get('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(read.status).toBe(200);

      const create = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `PERM-${suffix}`,
          name: `Perm ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'FIXED',
        });
      expect(create.status).toBe(403);

      const lookup = await agent
        .get('/api/v1/pricing/lookup')
        .query({
          priceListId: '00000000-0000-0000-0000-000000000000',
          productVariantId: '00000000-0000-0000-0000-000000000000',
        })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(lookup.status).toBe(403);
    });

    it('403s pricing.lists.create specifically when missing', async () => {
      const agent = await loginAs(userNoListsCreateId);
      const res = await agent
        .post('/api/v1/pricing/lists')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `PERM-CREATE-${suffix}`,
          name: `Perm Create ${suffix}`,
          currencyId: currencyArsId,
          pricingMode: 'FIXED',
        });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s pricing.lists.update specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const list = await createFixedList(adminAgent);
      const agent = await loginAs(userNoListsUpdateId);
      const res = await agent
        .patch(`/api/v1/pricing/lists/${list.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Should not update' });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s pricing.lists.deactivate specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const list = await createFixedList(adminAgent);
      const agent = await loginAs(userNoListsDeactivateId);
      const res = await agent
        .post(`/api/v1/pricing/lists/${list.id}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s pricing.prices.read specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const list = await createFixedList(adminAgent);
      const agent = await loginAs(userNoPricesReadId);
      const res = await agent
        .get('/api/v1/pricing/lookup')
        .query({
          priceListId: list.id,
          productVariantId: '00000000-0000-0000-0000-000000000000',
        })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s pricing.prices.update specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const list = await createFixedList(adminAgent);
      const variantId = await freshVariant(productMainId, 'perm-prices-update');
      const agent = await loginAs(userNoPricesUpdateId);
      const res = await agent
        .put(`/api/v1/pricing/lists/${list.id}/products/${variantId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ price: '10' });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s pricing.prices.bulk_update specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const list = await createFixedList(adminAgent);
      const agent = await loginAs(userNoBulkUpdateId);
      const res = await agent
        .post(`/api/v1/pricing/lists/${list.id}/bulk-adjust`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          adjustmentType: 'PERCENTAGE_INCREASE',
          value: '10',
          effectiveFrom: '2026-09-01',
          scope: 'ALL',
        });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });
  });
});
