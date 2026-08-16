import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { InventoryService } from '../src/inventory/inventory.service';

interface DashboardSummaryBody {
  salesToday: {
    count: number;
    totalsByCurrency: { currencyCode: string; total: string }[];
  } | null;
  openDraftSales: number | null;
  recentSales: { id: string; number: string; total: string }[] | null;
  activeCustomers: number | null;
  activeProducts: number | null;
  belowMinimumStockCount: number | null;
}

/**
 * Prompt #14 — GET /dashboard/summary. Self-contained fixtures, same
 * pattern as every other e2e spec. This endpoint has no single
 * `@RequirePermissions` gate (see dashboard.controller.ts) — any company
 * member can call it, but each block is independently omitted (`null`)
 * per the caller's own effective permissions, verified below.
 */
describe('Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let unitId: string;
  let productId: string;
  let variantId: string;
  let warehouseId: string;
  let customerId: string;
  let priceListId: string;
  let currencyId: string;

  let userFullId: string; // all relevant read permissions
  let userNoneId: string; // company member, zero business-read permissions
  let userSalesOnlyId: string; // sales.documents.read only
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
    inventoryService = app.get(InventoryService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Dashboard Tenant ${suffix}`,
        slug: `e2e-dashboard-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Dashboard Company A',
        taxId: `e2e-dash-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Dashboard Company B',
        taxId: `e2e-dash-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const currency = await prisma.currency.upsert({
      where: { code: `E2EDASH${suffix}` },
      update: {},
      create: {
        code: `E2EDASH${suffix}`,
        name: 'E2E Dashboard Peso',
        symbol: '$',
        decimalPlaces: 2,
      },
    });
    currencyId = currency.id;

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
    unitId = unit.id;

    const product = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `DASHPROD-${suffix}`,
        name: 'Dashboard Product',
        baseUnitId: unitId,
        trackInventory: true,
        minimumStock: '5',
      },
    });
    productId = product.id;
    const variant = await prisma.productVariant.create({
      data: { productId, name: null },
    });
    variantId = variant.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `DASHWH-${suffix}`,
        name: 'Dashboard Warehouse',
      },
    });
    warehouseId = warehouse.id;

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `DASHCUST-${suffix}`,
        legalName: 'Dashboard Customer',
      },
    });
    customerId = customer.id;

    const priceList = await prisma.priceList.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `DASHPL-${suffix}`,
        name: 'Dashboard Price List',
        currencyId,
        pricingMode: 'FIXED',
        active: true,
      },
    });
    priceListId = priceList.id;
    await prisma.priceListItem.create({
      data: {
        tenantId,
        companyId: companyAId,
        priceListId,
        productVariantId: variantId,
        price: '100',
        effectiveFrom: new Date('2020-01-01'),
      },
    });

    async function makePermission(module: string, code: string) {
      const parts = code.split('.');
      const action = parts[parts.length - 1];
      const resource = parts.length > 2 ? parts[1] : parts[0];
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module, resource, action },
      });
    }
    const permSalesRead = await makePermission('sales', 'sales.documents.read');
    const permSalesCreate = await makePermission(
      'sales',
      'sales.documents.create',
    );
    const permSalesConfirm = await makePermission(
      'sales',
      'sales.documents.confirm',
    );
    const permCustomersRead = await makePermission(
      'customers',
      'customers.read',
    );
    const permProductsRead = await makePermission('products', 'products.read');
    const permStockRead = await makePermission(
      'inventory',
      'inventory.stock.read',
    );

    const roleFull = await prisma.role.create({
      data: { tenantId, companyId: companyAId, name: 'Dashboard E2E Full' },
    });
    await prisma.rolePermission.createMany({
      data: [
        permSalesRead,
        permSalesCreate,
        permSalesConfirm,
        permCustomersRead,
        permProductsRead,
        permStockRead,
      ].map((p) => ({ roleId: roleFull.id, permissionId: p.id })),
    });
    const roleNone = await prisma.role.create({
      data: { tenantId, companyId: companyAId, name: 'Dashboard E2E None' },
    });
    const roleSalesOnly = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: 'Dashboard E2E Sales Only',
      },
    });
    await prisma.rolePermission.create({
      data: { roleId: roleSalesOnly.id, permissionId: permSalesRead.id },
    });

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-dashboard-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const userFull = await makeUser('Full');
    const userNone = await makeUser('None');
    const userSalesOnly = await makeUser('SalesOnly');
    userFullId = userFull.id;
    userNoneId = userNone.id;
    userSalesOnlyId = userSalesOnly.id;

    for (const uid of [userFullId, userNoneId, userSalesOnlyId]) {
      await prisma.userCompany.create({
        data: { userId: uid, tenantId, companyId: companyAId, active: true },
      });
    }
    await prisma.userRole.create({
      data: { userId: userFullId, roleId: roleFull.id, companyId: companyAId },
    });
    await prisma.userRole.create({
      data: { userId: userNoneId, roleId: roleNone.id, companyId: companyAId },
    });
    await prisma.userRole.create({
      data: {
        userId: userSalesOnlyId,
        roleId: roleSalesOnly.id,
        companyId: companyAId,
      },
    });
  });

  afterAll(async () => {
    await prisma.salesTender.deleteMany({
      where: { salesDocument: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.salesDocumentLine.deleteMany({
      where: { salesDocument: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.salesDocument.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.salesDocumentSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockMovement.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceListItem.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceList.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.customer.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.warehouse.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
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
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.role.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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

  describe('empty company', () => {
    it('a brand-new company with no data returns zero/empty values, never an error', async () => {
      const emptyCompany = await prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E Dashboard Empty Company',
          taxId: `e2e-dash-empty-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      });
      await prisma.userCompany.create({
        data: {
          userId: userFullId,
          tenantId,
          companyId: emptyCompany.id,
          active: true,
        },
      });
      const roleFullEmpty = await prisma.role.create({
        data: {
          tenantId,
          companyId: emptyCompany.id,
          name: 'Dashboard E2E Full Empty',
        },
      });
      const perms = await prisma.permission.findMany({
        where: {
          code: {
            in: [
              'sales.documents.read',
              'customers.read',
              'products.read',
              'inventory.stock.read',
            ],
          },
        },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({
          roleId: roleFullEmpty.id,
          permissionId: p.id,
        })),
      });
      await prisma.userRole.create({
        data: {
          userId: userFullId,
          roleId: roleFullEmpty.id,
          companyId: emptyCompany.id,
        },
      });

      const agent = await loginAs(userFullId);
      const res = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, emptyCompany.id);
      expect(res.status).toBe(200);
      const body = res.body as DashboardSummaryBody;
      expect(body.salesToday).toEqual({ count: 0, totalsByCurrency: [] });
      expect(body.openDraftSales).toBe(0);
      expect(body.recentSales).toEqual([]);
      expect(body.activeCustomers).toBe(0);
      expect(body.activeProducts).toBe(0);
      expect(body.belowMinimumStockCount).toBe(0);

      // cleanup this one-off company
      await prisma.userRole.deleteMany({
        where: { companyId: emptyCompany.id },
      });
      await prisma.rolePermission.deleteMany({
        where: { roleId: roleFullEmpty.id },
      });
      await prisma.role.delete({ where: { id: roleFullEmpty.id } });
      await prisma.userCompany.deleteMany({
        where: { companyId: emptyCompany.id },
      });
      await prisma.company.delete({ where: { id: emptyCompany.id } });
    });
  });

  describe('permission-based field omission', () => {
    it('a user with zero relevant permissions gets every block as null, never a raw error or fabricated zero', async () => {
      const agent = await loginAs(userNoneId);
      const res = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const body = res.body as DashboardSummaryBody;
      expect(body.salesToday).toBeNull();
      expect(body.openDraftSales).toBeNull();
      expect(body.recentSales).toBeNull();
      expect(body.activeCustomers).toBeNull();
      expect(body.activeProducts).toBeNull();
      expect(body.belowMinimumStockCount).toBeNull();
    });

    it('a user with only sales.documents.read sees sales blocks populated and every other block null', async () => {
      const agent = await loginAs(userSalesOnlyId);
      const res = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const body = res.body as DashboardSummaryBody;
      expect(body.salesToday).not.toBeNull();
      expect(body.openDraftSales).not.toBeNull();
      expect(body.recentSales).not.toBeNull();
      expect(body.activeCustomers).toBeNull();
      expect(body.activeProducts).toBeNull();
      expect(body.belowMinimumStockCount).toBeNull();
    });
  });

  describe('correct aggregate semantics', () => {
    it('confirmed-today count/total, open drafts, active customer/product counts, and recent sales all reflect real data', async () => {
      const agent = await loginAs(userFullId);

      await inventoryService.createInitialBalance(
        { userId: userFullId, companyId: companyAId, tenantId },
        {
          warehouseId,
          lines: [{ productVariantId: variantId, quantity: '10' }],
        },
      );

      // A confirmed sale today.
      const draft = await agent
        .post('/api/v1/sales')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          warehouseId,
          priceListId,
          lines: [
            {
              productVariantId: variantId,
              quantity: '2',
              discountPercentage: '0',
            },
          ],
        });
      expect(draft.status).toBe(201);
      const saleId = (
        draft.body as { salesDocument: { id: string; total: string } }
      ).salesDocument.id;
      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      // An open draft (never confirmed).
      const openDraft = await agent
        .post('/api/v1/sales')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          warehouseId,
          priceListId,
          lines: [
            {
              productVariantId: variantId,
              quantity: '1',
              discountPercentage: '0',
            },
          ],
        });
      expect(openDraft.status).toBe(201);

      const res = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const body = res.body as DashboardSummaryBody;

      expect(body.salesToday!.count).toBe(1); // exactly the one sale confirmed above
      const currencyRow = body.salesToday!.totalsByCurrency.find(
        (t) => t.currencyCode === `E2EDASH${suffix}`,
      );
      expect(currencyRow).toBeDefined();
      expect(currencyRow!.total).toBe('200'); // 2 x 100, exact decimal string

      expect(body.openDraftSales).toBe(1); // exactly the one open draft created above
      expect(body.recentSales!.some((s) => s.id === saleId)).toBe(true);

      expect(body.activeCustomers).toBe(1); // exactly the one ACTIVE customer created in this company
      expect(body.activeProducts).toBe(1); // exactly the one ACTIVE product created in this company
    });

    it('belowMinimumStockCount reflects InventoryService.listStock(belowMinimum) exactly — the existing rule, never an invented threshold', async () => {
      const agent = await loginAs(userFullId);
      // minimumStock = 5 (set at product creation) — an initial balance of 2 is below it.
      const freshVariant = await prisma.productVariant.create({
        data: { productId, name: `below-min-${suffix}` },
      });
      await inventoryService.createInitialBalance(
        { userId: userFullId, companyId: companyAId, tenantId },
        {
          warehouseId,
          lines: [{ productVariantId: freshVariant.id, quantity: '2' }],
        },
      );

      const dashboardRes = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyAId);
      const directRes = await agent
        .get('/api/v1/inventory/stock')
        .query({ belowMinimum: 'true', page: 1, pageSize: 1 })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(dashboardRes.status).toBe(200);
      expect(directRes.status).toBe(200);
      const dashboardBody = dashboardRes.body as DashboardSummaryBody;
      const directBody = directRes.body as { pagination: { total: number } };
      expect(dashboardBody.belowMinimumStockCount).toBe(
        directBody.pagination.total,
      );
      expect(dashboardBody.belowMinimumStockCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('company isolation', () => {
    it('company B data never leaks into company A counts, and vice versa', async () => {
      const currencyB = await prisma.currency.upsert({
        where: { code: `E2EDASHB${suffix}` },
        update: {},
        create: {
          code: `E2EDASHB${suffix}`,
          name: 'E2E Dashboard Peso B',
          symbol: '$',
          decimalPlaces: 2,
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
      const productB = await prisma.product.create({
        data: {
          tenantId,
          companyId: companyBId,
          code: `DASHPROD-B-${suffix}`,
          name: 'Dashboard Product B',
          baseUnitId: unitB.id,
          trackInventory: true,
        },
      });
      await prisma.customer.create({
        data: {
          tenantId,
          companyId: companyBId,
          code: `DASHCUST-B-${suffix}`,
          legalName: 'Dashboard Customer B',
        },
      });

      await prisma.userCompany.create({
        data: {
          userId: userFullId,
          tenantId,
          companyId: companyBId,
          active: true,
        },
      });
      const roleFullB = await prisma.role.create({
        data: { tenantId, companyId: companyBId, name: 'Dashboard E2E Full B' },
      });
      const perms = await prisma.permission.findMany({
        where: { code: { in: ['customers.read', 'products.read'] } },
      });
      await prisma.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: roleFullB.id, permissionId: p.id })),
      });
      await prisma.userRole.create({
        data: {
          userId: userFullId,
          roleId: roleFullB.id,
          companyId: companyBId,
        },
      });

      const agent = await loginAs(userFullId);
      const resA = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyAId);
      const resB = await agent
        .get('/api/v1/dashboard/summary')
        .set(COMPANY_ID_HEADER, companyBId);
      const bodyA = resA.body as DashboardSummaryBody;
      const bodyB = resB.body as DashboardSummaryBody;

      // Company A's own counts (1 customer, 1 product) must not include company B's rows.
      expect(bodyA.activeCustomers).toBe(1);
      expect(bodyA.activeProducts).toBe(1);
      // Company B has its own 1 customer, 1 product — never company A's.
      expect(bodyB.activeCustomers).toBe(1);
      expect(bodyB.activeProducts).toBe(1);

      await prisma.userRole.deleteMany({ where: { companyId: companyBId } });
      await prisma.rolePermission.deleteMany({
        where: { roleId: roleFullB.id },
      });
      await prisma.role.delete({ where: { id: roleFullB.id } });
      await prisma.userCompany.deleteMany({
        where: { userId: userFullId, companyId: companyBId },
      });
      await prisma.customer.deleteMany({ where: { companyId: companyBId } });
      await prisma.productVariant.deleteMany({
        where: { product: { companyId: companyBId } },
      });
      await prisma.product.delete({ where: { id: productB.id } });
      await prisma.unitOfMeasure.delete({ where: { id: unitB.id } });
      await prisma.currency.delete({ where: { id: currencyB.id } });
    });
  });
});
