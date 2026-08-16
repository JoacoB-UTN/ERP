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
import { InsufficientAvailableStockException } from '../src/inventory/inventory.exceptions';
import type { RequestContext } from '../src/company-context/types';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface WarehouseBody {
  id: string;
  code: string;
  status: string;
}
interface AdjustmentBody {
  id: string;
  number: string;
  status: string;
  lines: { id: string; quantityDelta: string }[];
}
interface StockRowBody {
  variantId: string;
  warehouse: { id: string };
  onHand: string;
  reserved: string;
  available: string;
}
interface MovementBody {
  id: string;
  movementType: string;
  quantity: string;
}

/**
 * Mandatory Inventory coverage per the Prompt #8 task spec — see
 * docs/inventory.md. Self-contained fixtures, not the dev seed. Mixes
 * supertest (HTTP contract, permissions, company/branch isolation) with
 * direct `app.get(InventoryService)` calls for ledger internals that have
 * no public API in this task (reservations, rebuild) — same pattern as
 * audit.e2e-spec.ts's direct AuditService use.
 */
describe('Inventory (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let branchA1Id: string;
  let branchA2Id: string;
  let branchBId: string;

  let unitUnId: string;
  let unitKgId: string;

  // companyA fixtures
  let productMainId: string;
  let variantMainId: string;
  let variantNegOkId: string;
  let productKgId: string;
  let variantKgId: string;
  let variantServiceId: string;

  let warehouseAId: string; // companyA, branchA1, allowNegativeStock=false
  let warehouseANegId: string; // companyA, allowNegativeStock=true
  let warehouseBId: string; // companyB

  let userAdminId: string; // full inventory perms, member of A AND B
  let userStockReadOnlyId: string;
  let userNoMovementsId: string;
  let userNoAdjustCreateId: string;
  let userNoAdjustConfirmId: string;
  let userNoWarehouseUpdateId: string;
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
    inventoryService = app.get(InventoryService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Inventory Tenant ${suffix}`,
        slug: `e2e-inventory-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Inventory Company A',
        taxId: `e2e-inventory-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Inventory Company B',
        taxId: `e2e-inventory-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const branchA1 = await prisma.branch.create({
      data: { tenantId, companyId: companyAId, code: 'A1', name: 'Branch A1' },
    });
    const branchA2 = await prisma.branch.create({
      data: { tenantId, companyId: companyAId, code: 'A2', name: 'Branch A2' },
    });
    const branchB = await prisma.branch.create({
      data: { tenantId, companyId: companyBId, code: 'B1', name: 'Branch B1' },
    });
    branchA1Id = branchA1.id;
    branchA2Id = branchA2.id;
    branchBId = branchB.id;

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

    async function makeProductWithVariant(params: {
      companyId: string;
      code: string;
      name: string;
      baseUnitId: string;
      trackInventory: boolean;
      allowNegativeStock?: boolean;
      productType?: 'PRODUCT' | 'SERVICE';
    }) {
      const product = await prisma.product.create({
        data: {
          tenantId,
          companyId: params.companyId,
          code: params.code,
          name: params.name,
          baseUnitId: params.baseUnitId,
          trackInventory: params.trackInventory,
          allowNegativeStock: params.allowNegativeStock ?? false,
          productType: params.productType ?? 'PRODUCT',
        },
      });
      const variant = await prisma.productVariant.create({
        data: { productId: product.id, name: null },
      });
      return { productId: product.id, variantId: variant.id };
    }

    const main = await makeProductWithVariant({
      companyId: companyAId,
      code: `MAIN-${suffix}`,
      name: 'Main Product',
      baseUnitId: unitUnId,
      trackInventory: true,
      allowNegativeStock: false,
    });
    productMainId = main.productId;
    variantMainId = main.variantId;

    const negOk = await makeProductWithVariant({
      companyId: companyAId,
      code: `NEGOK-${suffix}`,
      name: 'Negative-OK Product',
      baseUnitId: unitUnId,
      trackInventory: true,
      allowNegativeStock: true,
    });
    variantNegOkId = negOk.variantId;

    const kg = await makeProductWithVariant({
      companyId: companyAId,
      code: `KG-${suffix}`,
      name: 'Kg Product',
      baseUnitId: unitKgId,
      trackInventory: true,
    });
    productKgId = kg.productId;
    variantKgId = kg.variantId;

    const service = await makeProductWithVariant({
      companyId: companyAId,
      code: `SVC-${suffix}`,
      name: 'Service Product',
      baseUnitId: unitUnId,
      trackInventory: false,
      productType: 'SERVICE',
    });
    variantServiceId = service.variantId;

    const warehouseA = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        branchId: branchA1Id,
        code: `WH-A-${suffix}`,
        name: 'Warehouse A',
        allowNegativeStock: false,
      },
    });
    const warehouseANeg = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `WH-A-NEG-${suffix}`,
        name: 'Warehouse A (allows negative)',
        allowNegativeStock: true,
      },
    });
    const warehouseB = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `WH-B-${suffix}`,
        name: 'Warehouse B',
      },
    });
    warehouseAId = warehouseA.id;
    warehouseANegId = warehouseANeg.id;
    warehouseBId = warehouseB.id;

    async function makePermission(code: string) {
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: 'inventory',
          resource: code.split('.')[1],
          action: code.split('.')[2],
        },
      });
    }
    const permWarehousesRead = await makePermission(
      'inventory.warehouses.read',
    );
    const permWarehousesCreate = await makePermission(
      'inventory.warehouses.create',
    );
    const permWarehousesUpdate = await makePermission(
      'inventory.warehouses.update',
    );
    const permWarehousesDeactivate = await makePermission(
      'inventory.warehouses.deactivate',
    );
    const permStockRead = await makePermission('inventory.stock.read');
    const permMovementsRead = await makePermission('inventory.movements.read');
    const permAdjustmentsRead = await makePermission(
      'inventory.adjustments.read',
    );
    const permAdjustmentsCreate = await makePermission(
      'inventory.adjustments.create',
    );
    const permAdjustmentsConfirm = await makePermission(
      'inventory.adjustments.confirm',
    );
    const permInitialBalanceCreate = await makePermission(
      'inventory.initial-balance.create',
    );

    const ALL_PERM_IDS = [
      permWarehousesRead.id,
      permWarehousesCreate.id,
      permWarehousesUpdate.id,
      permWarehousesDeactivate.id,
      permStockRead.id,
      permMovementsRead.id,
      permAdjustmentsRead.id,
      permAdjustmentsCreate.id,
      permAdjustmentsConfirm.id,
      permInitialBalanceCreate.id,
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
      'Inventory E2E Full A',
      ALL_PERM_IDS,
    );
    const roleFullB = await makeRole(
      companyBId,
      'Inventory E2E Full B',
      ALL_PERM_IDS,
    );
    const roleStockReadOnly = await makeRole(
      companyAId,
      'Inventory E2E Stock Read Only',
      [permStockRead.id],
    );
    const roleNoMovements = await makeRole(
      companyAId,
      'Inventory E2E No Movements',
      ALL_PERM_IDS.filter((id) => id !== permMovementsRead.id),
    );
    const roleNoAdjustCreate = await makeRole(
      companyAId,
      'Inventory E2E No Adjust Create',
      ALL_PERM_IDS.filter((id) => id !== permAdjustmentsCreate.id),
    );
    const roleNoAdjustConfirm = await makeRole(
      companyAId,
      'Inventory E2E No Adjust Confirm',
      ALL_PERM_IDS.filter((id) => id !== permAdjustmentsConfirm.id),
    );
    const roleNoWarehouseUpdate = await makeRole(
      companyAId,
      'Inventory E2E No Warehouse Update',
      ALL_PERM_IDS.filter((id) => id !== permWarehousesUpdate.id),
    );
    const roleNoAccess = await makeRole(
      companyAId,
      'Inventory E2E No Access',
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
          email: `e2e-inventory-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userAdmin = await makeUser('Admin');
    const userStockReadOnly = await makeUser('StockReadOnly');
    const userNoMovements = await makeUser('NoMovements');
    const userNoAdjustCreate = await makeUser('NoAdjustCreate');
    const userNoAdjustConfirm = await makeUser('NoAdjustConfirm');
    const userNoWarehouseUpdate = await makeUser('NoWarehouseUpdate');
    const userNoAccess = await makeUser('NoAccess');

    userAdminId = userAdmin.id;
    userStockReadOnlyId = userStockReadOnly.id;
    userNoMovementsId = userNoMovements.id;
    userNoAdjustCreateId = userNoAdjustCreate.id;
    userNoAdjustConfirmId = userNoAdjustConfirm.id;
    userNoWarehouseUpdateId = userNoWarehouseUpdate.id;
    userNoAccessId = userNoAccess.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userAdminId, companyBId);
    await membership(userStockReadOnlyId, companyAId);
    await membership(userNoMovementsId, companyAId);
    await membership(userNoAdjustCreateId, companyAId);
    await membership(userNoAdjustConfirmId, companyAId);
    await membership(userNoWarehouseUpdateId, companyAId);
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
    await assignRole(userStockReadOnlyId, roleStockReadOnly.id, companyAId);
    await assignRole(userNoMovementsId, roleNoMovements.id, companyAId);
    await assignRole(userNoAdjustCreateId, roleNoAdjustCreate.id, companyAId);
    await assignRole(userNoAdjustConfirmId, roleNoAdjustConfirm.id, companyAId);
    await assignRole(
      userNoWarehouseUpdateId,
      roleNoWarehouseUpdate.id,
      companyAId,
    );
    await assignRole(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockAdjustmentLine.deleteMany({
      where: {
        stockAdjustment: { companyId: { in: [companyAId, companyBId] } },
      },
    });
    await prisma.stockAdjustment.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockAdjustmentSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockReservation.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockMovement.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.inventoryBalance.deleteMany({
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
    await prisma.branch.deleteMany({
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

  function ctxA(overrides: Partial<RequestContext> = {}): RequestContext {
    return {
      userId: userAdminId,
      companyId: companyAId,
      tenantId,
      ...overrides,
    };
  }

  // ---------------------------------------------------------------------
  // Permission enforcement
  // ---------------------------------------------------------------------
  describe('permission enforcement', () => {
    it('403s a user with no inventory permissions on stock read', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/inventory/stock')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('a stock.read-only user can read stock but not movements/adjustments/warehouses', async () => {
      const agent = await loginAs(userStockReadOnlyId);
      const stock = await agent
        .get('/api/v1/inventory/stock')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(stock.status).toBe(200);

      const movements = await agent
        .get('/api/v1/inventory/movements')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(movements.status).toBe(403);

      const adjustments = await agent
        .get('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(adjustments.status).toBe(403);

      const warehouses = await agent
        .get('/api/v1/warehouses')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(warehouses.status).toBe(403);
    });

    it('403s inventory.movements.read specifically when missing', async () => {
      const agent = await loginAs(userNoMovementsId);
      const res = await agent
        .get('/api/v1/inventory/movements')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s inventory.adjustments.create specifically when missing', async () => {
      const agent = await loginAs(userNoAdjustCreateId);
      const res = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Should fail',
          lines: [{ productVariantId: variantMainId, quantityDelta: '1' }],
        });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('403s inventory.adjustments.confirm specifically when missing', async () => {
      const adminAgent = await loginAs(userAdminId);
      const draft = await adminAgent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'For confirm-permission test',
          lines: [{ productVariantId: variantMainId, quantityDelta: '1' }],
        });
      expect(draft.status).toBe(201);
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const agent = await loginAs(userNoAdjustConfirmId);
      const res = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');

      // Cleanup — cancel the leftover draft so it doesn't interfere with later tests.
      await adminAgent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
    });

    it('403s inventory.warehouses.update specifically when missing', async () => {
      const agent = await loginAs(userNoWarehouseUpdateId);
      const res = await agent
        .patch(`/api/v1/warehouses/${warehouseAId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Should not update' });
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });
  });

  // ---------------------------------------------------------------------
  // Company isolation
  // ---------------------------------------------------------------------
  describe('company isolation', () => {
    it('a warehouse from company B is not visible/reachable from company A', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/warehouses/${warehouseBId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(404);
    });

    it('a movement created in company A is not reachable scoped to company B', async () => {
      const agent = await loginAs(userAdminId);
      const initial = await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variantMainId, quantity: '5' }],
        });
      expect(initial.status).toBe(201);
      const movementId = (initial.body as { movements: MovementBody[] })
        .movements[0].id;

      const crossCompany = await agent
        .get(`/api/v1/inventory/movements/${movementId}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(crossCompany.status).toBe(404);

      const sameCompany = await agent
        .get(`/api/v1/inventory/movements/${movementId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(sameCompany.status).toBe(200);
    });

    it('an adjustment created in company A is not reachable scoped to company B', async () => {
      const agent = await loginAs(userAdminId);
      const created = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Isolation check',
          lines: [{ productVariantId: variantMainId, quantityDelta: '1' }],
        });
      expect(created.status).toBe(201);
      const adjustmentId = (created.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const crossCompany = await agent
        .get(`/api/v1/inventory/adjustments/${adjustmentId}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(crossCompany.status).toBe(404);

      await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
    });

    it('InventoryBalance/StockReservation are isolated by companyId at the service layer', async () => {
      const balanceCrossCompany = await inventoryService.getBalance(
        companyBId,
        warehouseAId,
        variantMainId,
      );
      // Company B has no InventoryBalance row for company A's warehouse/variant pair — reads as zero, never leaks A's real balance.
      expect(balanceCrossCompany.onHand).toBe('0');

      await expect(
        inventoryService.reserve(ctxA({ companyId: companyBId }), {
          warehouseId: warehouseAId,
          productVariantId: variantMainId,
          quantity: '1',
          sourceType: 'TEST',
          sourceId: 'x',
        }),
      ).rejects.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // Branch isolation
  // ---------------------------------------------------------------------
  describe('branch isolation', () => {
    it('rejects creating a warehouse with a branch that belongs to a different company', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/warehouses')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `WH-BADBRANCH-${suffix}`,
          name: 'Bad Branch Warehouse',
          branchId: branchBId,
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'WAREHOUSE_INVALID_BRANCH',
      );
    });

    it('accepts creating/updating a warehouse with a branch that belongs to the SAME company', async () => {
      const agent = await loginAs(userAdminId);
      const created = await agent
        .post('/api/v1/warehouses')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `WH-GOODBRANCH-${suffix}`,
          name: 'Good Branch Warehouse',
          branchId: branchA2Id,
        });
      expect(created.status).toBe(201);
      expect(
        (created.body as { warehouse: WarehouseBody }).warehouse.code,
      ).toBe(`WH-GOODBRANCH-${suffix}`);

      const warehouseId = (created.body as { warehouse: WarehouseBody })
        .warehouse.id;
      const updated = await agent
        .patch(`/api/v1/warehouses/${warehouseId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ branchId: branchA1Id });
      expect(updated.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Basic movement flow
  // ---------------------------------------------------------------------
  describe('basic movement flow', () => {
    it('initial balance +100 then adjustment -10 leaves ON_HAND at 90', async () => {
      const agent = await loginAs(userAdminId);

      const initial = await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseANegId,
          lines: [{ productVariantId: variantNegOkId, quantity: '100' }],
        });
      expect(initial.status).toBe(201);

      let balance = await inventoryService.getBalance(
        companyAId,
        warehouseANegId,
        variantNegOkId,
      );
      expect(balance.onHand).toBe('100');

      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseANegId,
          reason: 'Basic movement test',
          lines: [{ productVariantId: variantNegOkId, quantityDelta: '-10' }],
        });
      expect(draft.status).toBe(201);
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const confirmed = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmed.status).toBe(200);
      expect(
        (confirmed.body as { adjustment: AdjustmentBody }).adjustment.status,
      ).toBe('CONFIRMED');

      balance = await inventoryService.getBalance(
        companyAId,
        warehouseANegId,
        variantNegOkId,
      );
      expect(balance.onHand).toBe('90');
    });

    it('repeating an initial balance for a variant+warehouse with existing movements is rejected', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseANegId,
          lines: [{ productVariantId: variantNegOkId, quantity: '5' }],
        });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'INITIAL_BALANCE_ALREADY_ESTABLISHED',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Reservations (service-level — no public API in this task)
  // ---------------------------------------------------------------------
  describe('reservations', () => {
    // A dedicated fresh variant per warehouse pair — variantMainId+warehouseAId already
    // has movement history from the company-isolation suite, and a repeat initial
    // balance for the same pair would be rejected with INITIAL_BALANCE_ALREADY_ESTABLISHED.
    let reservationVariantId: string;

    beforeAll(async () => {
      const variant = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Reservations-${suffix}` },
      });
      reservationVariantId = variant.id;
      const agent = await loginAs(userAdminId);
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: reservationVariantId, quantity: '100' }],
        });
    });

    it('reserve(30) then release(10) leaves RESERVED=20 and AVAILABLE=80 on ON_HAND=100', async () => {
      const reservation = await inventoryService.reserve(ctxA(), {
        warehouseId: warehouseAId,
        productVariantId: reservationVariantId,
        quantity: '30',
        sourceType: 'TEST',
        sourceId: 'reservation-1',
      });

      let balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        reservationVariantId,
      );
      expect(balance.onHand).toBe('100');
      expect(balance.reserved).toBe('30');
      expect(balance.available).toBe('70');

      await inventoryService.release(ctxA(), reservation.id, '10');

      balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        reservationVariantId,
      );
      expect(balance.reserved).toBe('20');
      expect(balance.available).toBe('80');
    });

    it('reserving more than AVAILABLE is rejected with INSUFFICIENT_AVAILABLE_STOCK', async () => {
      await expect(
        inventoryService.reserve(ctxA(), {
          warehouseId: warehouseAId,
          productVariantId: reservationVariantId,
          quantity: '999999',
          sourceType: 'TEST',
          sourceId: 'over-allocate',
        }),
      ).rejects.toBeInstanceOf(InsufficientAvailableStockException);
    });

    it('consume() moves quantity from outstanding to consumed without touching ON_HAND', async () => {
      const before = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        reservationVariantId,
      );
      const reservation = await inventoryService.reserve(ctxA(), {
        warehouseId: warehouseAId,
        productVariantId: reservationVariantId,
        quantity: '10',
        sourceType: 'TEST',
        sourceId: 'consume-1',
      });
      const consumed = await inventoryService.consume(
        ctxA(),
        reservation.id,
        '10',
      );
      expect(consumed.status).toBe('CONSUMED');
      expect(consumed.consumedQuantity.toString()).toBe('10');

      const after = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        reservationVariantId,
      );
      expect(after.onHand).toBe(before.onHand); // consume() never touches ON_HAND
      expect(after.reserved).toBe(before.reserved); // reservation fully consumed, reserved returns to baseline
    });
  });

  // ---------------------------------------------------------------------
  // Negative stock policy
  // ---------------------------------------------------------------------
  describe('negative stock policy', () => {
    it('rejects a stock-out that would go negative when NOT allowed (product AND warehouse both required)', async () => {
      const agent = await loginAs(userAdminId);
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variantKgId, quantity: '5' }],
        });

      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId, // allowNegativeStock=false
          reason: 'Should exceed on-hand',
          lines: [{ productVariantId: variantKgId, quantityDelta: '-10' }],
        });
      expect(draft.status).toBe(201);
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const confirm = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(409);
      expect((confirm.body as ErrorEnvelope).error.code).toBe(
        'INSUFFICIENT_STOCK',
      );

      // Nothing partial was committed — balance is unchanged, adjustment stays DRAFT.
      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        variantKgId,
      );
      expect(balance.onHand).toBe('5');
      const reloaded = await agent
        .get(`/api/v1/inventory/adjustments/${adjustmentId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(
        (reloaded.body as { adjustment: AdjustmentBody }).adjustment.status,
      ).toBe('DRAFT');
    });

    it('allows a stock-out that goes negative when BOTH product and warehouse allow it', async () => {
      const agent = await loginAs(userAdminId);
      // productNegOkId (allowNegativeStock=true) + warehouseANegId (allowNegativeStock=true) is already at 90 from the basic-movement-flow test.
      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseANegId,
          reason: 'Allowed negative stock-out',
          lines: [{ productVariantId: variantNegOkId, quantityDelta: '-500' }],
        });
      expect(draft.status).toBe(201);
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const confirm = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseANegId,
        variantNegOkId,
      );
      expect(balance.onHand).toBe('-410');
    });
  });

  // ---------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------
  describe('concurrency', () => {
    it('two parallel -7 stock-outs on ON_HAND=10 (negative disallowed) — only one succeeds', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Concurrency-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '10' }],
        });

      async function draftAndReturnId(delta: string) {
        const res = await agent
          .post('/api/v1/inventory/adjustments')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            warehouseId: warehouseAId,
            reason: 'Concurrency test',
            lines: [{ productVariantId: fresh.id, quantityDelta: delta }],
          });
        expect(res.status).toBe(201);
        return (res.body as { adjustment: AdjustmentBody }).adjustment.id;
      }
      const [adjustmentIdOne, adjustmentIdTwo] = await Promise.all([
        draftAndReturnId('-7'),
        draftAndReturnId('-7'),
      ]);

      const [resultOne, resultTwo] = await Promise.all([
        agent
          .post(`/api/v1/inventory/adjustments/${adjustmentIdOne}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        agent
          .post(`/api/v1/inventory/adjustments/${adjustmentIdTwo}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
      ]);

      const statuses = [resultOne.status, resultTwo.status].sort();
      // Exactly one confirm succeeds (200); the other is rejected for insufficient stock (409) — never both succeeding, never a lost update.
      expect(statuses).toEqual([200, 409]);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(balance.onHand).toBe('3');
      expect(Number(balance.onHand)).toBeGreaterThanOrEqual(0);
    });
  });

  // ---------------------------------------------------------------------
  // Decimal precision
  // ---------------------------------------------------------------------
  describe('decimal precision', () => {
    it('10.500 - 1.250 = 9.250 exactly, for a unit with 3 decimal places', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productKgId, name: `KgPrecision-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '10.500' }],
        });

      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Decimal precision test',
          lines: [{ productVariantId: fresh.id, quantityDelta: '-1.250' }],
        });
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;
      const confirmed = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmed.status).toBe(200);

      const line = (confirmed.body as { adjustment: AdjustmentBody }).adjustment
        .lines[0];
      expect(line.quantityDelta).toBe('-1.25');

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(balance.onHand).toBe('9.25');
    });

    it('rejects a quantity with more decimal places than the unit allows (Unidad, 0 places)', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Precision rejection test',
          lines: [{ productVariantId: variantMainId, quantityDelta: '1.5' }], // Unidad has decimalPlaces=0
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'INVALID_QUANTITY_PRECISION',
      );
    });

    it('rejects at creation time when the line quantity exceeds the unit precision', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Precision rejection test 2',
          lines: [{ productVariantId: variantKgId, quantityDelta: '1.2345' }], // Kilogramo has decimalPlaces=3
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'INVALID_QUANTITY_PRECISION',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Non-stock (SERVICE) product rejection
  // ---------------------------------------------------------------------
  describe('non-stock product rejection', () => {
    it('rejects an adjustment line for a product that does not track inventory', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Should be rejected',
          lines: [{ productVariantId: variantServiceId, quantityDelta: '1' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_DOES_NOT_TRACK_INVENTORY',
      );
    });

    it('rejects an initial balance for a product that does not track inventory', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: variantServiceId, quantity: '1' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_DOES_NOT_TRACK_INVENTORY',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Adjustment confirmation atomicity
  // ---------------------------------------------------------------------
  describe('adjustment confirmation is atomic', () => {
    it('confirming generates the movement, updates the balance, and records an audit entry together', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Atomicity-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '50' }],
        });

      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Atomicity test',
          lines: [{ productVariantId: fresh.id, quantityDelta: '-20' }],
        });
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;

      const beforeCount = await prisma.stockMovement.count({
        where: { companyId: companyAId, productVariantId: fresh.id },
      });

      const confirmed = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmed.status).toBe(200);

      const movement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          productVariantId: fresh.id,
          referenceType: 'StockAdjustment',
          referenceId: adjustmentId,
        },
      });
      expect(movement).not.toBeNull();
      expect(movement?.movementType).toBe('ADJUSTMENT_OUT');
      expect(movement?.quantity.toString()).toBe('-20');

      const afterCount = await prisma.stockMovement.count({
        where: { companyId: companyAId, productVariantId: fresh.id },
      });
      expect(afterCount).toBe(beforeCount + 1);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(balance.onHand).toBe('30');

      const audit = await prisma.auditLog.findFirst({
        where: {
          companyId: companyAId,
          entityType: 'StockAdjustment',
          entityId: adjustmentId,
          action: 'CONFIRM',
        },
      });
      expect(audit).not.toBeNull();
      expect((audit?.metadata as { number?: string } | null)?.number).toBe(
        (draft.body as { adjustment: AdjustmentBody }).adjustment.number,
      );
    });
  });

  // ---------------------------------------------------------------------
  // Forced transaction rollback
  // ---------------------------------------------------------------------
  describe('transaction rollback', () => {
    it('a forced mid-transaction failure leaves neither the movement nor the balance change committed', async () => {
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Rollback-${suffix}` },
      });
      const agent = await loginAs(userAdminId);
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '10' }],
        });

      const warehouse = await prisma.warehouse.findUniqueOrThrow({
        where: { id: warehouseAId },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          // First line applies fine — this is the write that must NOT survive if the transaction later fails.
          await inventoryService.applyAdjustmentLine(tx, ctxA(), {
            warehouse,
            productVariantId: fresh.id,
            quantityDelta: '-3',
            referenceType: 'StockAdjustment',
            referenceId: 'rollback-test',
            occurredAt: new Date(),
          });
          // Second line forces a failure (exceeds Unidad's decimalPlaces=0 precision).
          await inventoryService.applyAdjustmentLine(tx, ctxA(), {
            warehouse,
            productVariantId: fresh.id,
            quantityDelta: '-1.5',
            referenceType: 'StockAdjustment',
            referenceId: 'rollback-test',
            occurredAt: new Date(),
          });
        }),
      ).rejects.toThrow();

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(balance.onHand).toBe('10'); // the first line's -3 never persisted

      const movementCount = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          productVariantId: fresh.id,
          referenceId: 'rollback-test',
        },
      });
      expect(movementCount).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Movement immutability
  // ---------------------------------------------------------------------
  describe('movement immutability', () => {
    it('exposes no PATCH or DELETE route for a movement', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: {
          productId: productMainId,
          name: `MovementImmutability-${suffix}`,
        },
      });
      const initial = await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '1' }],
        });
      const movementId = (initial.body as { movements: MovementBody[] })
        .movements[0].id;

      const patchRes = await agent
        .patch(`/api/v1/inventory/movements/${movementId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ quantity: '999' });
      expect([404, 405]).toContain(patchRes.status);

      const deleteRes = await agent
        .delete(`/api/v1/inventory/movements/${movementId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect([404, 405]).toContain(deleteRes.status);

      const patchAllRes = await agent
        .patch('/api/v1/inventory/movements')
        .set(COMPANY_ID_HEADER, companyAId);
      expect([404, 405]).toContain(patchAllRes.status);
    });

    it('exposes no generic public POST for raw movements', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/movements')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          productVariantId: variantMainId,
          movementType: 'ADJUSTMENT_IN',
          quantity: '1',
        });
      expect([404, 405]).toContain(res.status);
    });

    it('a confirmed adjustment cannot be updated, confirmed again, or cancelled', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Immutable-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '10' }],
        });
      const draft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          reason: 'Immutability test',
          lines: [{ productVariantId: fresh.id, quantityDelta: '-1' }],
        });
      const adjustmentId = (draft.body as { adjustment: AdjustmentBody })
        .adjustment.id;
      await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);

      const update = await agent
        .patch(`/api/v1/inventory/adjustments/${adjustmentId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ reason: 'Should not apply' });
      expect(update.status).toBe(409);
      expect((update.body as ErrorEnvelope).error.code).toBe(
        'STOCK_ADJUSTMENT_NOT_DRAFT',
      );

      const reconfirm = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(reconfirm.status).toBe(409);
      expect((reconfirm.body as ErrorEnvelope).error.code).toBe(
        'STOCK_ADJUSTMENT_NOT_DRAFT',
      );

      const cancel = await agent
        .post(`/api/v1/inventory/adjustments/${adjustmentId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(409);
      expect((cancel.body as ErrorEnvelope).error.code).toBe(
        'STOCK_ADJUSTMENT_NOT_DRAFT',
      );
    });
  });

  // ---------------------------------------------------------------------
  // Warehouse deactivation with stock
  // ---------------------------------------------------------------------
  describe('warehouse deactivation with stock', () => {
    it('rejects deactivating a warehouse that still has physical stock', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/warehouses/${warehouseAId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'WAREHOUSE_HAS_STOCK',
      );
    });

    it('allows deactivating a warehouse with zero stock and no active reservations', async () => {
      const agent = await loginAs(userAdminId);
      const empty = await agent
        .post('/api/v1/warehouses')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ code: `WH-EMPTY-${suffix}`, name: 'Empty Warehouse' });
      expect(empty.status).toBe(201);
      const warehouseId = (empty.body as { warehouse: WarehouseBody }).warehouse
        .id;

      const deactivate = await agent
        .post(`/api/v1/warehouses/${warehouseId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(deactivate.status).toBe(200);
      expect(
        (deactivate.body as { warehouse: WarehouseBody }).warehouse.status,
      ).toBe('INACTIVE');
    });

    it('rejects deactivating a warehouse that still has an active reservation, even at ON_HAND=0', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: {
          productId: productMainId,
          name: `ReservedDeactivate-${suffix}`,
        },
      });
      const warehouse = await agent
        .post('/api/v1/warehouses')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: `WH-RESERVED-${suffix}`,
          name: 'Reserved Warehouse',
          allowNegativeStock: true,
        });
      const warehouseId = (warehouse.body as { warehouse: WarehouseBody })
        .warehouse.id;

      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId,
          lines: [{ productVariantId: fresh.id, quantity: '5' }],
        });
      await inventoryService.reserve(ctxA(), {
        warehouseId,
        productVariantId: fresh.id,
        quantity: '5',
        sourceType: 'TEST',
        sourceId: 'deactivation-block',
      });

      // Reservations don't cap a further stock-out beyond AVAILABLE (only ON_HAND is checked) —
      // drain ON_HAND to exactly 0 while the reservation stays ACTIVE, so the deactivation
      // check's onHand!=0 guard is bypassed and the reservation guard is what actually fires.
      const drainDraft = await agent
        .post('/api/v1/inventory/adjustments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId,
          reason: 'Drain to zero while reserved',
          lines: [{ productVariantId: fresh.id, quantityDelta: '-5' }],
        });
      const drainId = (drainDraft.body as { adjustment: AdjustmentBody })
        .adjustment.id;
      const drainConfirm = await agent
        .post(`/api/v1/inventory/adjustments/${drainId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(drainConfirm.status).toBe(200);

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        fresh.id,
      );
      expect(balance.onHand).toBe('0');
      expect(balance.reserved).toBe('5');

      const res = await agent
        .post(`/api/v1/warehouses/${warehouseId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'WAREHOUSE_HAS_ACTIVE_RESERVATIONS',
      );
    });
  });

  // ---------------------------------------------------------------------
  // InventoryBalance reconciliation / rebuild
  // ---------------------------------------------------------------------
  describe('rebuild reconciliation', () => {
    it('rebuildInventoryBalances recomputes a deliberately corrupted balance back to the correct ledger sum', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Rebuild-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '42' }],
        });

      // Deliberately corrupt the projection directly (bypassing InventoryService) to prove rebuild recovers from it.
      await prisma.inventoryBalance.update({
        where: {
          companyId_warehouseId_productVariantId: {
            companyId: companyAId,
            warehouseId: warehouseAId,
            productVariantId: fresh.id,
          },
        },
        data: { onHand: 999999 },
      });
      const corrupted = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(corrupted.onHand).toBe('999999');

      const result =
        await inventoryService.rebuildInventoryBalances(companyAId);
      expect(result.warehouseVariantPairs).toBeGreaterThan(0);

      const rebuilt = await inventoryService.getBalance(
        companyAId,
        warehouseAId,
        fresh.id,
      );
      expect(rebuilt.onHand).toBe('42');
    });
  });

  // ---------------------------------------------------------------------
  // Stock listing sanity
  // ---------------------------------------------------------------------
  describe('stock listing', () => {
    it('GET /inventory/stock reflects Físico/Reservado/Disponible as three separate values', async () => {
      const agent = await loginAs(userAdminId);
      const fresh = await prisma.productVariant.create({
        data: { productId: productMainId, name: `Listing-${suffix}` },
      });
      await agent
        .post('/api/v1/inventory/initial-balance')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          warehouseId: warehouseAId,
          lines: [{ productVariantId: fresh.id, quantity: '60' }],
        });
      await inventoryService.reserve(ctxA(), {
        warehouseId: warehouseAId,
        productVariantId: fresh.id,
        quantity: '15',
        sourceType: 'TEST',
        sourceId: 'listing-1',
      });

      const res = await agent
        .get('/api/v1/inventory/stock')
        .query({
          warehouseId: warehouseAId,
          productId: productMainId,
          pageSize: 100,
        })
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const row = (res.body as { items: StockRowBody[] }).items.find(
        (r) => r.variantId === fresh.id,
      );
      expect(row).toBeDefined();
      expect(row?.onHand).toBe('60');
      expect(row?.reserved).toBe('15');
      expect(row?.available).toBe('45');
    });
  });
});
