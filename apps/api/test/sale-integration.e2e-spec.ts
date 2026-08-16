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
  productVariantId: string;
  quantity: string;
  unitPrice: string;
  netAmount: string;
}
interface SaleBody {
  id: string;
  number: string;
  status: string;
  total: string;
  lines: SaleLineBody[];
}

/**
 * Prompt #13 — end-to-end Sale/Pricing/Inventory hardening. This file is
 * deliberately separate from sales.e2e-spec.ts (see docs/development-workflow.md
 * / prompts/planned/013): it covers integration scenarios that file doesn't
 * already exercise — cross-company reference rejection (the write-time ID-
 * substitution matrix, distinct from the read-scoping isolation test already
 * there), draft repricing on a price-list change, genuine concurrent-request
 * races (same-draft double confirm, two sales competing for the same stock,
 * concurrent numbering), and ledger/projection consistency after a confirmed
 * sale — rather than duplicating what's already proven (pricing snapshot,
 * SERVICE no-movement, multi-line rollback, tender behavior, decimal safety,
 * permission gates: all already covered in sales.e2e-spec.ts).
 *
 * Self-contained fixtures, not the dev seed — same pattern as every other
 * e2e spec in this suite. Company A AND Company B each get their own full
 * set of product/variant/warehouse/customer/price-list so a genuine
 * cross-company ID can be supplied while operating in the other company's
 * context (sales.e2e-spec.ts's own Company B has no such fixtures — it only
 * proves a sale can't be *read* cross-company, not that a cross-company
 * *reference* is rejected at write time).
 */
