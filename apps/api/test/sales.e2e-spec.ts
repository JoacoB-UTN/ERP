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

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface SaleLineBody {
  id: string;
  productVariantId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercentage: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
}
interface SaleTenderBody {
  method: string;
  amountApplied: string;
  amountReceived: string | null;
  change: string | null;
  reference: string | null;
}
interface SaleBody {
  id: string;
  number: string;
  status: string;
  total: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  lines: SaleLineBody[];
  tender: SaleTenderBody | null;
}
interface PriceListBody {
  id: string;
  code: string;
}

/**
 * Mandatory Sales coverage per the Prompt #10 task spec — see
 * docs/sales.md. Self-contained fixtures, not the dev seed. Mixes
 * supertest (HTTP contract, permissions, company isolation) with direct
 * `app.get(InventoryService)` calls to inspect the resulting ledger —
 * same pattern as inventory.e2e-spec.ts.
 */
describe('Sales (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let currencyId: string;
  let unitUnId: string;
  let unitKgId: string;

  let productId: string;
  let variantId: string;
  let variantKgId: string; // baseUnit KG, decimalPlaces=3
  let variantServiceId: string; // SERVICE, trackInventory=false

  let warehouseId: string; // ACTIVE, allowsSales=true, allowNegativeStock=false
  let warehouseInactiveId: string;
  let warehouseNoSalesId: string;

  let customerId: string; // ACTIVE
  let customerInactiveId: string;

  let priceListId: string; // FIXED, active
  let priceListInactiveId: string;

  let userAdminId: string; // full sales perms, member of A AND B
  let userNoReadId: string;
  let userNoCreateId: string;
  let userNoUpdateId: string;
  let userNoConfirmId: string;
  let userNoCancelId: string;
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
        name: `E2E Sales Tenant ${suffix}`,
        slug: `e2e-sales-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Sales Company A',
        taxId: `e2e-sales-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Sales Company B',
        taxId: `e2e-sales-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const currency = await prisma.currency.upsert({
      where: { code: `E2ESALES${suffix}` },
      update: {},
      create: {
        code: `E2ESALES${suffix}`,
        name: 'E2E Sales Peso',
        symbol: '$',
        decimalPlaces: 2,
      },
    });
    currencyId = currency.id;

    const unitUn = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });
    const unitKg = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: 'KG',
        name: 'Kilogramo',
        symbol: 'kg',
        decimalPlaces: 3,
      },
    });
    unitUnId = unitUn.id;
    unitKgId = unitKg.id;

    const product = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALEPROD-${suffix}`,
        name: 'Sale Product',
        baseUnitId: unitUnId,
        trackInventory: true,
      },
    });
    productId = product.id;
    const variant = await prisma.productVariant.create({
      data: { productId, name: null },
    });
    variantId = variant.id;

    const productKg = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALEKG-${suffix}`,
        name: 'Sale Kg Product',
        baseUnitId: unitKgId,
        trackInventory: true,
      },
    });
    const variantKg = await prisma.productVariant.create({
      data: { productId: productKg.id, name: null },
    });
    variantKgId = variantKg.id;

    const productService = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALESVC-${suffix}`,
        name: 'Sale Service',
        baseUnitId: unitUnId,
        trackInventory: false,
        productType: 'SERVICE',
      },
    });
    const variantService = await prisma.productVariant.create({
      data: { productId: productService.id, name: null },
    });
    variantServiceId = variantService.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALEWH-${suffix}`,
        name: 'Sale Warehouse',
      },
    });
    warehouseId = warehouse.id;
    const warehouseInactive = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALEWH-INACTIVE-${suffix}`,
        name: 'Inactive Warehouse',
        status: 'INACTIVE',
      },
    });
    warehouseInactiveId = warehouseInactive.id;
    const warehouseNoSales = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALEWH-NOSALES-${suffix}`,
        name: 'No-Sales Warehouse',
        allowsSales: false,
      },
    });
    warehouseNoSalesId = warehouseNoSales.id;

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALECUST-${suffix}`,
        legalName: 'Sale Customer',
      },
    });
    customerId = customer.id;
    const customerInactive = await prisma.customer.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SALECUST-INACTIVE-${suffix}`,
        legalName: 'Inactive Customer',
        status: 'INACTIVE',
      },
    });
    customerInactiveId = customerInactive.id;

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'sales', resource, action },
      });
    }
    const permRead = await makePermission('sales.documents.read');
    const permCreate = await makePermission('sales.documents.create');
    const permUpdate = await makePermission('sales.documents.update');
    const permConfirm = await makePermission('sales.documents.confirm');
    const permCancel = await makePermission('sales.documents.cancel');
    const ALL_PERM_IDS = [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permConfirm.id,
      permCancel.id,
    ];

    // Pricing permissions — only the fixture setup (creating/pricing/deactivating
    // PriceLists via the real API, in the top-level beforeAll below) needs these;
    // they're granted only to the full-access role, not the "missing X" roles.
    async function makePricingPermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'pricing', resource, action },
      });
    }
    const permPricingListsCreate = await makePricingPermission(
      'pricing.lists.create',
    );
    const permPricingListsDeactivate = await makePricingPermission(
      'pricing.lists.deactivate',
    );
    const permPricingPricesUpdate = await makePricingPermission(
      'pricing.prices.update',
    );
    const FULL_PERM_IDS = [
      ...ALL_PERM_IDS,
      permPricingListsCreate.id,
      permPricingListsDeactivate.id,
      permPricingPricesUpdate.id,
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
      'Sales E2E Full A',
      FULL_PERM_IDS,
    );
    const roleFullB = await makeRole(
      companyBId,
      'Sales E2E Full B',
      ALL_PERM_IDS,
    );
    const roleNoRead = await makeRole(
      companyAId,
      'Sales E2E No Read',
      ALL_PERM_IDS.filter((id) => id !== permRead.id),
    );
    const roleNoCreate = await makeRole(
      companyAId,
      'Sales E2E No Create',
      ALL_PERM_IDS.filter((id) => id !== permCreate.id),
    );
    const roleNoUpdate = await makeRole(
      companyAId,
      'Sales E2E No Update',
      ALL_PERM_IDS.filter((id) => id !== permUpdate.id),
    );
    const roleNoConfirm = await makeRole(
      companyAId,
      'Sales E2E No Confirm',
      ALL_PERM_IDS.filter((id) => id !== permConfirm.id),
    );
    const roleNoCancel = await makeRole(
      companyAId,
      'Sales E2E No Cancel',
      ALL_PERM_IDS.filter((id) => id !== permCancel.id),
    );

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-sales-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const userAdmin = await makeUser('Admin');
    const userNoRead = await makeUser('NoRead');
    const userNoCreate = await makeUser('NoCreate');
    const userNoUpdate = await makeUser('NoUpdate');
    const userNoConfirm = await makeUser('NoConfirm');
    const userNoCancel = await makeUser('NoCancel');
    userAdminId = userAdmin.id;
    userNoReadId = userNoRead.id;
    userNoCreateId = userNoCreate.id;
    userNoUpdateId = userNoUpdate.id;
    userNoConfirmId = userNoConfirm.id;
    userNoCancelId = userNoCancel.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userAdminId, companyBId);
    await membership(userNoReadId, companyAId);
    await membership(userNoCreateId, companyAId);
    await membership(userNoUpdateId, companyAId);
    await membership(userNoConfirmId, companyAId);
    await membership(userNoCancelId, companyAId);

    async function assignRole(
      userId: string,
      roleId: string,
      companyId: string,
    ) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userAdminId, roleFullA.id, companyAId);
    await assignRole(userAdminId, roleFullB.id, companyBId);
    await assignRole(userNoReadId, roleNoRead.id, companyAId);
    await assignRole(userNoCreateId, roleNoCreate.id, companyAId);
    await assignRole(userNoUpdateId, roleNoUpdate.id, companyAId);
    await assignRole(userNoConfirmId, roleNoConfirm.id, companyAId);
    await assignRole(userNoCancelId, roleNoCancel.id, companyAId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
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
    await prisma.priceHistory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceListItem.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.priceList.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.currency.deleteMany({ where: { id: currencyId } });
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

  async function createPriceList(
    agent: request.Agent,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await agent
      .post('/api/v1/pricing/lists')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        code: `SPL-${Math.random().toString(36).slice(2, 10)}`,
        name: `Sale Price List ${Math.random()}`,
        currencyId,
        includesTax: false,
        pricingMode: 'FIXED',
        isDefault: false,
        ...overrides,
      });
    expect(res.status).toBe(201);
    return (res.body as { priceList: PriceListBody }).priceList;
  }

  async function setPrice(
    agent: request.Agent,
    listId: string,
    variant: string,
    price: string,
  ) {
    const res = await agent
      .put(`/api/v1/pricing/lists/${listId}/products/${variant}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ price });
    expect(res.status).toBe(200);
  }

  async function freshVariant(baseProductId: string = productId, label = 'v') {
    const v = await prisma.productVariant.create({
      data: {
        productId: baseProductId,
        name: `${label}-${suffix}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return v.id;
  }

  beforeAll(async () => {
    const agent = await loginAs(userAdminId);
    const list = await createPriceList(agent);
    priceListId = list.id;
    await setPrice(agent, priceListId, variantId, '100');
    await setPrice(agent, priceListId, variantKgId, '50');
    await setPrice(agent, priceListId, variantServiceId, '30');

    const inactiveList = await createPriceList(agent);
    priceListInactiveId = inactiveList.id;
    await setPrice(agent, priceListInactiveId, variantId, '100');
    // Deactivate it via the API (no create-time `active:false` field on the create schema).
    await agent
      .post(`/api/v1/pricing/lists/${priceListInactiveId}/deactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
  });

  async function draftSale(
    agent: request.Agent,
    overrides: Record<string, unknown> = {},
  ): Promise<{
    status: number;
    body: { salesDocument: SaleBody } | ErrorEnvelope;
  }> {
    const res = await agent
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
            discountPercentage: '10',
          },
        ],
        ...overrides,
      });
    return {
      status: res.status,
      body: res.body as { salesDocument: SaleBody } | ErrorEnvelope,
    };
  }

  // ---------------------------------------------------------------------
  // Pricing: snapshot + arithmetic
  // ---------------------------------------------------------------------
  describe('pricing', () => {
    it('resolves price from PricingService and computes gross/discount/net correctly (100 x2, 10% -> net 180)', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent);
      expect(status).toBe(201);
      const sale = (body as { salesDocument: SaleBody }).salesDocument;
      const line = sale.lines[0];
      expect(line.unitPrice).toBe('100');
      expect(line.discountAmount).toBe('20');
      expect(line.netAmount).toBe('180');
      expect(line.taxAmount).toBe('0');
      expect(line.totalAmount).toBe('180');
      expect(sale.subtotal).toBe('180');
      expect(sale.discountTotal).toBe('20');
      expect(sale.taxTotal).toBe('0');
      expect(sale.total).toBe('180');
    });

    it('snapshots the price at confirm time — a later price change never affects an already-confirmed sale', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'snapshot');
      await setPrice(agent, priceListId, variant, '18500');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '10' }] },
      );

      const { status, body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '1', discountPercentage: '0' },
        ],
      });
      expect(status).toBe(201);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);
      expect(
        (confirm.body as { salesDocument: SaleBody }).salesDocument.lines[0]
          .unitPrice,
      ).toBe('18500');

      await setPrice(agent, priceListId, variant, '20000');

      const reloaded = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.lines[0]
          .unitPrice,
      ).toBe('18500');
    });

    it('rejects a line with no price on the selected price list (never fabricates 0)', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'nopricing');
      const { status, body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '1', discountPercentage: '0' },
        ],
      });
      expect(status).toBe(404);
      expect((body as ErrorEnvelope).error.code).toBe('PRICE_NOT_FOUND');
    });

    it('rejects an inactive price list', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent, {
        priceListId: priceListInactiveId,
      });
      expect(status).toBe(409);
      expect((body as ErrorEnvelope).error.code).toBe(
        'SALE_PRICE_LIST_INVALID',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Inventory integration
  // ---------------------------------------------------------------------
  describe('inventory integration', () => {
    it('DRAFT has no inventory effect; CONFIRM decreases stock by the line quantity', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'stockflow');
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '40' }] },
      );

      const { status, body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '3', discountPercentage: '0' },
        ],
      });
      expect(status).toBe(201);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      let balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balance.onHand).toBe('40'); // DRAFT — unchanged

      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balance.onHand).toBe('37');

      const movement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          productVariantId: variant,
          referenceType: 'SalesDocument',
        },
      });
      expect(movement?.referenceId).toBe(saleId);
      expect(movement?.movementType).toBe('SALE');
      expect(movement?.quantity.toString()).toBe('-3');
    });

    it('a SERVICE line never generates a StockMovement, even alongside a tracked line', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'mixed');
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '20' }] },
      );

      const { status, body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '2', discountPercentage: '0' },
          {
            productVariantId: variantServiceId,
            quantity: '1',
            discountPercentage: '0',
          },
        ],
      });
      expect(status).toBe(201);
      const sale = (body as { salesDocument: SaleBody }).salesDocument;
      expect(sale.lines).toHaveLength(2);

      const confirm = await agent
        .post(`/api/v1/sales/${sale.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      const serviceMovement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          productVariantId: variantServiceId,
          referenceId: sale.id,
        },
      });
      expect(serviceMovement).toBeNull();

      const trackedMovement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          productVariantId: variant,
          referenceId: sale.id,
        },
      });
      expect(trackedMovement?.quantity.toString()).toBe('-2');
    });

    it('rejects confirmation when stock is insufficient (negative disallowed) and leaves the balance untouched', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'insufficient');
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '2' }] },
      );

      const { body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '5', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(409);
      expect((confirm.body as ErrorEnvelope).error.code).toBe(
        'INSUFFICIENT_STOCK',
      );

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balance.onHand).toBe('2');

      const reloaded = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
    });
  });

  // ---------------------------------------------------------------------
  // Confirmation atomicity
  // ---------------------------------------------------------------------
  describe('confirmation atomicity', () => {
    it('one insufficient-stock line rolls back the WHOLE confirmation — no partial movements, no audit, sale stays DRAFT', async () => {
      const agent = await loginAs(userAdminId);
      const okVariant = await freshVariant(productId, 'atomic-ok');
      const badVariant = await freshVariant(productId, 'atomic-bad');
      await setPrice(agent, priceListId, okVariant, '10');
      await setPrice(agent, priceListId, badVariant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        {
          warehouseId,
          lines: [
            { productVariantId: okVariant, quantity: '100' },
            { productVariantId: badVariant, quantity: '1' },
          ],
        },
      );

      const { body } = await draftSale(agent, {
        lines: [
          {
            productVariantId: okVariant,
            quantity: '5',
            discountPercentage: '0',
          },
          {
            productVariantId: badVariant,
            quantity: '999',
            discountPercentage: '0',
          },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const auditCountBefore = await prisma.auditLog.count({
        where: {
          entityType: 'SalesDocument',
          entityId: saleId,
          action: 'CONFIRM',
        },
      });

      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(409);

      const okBalance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        okVariant,
      );
      expect(okBalance.onHand).toBe('100'); // untouched — no partial movement for the OK line either

      const badBalance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        badVariant,
      );
      expect(badBalance.onHand).toBe('1');

      const auditCountAfter = await prisma.auditLog.count({
        where: {
          entityType: 'SalesDocument',
          entityId: saleId,
          action: 'CONFIRM',
        },
      });
      expect(auditCountAfter).toBe(auditCountBefore);

      const reloaded = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
    });
  });

  // ---------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------
  describe('idempotent confirmation', () => {
    it('confirming an already-CONFIRMED sale never double-deducts stock', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'idempotent');
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '50' }] },
      );

      const { body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '4', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const first = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(first.status).toBe(200);

      const second = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(second.status).toBe(409);
      expect((second.body as ErrorEnvelope).error.code).toBe(
        'SALE_ALREADY_CONFIRMED',
      );

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balance.onHand).toBe('46'); // deducted exactly once

      const movementCount = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          productVariantId: variant,
          referenceId: saleId,
        },
      });
      expect(movementCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // Payment / tender — see docs/pos.md. Purely operational metadata, never
  // a Treasury/CashMovement/BankMovement/AccountingEntry.
  // ---------------------------------------------------------------------
  describe('payment / tender', () => {
    /** A confirmable draft: fresh variant, price 100, plenty of stock, qty 2 / 10% discount -> total 180. */
    async function confirmableDraft(agent: request.Agent) {
      const variant = await freshVariant(productId, 'tender');
      await setPrice(agent, priceListId, variant, '100');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '50' }] },
      );
      return draftSale(agent, {
        lines: [
          {
            productVariantId: variant,
            quantity: '2',
            discountPercentage: '10',
          },
        ],
      });
    }

    it('confirming without a tender leaves tender null (plain Facturación/Gestión confirm)', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await confirmableDraft(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      expect(
        (res.body as { salesDocument: SaleBody }).salesDocument.tender,
      ).toBeNull();
    });

    it('CASH with amountReceived > total persists amountApplied=total and a computed change', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await confirmableDraft(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '200' } });
      expect(res.status).toBe(200);
      const tender = (res.body as { salesDocument: SaleBody }).salesDocument
        .tender;
      expect(tender).not.toBeNull();
      expect(tender!.method).toBe('CASH');
      expect(tender!.amountApplied).toBe('180');
      expect(tender!.amountReceived).toBe('200');
      expect(tender!.change).toBe('20');
    });

    it('CASH with no amountReceived defaults received=total and change=0 (exact payment)', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await confirmableDraft(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH' } });
      expect(res.status).toBe(200);
      const tender = (res.body as { salesDocument: SaleBody }).salesDocument
        .tender;
      expect(tender!.amountReceived).toBe('180');
      expect(tender!.change).toBe('0');
    });

    it('rejects CASH with amountReceived below the total (Importe insuficiente) and leaves the sale DRAFT with no tender', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await draftSale(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '100' } });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'SALE_TENDER_CASH_INSUFFICIENT',
      );

      const reloaded = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.tender,
      ).toBeNull();

      const tenderRow = await prisma.salesTender.findUnique({
        where: { salesDocumentId: saleId },
      });
      expect(tenderRow).toBeNull();
    });

    it('CARD/TRANSFER/OTHER never carry amountReceived — amountApplied always equals the total', async () => {
      const agent = await loginAs(userAdminId);
      for (const method of ['CARD', 'TRANSFER', 'OTHER']) {
        const { body } = await confirmableDraft(agent);
        const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
        const res = await agent
          .post(`/api/v1/sales/${saleId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ tender: { method } });
        expect(res.status).toBe(200);
        const tender = (res.body as { salesDocument: SaleBody }).salesDocument
          .tender;
        expect(tender!.method).toBe(method);
        expect(tender!.amountApplied).toBe('180');
        expect(tender!.amountReceived).toBeNull();
        expect(tender!.change).toBeNull();
      }
    });

    it('rejects amountReceived supplied for a non-CASH method (400, validation)', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await draftSale(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CARD', amountReceived: '180' } });
      expect(res.status).toBe(400);
    });

    it('exactly one tender per sale — the DB unique constraint backs the one-tender-per-MVP-sale rule', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await confirmableDraft(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '200' } });

      const count = await prisma.salesTender.count({
        where: { salesDocumentId: saleId },
      });
      expect(count).toBe(1);

      // A retried confirm on the now-CONFIRMED sale is rejected before ever
      // reaching tender creation — never a second tender row.
      const retry = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '200' } });
      expect(retry.status).toBe(409);
      const countAfterRetry = await prisma.salesTender.count({
        where: { salesDocumentId: saleId },
      });
      expect(countAfterRetry).toBe(1);
    });

    it('a tender is never orphaned: insufficient stock aborts the whole confirmation, including the tender', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(productId, 'tender-rollback');
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '1' }] },
      );
      const { body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '5', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '100' } });
      expect(res.status).toBe(409); // INSUFFICIENT_STOCK

      const reloaded = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
      const tenderRow = await prisma.salesTender.findUnique({
        where: { salesDocumentId: saleId },
      });
      expect(tenderRow).toBeNull();
    });

    it('company isolation: a tender created in company A is not reachable scoped to company B', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await confirmableDraft(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ tender: { method: 'CASH', amountReceived: '200' } });

      const crossCompany = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(crossCompany.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------
  describe('status transitions', () => {
    it('DRAFT -> CANCELLED is allowed and has no inventory effect', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await draftSale(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const cancel = await agent
        .post(`/api/v1/sales/${saleId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(200);
      expect(
        (cancel.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('CANCELLED');
    });

    it('CONFIRMED -> CANCELLED is rejected (SALE_NOT_EDITABLE) — confirmed sales are never cancelled through this path', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(
        productId,
        'transition-confirmed-cancel',
      );
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '10' }] },
      );
      const { body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '1', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);

      const cancel = await agent
        .post(`/api/v1/sales/${saleId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(409);
      expect((cancel.body as ErrorEnvelope).error.code).toBe(
        'SALE_NOT_EDITABLE',
      );
    });

    it('CANCELLED -> CONFIRMED is rejected', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await draftSale(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      await agent
        .post(`/api/v1/sales/${saleId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);

      const confirm = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(409);
      expect((confirm.body as ErrorEnvelope).error.code).toBe(
        'SALE_NOT_EDITABLE',
      );
    });

    it('PATCH on a CONFIRMED sale is rejected', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant(
        productId,
        'transition-confirmed-update',
      );
      await setPrice(agent, priceListId, variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        { warehouseId, lines: [{ productVariantId: variant, quantity: '10' }] },
      );
      const { body } = await draftSale(agent, {
        lines: [
          { productVariantId: variant, quantity: '1', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);

      const update = await agent
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ notes: 'should fail' });
      expect(update.status).toBe(409);
      expect((update.body as ErrorEnvelope).error.code).toBe(
        'SALE_NOT_EDITABLE',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Customer / warehouse validation
  // ---------------------------------------------------------------------
  describe('customer and warehouse validation', () => {
    it('rejects an inactive customer', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent, {
        customerId: customerInactiveId,
      });
      expect(status).toBe(409);
      expect((body as ErrorEnvelope).error.code).toBe('SALE_CUSTOMER_INACTIVE');
    });

    it('rejects an inactive warehouse', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent, {
        warehouseId: warehouseInactiveId,
      });
      expect(status).toBe(409);
      expect((body as ErrorEnvelope).error.code).toBe('SALE_WAREHOUSE_INVALID');
    });

    it('rejects a warehouse with allowsSales=false', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent, {
        warehouseId: warehouseNoSalesId,
      });
      expect(status).toBe(409);
      expect((body as ErrorEnvelope).error.code).toBe('SALE_WAREHOUSE_INVALID');
    });
  });

  // ---------------------------------------------------------------------
  // Decimal precision
  // ---------------------------------------------------------------------
  describe('decimal precision', () => {
    it('fractional quantity (3 decimal places) and fractional price aggregate with no floating-point drift', async () => {
      const agent = await loginAs(userAdminId);
      // variantKgId: price 50 (from top-level beforeAll), base unit KG allows 3 decimal places.
      const { status, body } = await draftSale(agent, {
        lines: [
          {
            productVariantId: variantKgId,
            quantity: '1.333',
            discountPercentage: '15',
          },
        ],
      });
      expect(status).toBe(201);
      const line = (body as { salesDocument: SaleBody }).salesDocument.lines[0];
      // gross = 1.333 * 50 = 66.65; discount = 66.65 * 0.15 = 9.9975 -> rounded 10.00 (HALF_UP); net = 56.65
      expect(line.discountAmount).toBe('9.9975');
      expect(line.netAmount).toBe('56.6525');
      expect((body as { salesDocument: SaleBody }).salesDocument.total).toBe(
        '56.6525',
      );
    });

    it('rejects a quantity with more decimal places than the unit allows', async () => {
      const agent = await loginAs(userAdminId);
      const { status, body } = await draftSale(agent, {
        lines: [
          {
            productVariantId: variantKgId,
            quantity: '1.2345',
            discountPercentage: '0',
          },
        ],
      });
      expect(status).toBe(400);
      expect((body as ErrorEnvelope).error.code).toBe(
        'INVALID_QUANTITY_PRECISION',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Company isolation
  // ---------------------------------------------------------------------
  describe('company isolation', () => {
    it('a sale created in company A is not reachable scoped to company B', async () => {
      const agent = await loginAs(userAdminId);
      const { body } = await draftSale(agent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const crossCompany = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(crossCompany.status).toBe(404);

      const sameCompany = await agent
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(sameCompany.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Permission enforcement
  // ---------------------------------------------------------------------
  describe('permission enforcement', () => {
    it('403s sales.documents.read specifically when missing', async () => {
      const agent = await loginAs(userNoReadId);
      const res = await agent
        .get('/api/v1/sales')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s sales.documents.create specifically when missing', async () => {
      const agent = await loginAs(userNoCreateId);
      const { status, body } = await draftSale(agent);
      expect(status).toBe(403);
      expect((body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s sales.documents.update specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const { body } = await draftSale(adminAgent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const agent = await loginAs(userNoUpdateId);
      const res = await agent
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ notes: 'nope' });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s sales.documents.confirm specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const { body } = await draftSale(adminAgent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const agent = await loginAs(userNoConfirmId);
      const res = await agent
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s sales.documents.cancel specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const { body } = await draftSale(adminAgent);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const agent = await loginAs(userNoCancelId);
      const res = await agent
        .post(`/api/v1/sales/${saleId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });
  });

  // ---------------------------------------------------------------------
  // Numbering
  // ---------------------------------------------------------------------
  describe('numbering', () => {
    it('assigns a company-scoped, sequential, zero-padded VTA- number', async () => {
      const agent = await loginAs(userAdminId);
      const first = await draftSale(agent);
      const second = await draftSale(agent);
      const firstNumber = (first.body as { salesDocument: SaleBody })
        .salesDocument.number;
      const secondNumber = (second.body as { salesDocument: SaleBody })
        .salesDocument.number;
      expect(firstNumber).toMatch(/^VTA-\d{6}$/);
      expect(secondNumber).toMatch(/^VTA-\d{6}$/);
      expect(Number(secondNumber.slice(4))).toBe(
        Number(firstNumber.slice(4)) + 1,
      );
    });
  });
});