describe('Sale integration — cross-company references, repricing, concurrency, ledger consistency (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let unitAId: string;
  let unitBId: string;

  let productAId: string;
  let variantAId: string;
  let variantBId: string; // belongs to company B

  let warehouseAId: string;
  let warehouseBId: string; // belongs to company B

  let customerAId: string;
  let customerBId: string; // belongs to company B

  let priceListAId: string;
  let priceListBId: string; // belongs to company B, prices variant B

  let userAdminId: string; // member of BOTH companies, full sales perms in both
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
        name: `E2E Sale Integration Tenant ${suffix}`,
        slug: `e2e-sale-integration-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Sale Integration Company A',
        taxId: `e2e-sale-integ-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Sale Integration Company B',
        taxId: `e2e-sale-integ-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const currency = await prisma.currency.upsert({
      where: { code: `E2ESALEINT${suffix}` },
      update: {},
      create: {
        code: `E2ESALEINT${suffix}`,
        name: 'E2E Sale Integration Peso',
        symbol: '$',
        decimalPlaces: 2,
      },
    });

    const unitA = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });
    unitAId = unitA.id;
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
    unitBId = unitB.id;

    const productA = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SIPROD-A-${suffix}`,
        name: 'Sale Integration Product A',
        baseUnitId: unitAId,
        trackInventory: true,
      },
    });
    productAId = productA.id;
    const variantA = await prisma.productVariant.create({
      data: { productId: productAId, name: null },
    });
    variantAId = variantA.id;

    const productB = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `SIPROD-B-${suffix}`,
        name: 'Sale Integration Product B',
        baseUnitId: unitBId,
        trackInventory: true,
      },
    });
    const variantB = await prisma.productVariant.create({
      data: { productId: productB.id, name: null },
    });
    variantBId = variantB.id;

    const warehouseA = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SIWH-A-${suffix}`,
        name: 'Sale Integration Warehouse A',
      },
    });
    warehouseAId = warehouseA.id;
    const warehouseB = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `SIWH-B-${suffix}`,
        name: 'Sale Integration Warehouse B',
      },
    });
    warehouseBId = warehouseB.id;

    const customerA = await prisma.customer.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SICUST-A-${suffix}`,
        legalName: 'Sale Integration Customer A',
      },
    });
    customerAId = customerA.id;
    const customerB = await prisma.customer.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `SICUST-B-${suffix}`,
        legalName: 'Sale Integration Customer B',
      },
    });
    customerBId = customerB.id;

    // Price lists created directly via Prisma (same as every other master
    // fixture in this file) — PricingService.setPrice's business rules
    // (overlap/auto-close) aren't what's under test here, so there's no
    // need to route fixture setup through the pricing API/permissions.
    const priceListA = await prisma.priceList.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `SIPL-A-${suffix}`,
        name: 'Sale Integration Price List A',
        currencyId: currency.id,
        pricingMode: 'FIXED',
        active: true,
      },
    });
    priceListAId = priceListA.id;
    await prisma.priceListItem.create({
      data: {
        tenantId,
        companyId: companyAId,
        priceListId: priceListAId,
        productVariantId: variantAId,
        price: '100',
        effectiveFrom: new Date('2020-01-01'),
      },
    });

    const priceListB = await prisma.priceList.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `SIPL-B-${suffix}`,
        name: 'Sale Integration Price List B',
        currencyId: currency.id,
        pricingMode: 'FIXED',
        active: true,
      },
    });
    priceListBId = priceListB.id;
    await prisma.priceListItem.create({
      data: {
        tenantId,
        companyId: companyBId,
        priceListId: priceListBId,
        productVariantId: variantBId,
        price: '50',
        effectiveFrom: new Date('2020-01-01'),
      },
    });

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'sales', resource, action },
      });
    }
    const permIds = [
      (await makePermission('sales.documents.read')).id,
      (await makePermission('sales.documents.create')).id,
      (await makePermission('sales.documents.update')).id,
      (await makePermission('sales.documents.confirm')).id,
      (await makePermission('sales.documents.cancel')).id,
    ];

    const roleA = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: 'Sale Integration Full A',
      },
    });
    await prisma.rolePermission.createMany({
      data: permIds.map((permissionId) => ({ roleId: roleA.id, permissionId })),
    });
    const roleB = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyBId,
        name: 'Sale Integration Full B',
      },
    });
    await prisma.rolePermission.createMany({
      data: permIds.map((permissionId) => ({ roleId: roleB.id, permissionId })),
    });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userAdmin = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'SaleIntegrationAdmin',
        email: `e2e-sale-integration-admin-${suffix}@example.com`,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    userAdminId = userAdmin.id;
    userIds.push(userAdmin.id);

    await prisma.userCompany.create({
      data: {
        userId: userAdminId,
        tenantId,
        companyId: companyAId,
        active: true,
      },
    });
    await prisma.userCompany.create({
      data: {
        userId: userAdminId,
        tenantId,
        companyId: companyBId,
        active: true,
      },
    });
    await prisma.userRole.create({
      data: { userId: userAdminId, roleId: roleA.id, companyId: companyAId },
    });
    await prisma.userRole.create({
      data: { userId: userAdminId, roleId: roleB.id, companyId: companyBId },
    });
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

  let agent: request.Agent;
  async function loginAsAdmin() {
    if (agent) return agent;
    agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({
      email: `e2e-sale-integration-admin-${suffix}@example.com`,
      password,
    });
    expect(res.status).toBe(200);
    return agent;
  }

  async function freshVariant(label: string) {
    const v = await prisma.productVariant.create({
      data: {
        productId: productAId,
        name: `${label}-${suffix}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return v.id;
  }

  async function priceVariant(variantId: string, price: string) {
    await prisma.priceListItem.create({
      data: {
        tenantId,
        companyId: companyAId,
        priceListId: priceListAId,
        productVariantId: variantId,
        price,
        effectiveFrom: new Date('2020-01-01'),
      },
    });
  }

  async function draftSale(
    a: request.Agent,
    overrides: Record<string, unknown> = {},
  ): Promise<{
    status: number;
    body: { salesDocument: SaleBody } | ErrorEnvelope;
  }> {
    const res = await a
      .post('/api/v1/sales')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        customerId: customerAId,
        warehouseId: warehouseAId,
        priceListId: priceListAId,
        lines: [
          {
            productVariantId: variantAId,
            quantity: '1',
            discountPercentage: '0',
          },
        ],
        ...overrides,
      });
    return {
      status: res.status,
      body: res.body as { salesDocument: SaleBody } | ErrorEnvelope,
    };
  }

  // -----------------------------------------------------------------------
  // Draft repricing — docs/sales.md's documented rule: changing a DRAFT's
  // priceListId re-resolves EVERY line against the new list, even if the
  // caller didn't resend `lines`.
  // -----------------------------------------------------------------------
  describe('draft repricing on price-list change', () => {
    it('changing priceListId on a DRAFT re-resolves every line against the new list and recomputes totals, with no stock effect', async () => {
      const a = await loginAsAdmin();
      const variant = await freshVariant('reprice');
      await priceVariant(variant, '100');

      // A second, company-A price list pricing the same variant differently.
      const secondList = await prisma.priceList.create({
        data: {
          tenantId,
          companyId: companyAId,
          code: `SIPL-REPRICE-${suffix}`,
          name: 'Reprice Target List',
          currencyId: (
            await prisma.priceList.findUniqueOrThrow({
              where: { id: priceListAId },
            })
          ).currencyId,
          pricingMode: 'FIXED',
          active: true,
        },
      });
      await prisma.priceListItem.create({
        data: {
          tenantId,
          companyId: companyAId,
          priceListId: secondList.id,
          productVariantId: variant,
          price: '250',
          effectiveFrom: new Date('2020-01-01'),
        },
      });

      const created = await draftSale(a, {
        lines: [
          { productVariantId: variant, quantity: '2', discountPercentage: '0' },
        ],
      });
      expect(created.status).toBe(201);
      const sale = (created.body as { salesDocument: SaleBody }).salesDocument;
      expect(sale.lines[0].unitPrice).toBe('100');
      expect(sale.total).toBe('200');

      const balanceBefore = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );

      // Change ONLY the price list — lines are not resent.
      const repriced = await a
        .patch(`/api/v1/sales/${sale.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ priceListId: secondList.id });
      expect(repriced.status).toBe(200);
      const repricedSale = (repriced.body as { salesDocument: SaleBody })
        .salesDocument;
      expect(repricedSale.lines[0].unitPrice).toBe('250');
      expect(repricedSale.total).toBe('500');
      expect(repricedSale.status).toBe('DRAFT');

      // Still DRAFT — no inventory effect from the reprice itself.
      const balanceAfter = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-company reference rejection — the write-time ID-substitution
  // matrix. Every one of these supplies a real, existing id that belongs to
  // Company B while operating in Company A's context (X-Company-Id: A) —
  // must read as not-found, exactly like a nonexistent id, never leaking
  // that the id is valid *somewhere else*.
  // -----------------------------------------------------------------------
  describe('cross-company references are rejected as not-found, never leaked', () => {
    it('rejects a Company B customerId on create', async () => {
      const a = await loginAsAdmin();
      const res = await draftSale(a, { customerId: customerBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('rejects a Company B productVariantId on create', async () => {
      const a = await loginAsAdmin();
      const res = await draftSale(a, {
        lines: [
          {
            productVariantId: variantBId,
            quantity: '1',
            discountPercentage: '0',
          },
        ],
      });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    });

    it('rejects a Company B warehouseId on create', async () => {
      const a = await loginAsAdmin();
      const res = await draftSale(a, { warehouseId: warehouseBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'WAREHOUSE_NOT_FOUND',
      );
    });

    it('rejects a Company B priceListId on create', async () => {
      const a = await loginAsAdmin();
      const res = await draftSale(a, { priceListId: priceListBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_NOT_FOUND',
      );
    });

    it('rejects a Company B customerId on update, leaving the DRAFT untouched', async () => {
      const a = await loginAsAdmin();
      const { body } = await draftSale(a);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      const res = await a
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ customerId: customerBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('CUSTOMER_NOT_FOUND');

      const stillA = await a
        .get(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(stillA.status).toBe(200);
      expect(
        (stillA.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
    });

    it('rejects a Company B warehouseId on update', async () => {
      const a = await loginAsAdmin();
      const { body } = await draftSale(a);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      const res = await a
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ warehouseId: warehouseBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'WAREHOUSE_NOT_FOUND',
      );
    });

    it('rejects a Company B priceListId on update', async () => {
      const a = await loginAsAdmin();
      const { body } = await draftSale(a);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      const res = await a
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ priceListId: priceListBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRICE_LIST_NOT_FOUND',
      );
    });

    it('rejects a Company B productVariantId on update', async () => {
      const a = await loginAsAdmin();
      const { body } = await draftSale(a);
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      const res = await a
        .patch(`/api/v1/sales/${saleId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          lines: [
            {
              productVariantId: variantBId,
              quantity: '1',
              discountPercentage: '0',
            },
          ],
        });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Concurrency — genuine parallel requests (Promise.all), not sequential
  // retries. Reuses InventoryService's existing atomic upsert-increment
  // guarantee (see docs/inventory.md) through the Sales confirm path.
  // -----------------------------------------------------------------------
  describe('concurrency', () => {
    it('two concurrent confirm requests for the SAME draft: exactly one succeeds, stock deducted exactly once', async () => {
      const a = await loginAsAdmin();
      const variant = await freshVariant('concurrent-same-draft');
      await priceVariant(variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        {
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variant, quantity: '20' }],
        },
      );
      const { body } = await draftSale(a, {
        lines: [
          { productVariantId: variant, quantity: '5', discountPercentage: '0' },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;

      const [first, second] = await Promise.all([
        a
          .post(`/api/v1/sales/${saleId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        a
          .post(`/api/v1/sales/${saleId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
      ]);
      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );
      expect(balance.onHand).toBe('15'); // 20 - 5, deducted exactly once

      const movementCount = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          productVariantId: variant,
          referenceId: saleId,
        },
      });
      expect(movementCount).toBe(1);

      const tenderCount = await prisma.salesTender.count({
        where: { salesDocumentId: saleId },
      });
      expect(tenderCount).toBe(0); // no tender was sent either confirm call
    });

    it('two competing sales racing for the same limited stock: exactly one succeeds when negative stock is disallowed', async () => {
      const a = await loginAsAdmin();
      const variant = await freshVariant('competing-sales');
      await priceVariant(variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        {
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variant, quantity: '5' }],
        },
      );

      const saleA = await draftSale(a, {
        lines: [
          { productVariantId: variant, quantity: '4', discountPercentage: '0' },
        ],
      });
      const saleB = await draftSale(a, {
        lines: [
          { productVariantId: variant, quantity: '4', discountPercentage: '0' },
        ],
      });
      const saleAId = (saleA.body as { salesDocument: SaleBody }).salesDocument
        .id;
      const saleBId = (saleB.body as { salesDocument: SaleBody }).salesDocument
        .id;

      const [resultA, resultB] = await Promise.all([
        a
          .post(`/api/v1/sales/${saleAId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        a
          .post(`/api/v1/sales/${saleBId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
      ]);
      const statuses = [resultA.status, resultB.status].sort();
      // Exactly one confirms (200); the other is rejected for insufficient stock (409) — never both, never a negative balance.
      expect(statuses).toEqual([200, 409]);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );
      expect(balance.onHand).toBe('1'); // 5 - 4, exactly one sale's worth deducted
      expect(Number(balance.onHand)).toBeGreaterThanOrEqual(0);

      const rejected = resultA.status === 409 ? resultA : resultB;
      expect((rejected.body as ErrorEnvelope).error.code).toBe(
        'INSUFFICIENT_STOCK',
      );

      // The rejected sale's own status must have rolled back to DRAFT — a
      // failed confirm never leaves a half-confirmed sale (see docs/sales.md).
      const rejectedSaleId = resultA.status === 409 ? saleAId : saleBId;
      const rejectedSale = await a
        .get(`/api/v1/sales/${rejectedSaleId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (rejectedSale.body as { salesDocument: SaleBody }).salesDocument.status,
      ).toBe('DRAFT');
    });

    it('concurrent draft creation produces unique, gapless sequential numbers with no duplicates', async () => {
      const a = await loginAsAdmin();
      const CONCURRENT_COUNT = 6;
      const results = await Promise.all(
        Array.from({ length: CONCURRENT_COUNT }, () => draftSale(a)),
      );
      for (const r of results) expect(r.status).toBe(201);
      const numbers = results.map(
        (r) => (r.body as { salesDocument: SaleBody }).salesDocument.number,
      );
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(CONCURRENT_COUNT); // no two concurrent creates ever got the same number

      const sequenceValues = numbers
        .map((n) => Number(n.slice(4)))
        .sort((x, y) => x - y);
      const min = sequenceValues[0];
      const max = sequenceValues[sequenceValues.length - 1];
      expect(max - min + 1).toBe(CONCURRENT_COUNT); // contiguous — the atomic upsert-increment never skips or races a gap
    });
  });

  // -----------------------------------------------------------------------
  // Inventory ledger/projection consistency — StockMovement is the source
  // of truth, InventoryBalance a rebuildable projection (see docs/inventory.md).
  // -----------------------------------------------------------------------
  describe('inventory ledger/projection consistency after a confirmed sale', () => {
    it('InventoryBalance matches the StockMovement ledger, and rebuildInventoryBalances reproduces the same onHand', async () => {
      const a = await loginAsAdmin();
      const variant = await freshVariant('ledger-consistency');
      await priceVariant(variant, '10');
      await inventoryService.createInitialBalance(
        { userId: userAdminId, companyId: companyAId, tenantId },
        {
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variant, quantity: '30' }],
        },
      );

      const { body } = await draftSale(a, {
        lines: [
          {
            productVariantId: variant,
            quantity: '12',
            discountPercentage: '0',
          },
        ],
      });
      const saleId = (body as { salesDocument: SaleBody }).salesDocument.id;
      const confirmRes = await a
        .post(`/api/v1/sales/${saleId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmRes.status).toBe(200);

      const balanceBeforeRebuild = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );
      expect(balanceBeforeRebuild.onHand).toBe('18'); // 30 - 12

      // Independently recompute from the ledger itself.
      const ledgerSum = await prisma.stockMovement.aggregate({
        where: {
          companyId: companyAId,
          warehouseId: warehouseAId,
          productVariantId: variant,
        },
        _sum: { quantity: true },
      });
      expect(ledgerSum._sum.quantity?.toString()).toBe('18');

      // Rebuild the projection from scratch and confirm it lands on the same value.
      await inventoryService.rebuildInventoryBalances(companyAId);
      const balanceAfterRebuild = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variant,
      );
      expect(balanceAfterRebuild.onHand).toBe('18');
    });
  });
});
