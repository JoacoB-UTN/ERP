import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { InventoryService } from '../src/inventory/inventory.service';
import type { RequestContext } from '../src/company-context/types';

interface ErrorEnvelope {
  error: { code: string; message: string };
}
interface TransferBody {
  id: string;
  number: string;
  status: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  lines: { id: string; productVariantId: string; quantity: string }[];
}

/**
 * Stock transfers between warehouses — see docs/inventory.md.
 *
 * Self-contained fixtures, never the dev seed. The assertions that matter
 * most here are the ledger ones: a confirmation must write both halves or
 * neither, and a cancellation must ADD compensating movements rather than
 * touch what was already written.
 */
describe('Stock transfers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;

  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let warehouseSourceId: string;
  let warehouseDestId: string;
  let warehouseOtherCompanyId: string;
  let variantId: string;
  let variantSecondId: string;
  let variantServiceId: string;

  let userAdminId: string;
  let userReadOnlyId: string;
  let userNoConfirmId: string;
  let userNoCancelId: string;
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
        name: `E2E Transfers Tenant ${suffix}`,
        slug: `e2e-transfers-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Transfers Company A',
        taxId: `e2e-transfers-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Transfers Company B',
        taxId: `e2e-transfers-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

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

    async function makeVariant(
      code: string,
      trackInventory = true,
      companyId = companyAId,
    ) {
      const product = await prisma.product.create({
        data: {
          tenantId,
          companyId,
          code: `${code}-${suffix}`,
          name: code,
          baseUnitId: unit.id,
          trackInventory,
          allowNegativeStock: false,
          productType: trackInventory ? 'PRODUCT' : 'SERVICE',
        },
      });
      const variant = await prisma.productVariant.create({
        data: { productId: product.id, name: null },
      });
      return variant.id;
    }
    variantId = await makeVariant('TRF');
    variantSecondId = await makeVariant('TRF2');
    variantServiceId = await makeVariant('TRFSVC', false);

    async function makeWarehouse(code: string, companyId: string) {
      const w = await prisma.warehouse.create({
        data: {
          tenantId,
          companyId,
          code: `${code}-${suffix}`,
          name: code,
          allowNegativeStock: false,
        },
      });
      return w.id;
    }
    warehouseSourceId = await makeWarehouse('SRC', companyAId);
    warehouseDestId = await makeWarehouse('DST', companyAId);
    warehouseOtherCompanyId = await makeWarehouse('OTHER', companyBId);

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'inventory', resource, action },
      });
    }
    const permRead = await makePermission('inventory.transfers.read');
    const permCreate = await makePermission('inventory.transfers.create');
    const permConfirm = await makePermission('inventory.transfers.confirm');
    const permCancel = await makePermission('inventory.transfers.cancel');
    const permStockRead = await makePermission('inventory.stock.read');
    const permMovementsRead = await makePermission(
      'inventory.movements.read',
    );

    async function makeRole(
      companyId: string,
      name: string,
      permissionIds: string[],
    ) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name: `${name} ${suffix}` },
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
    const allIds = [
      permRead.id,
      permCreate.id,
      permConfirm.id,
      permCancel.id,
      permStockRead.id,
      permMovementsRead.id,
    ];
    const roleFullA = await makeRole(companyAId, 'Transfers Full A', allIds);
    const roleFullB = await makeRole(companyBId, 'Transfers Full B', allIds);
    const roleReadOnly = await makeRole(companyAId, 'Transfers ReadOnly', [
      permRead.id,
      permStockRead.id,
    ]);
    const roleNoConfirm = await makeRole(companyAId, 'Transfers NoConfirm', [
      permRead.id,
      permCreate.id,
      permCancel.id,
    ]);
    const roleNoCancel = await makeRole(companyAId, 'Transfers NoCancel', [
      permRead.id,
      permCreate.id,
      permConfirm.id,
    ]);
    const roleNoAccess = await makeRole(companyAId, 'Transfers NoAccess', []);

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-transfers-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const admin = await makeUser('Admin');
    const readOnly = await makeUser('ReadOnly');
    const noConfirm = await makeUser('NoConfirm');
    const noCancel = await makeUser('NoCancel');
    const noAccess = await makeUser('NoAccess');
    userAdminId = admin.id;
    userReadOnlyId = readOnly.id;
    userNoConfirmId = noConfirm.id;
    userNoCancelId = noCancel.id;
    userNoAccessId = noAccess.id;

    for (const userId of userIds) {
      await prisma.userCompany.create({
        data: { userId, tenantId, companyId: companyAId, active: true },
      });
    }
    await prisma.userCompany.create({
      data: { userId: userAdminId, tenantId, companyId: companyBId, active: true },
    });

    async function assign(userId: string, roleId: string, companyId: string) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assign(userAdminId, roleFullA.id, companyAId);
    await assign(userAdminId, roleFullB.id, companyBId);
    await assign(userReadOnlyId, roleReadOnly.id, companyAId);
    await assign(userNoConfirmId, roleNoConfirm.id, companyAId);
    await assign(userNoCancelId, roleNoCancel.id, companyAId);
    await assign(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    const companies = { in: [companyAId, companyBId] };
    await prisma.auditLog.deleteMany({ where: { companyId: companies } });
    await prisma.stockTransferLine.deleteMany({
      where: { stockTransfer: { companyId: companies } },
    });
    await prisma.stockTransfer.deleteMany({ where: { companyId: companies } });
    await prisma.stockTransferSequence.deleteMany({
      where: { companyId: companies },
    });
    await prisma.stockMovement.deleteMany({ where: { companyId: companies } });
    await prisma.inventoryBalance.deleteMany({
      where: { companyId: companies },
    });
    await prisma.warehouse.deleteMany({ where: { companyId: companies } });
    await prisma.productVariant.deleteMany({
      where: { product: { companyId: companies } },
    });
    await prisma.product.deleteMany({ where: { companyId: companies } });
    await prisma.unitOfMeasure.deleteMany({ where: { companyId: companies } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: companies } },
    });
    await prisma.role.deleteMany({ where: { companyId: companies } });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: companies } });
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

  function ctxA(): RequestContext {
    return {
      userId: userAdminId,
      companyId: companyAId,
      tenantId,
      branchId: null,
    } as RequestContext;
  }

  /**
   * Leaves the on-hand of `variant` in `warehouseId` at exactly `quantity`,
   * without going through the transfer flow.
   *
   * Adjusts by difference rather than calling `createInitialBalance`: these
   * tests share one product and one pair of warehouses, so after the first
   * movement an initial balance is no longer applicable and the service
   * rightly rejects it. The seed movements carry their own `referenceType`,
   * so the ledger assertions — all scoped to `StockTransfer` — never see them.
   */
  async function seedStock(
    warehouseId: string,
    quantity: string,
    variant = variantId,
  ) {
    const current = new Prisma.Decimal(await onHand(warehouseId, variant));
    const delta = new Prisma.Decimal(quantity).minus(current);
    if (delta.isZero()) return;
    const warehouse = await prisma.warehouse.findUniqueOrThrow({
      where: { id: warehouseId },
    });
    await prisma.$transaction((tx) =>
      inventoryService.applyAdjustmentLine(tx, ctxA(), {
        warehouse,
        productVariantId: variant,
        quantityDelta: delta.toString(),
        reason: 'Preparación del test',
        referenceType: 'TestSeed',
        referenceId: randomUUID(),
        occurredAt: new Date(),
      }),
    );
  }

  async function onHand(warehouseId: string, variant = variantId) {
    const balance = await prisma.inventoryBalance.findUnique({
      where: {
        companyId_warehouseId_productVariantId: {
          companyId: companyAId,
          warehouseId,
          productVariantId: variant,
        },
      },
    });
    return balance ? balance.onHand.toString() : '0';
  }

  async function createDraft(
    body: Record<string, unknown> = {},
  ): Promise<TransferBody> {
    const agent = await loginAs(userAdminId);
    const res = await agent
      .post('/api/v1/inventory/transfers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        sourceWarehouseId: warehouseSourceId,
        destinationWarehouseId: warehouseDestId,
        reason: 'Reposición de salón',
        lines: [{ productVariantId: variantId, quantity: '5' }],
        ...body,
      });
    expect(res.status).toBe(201);
    return (res.body as { transfer: TransferBody }).transfer;
  }

  // ---------- creation and editing ----------

  describe('creation and editing', () => {
    it('creates a draft that moves no stock', async () => {
      await seedStock(warehouseSourceId, '100');
      const before = await onHand(warehouseSourceId);

      const transfer = await createDraft();

      expect(transfer.status).toBe('DRAFT');
      expect(transfer.number).toMatch(/^TR-\d{6}$/);
      expect(transfer.lines).toHaveLength(1);
      expect(await onHand(warehouseSourceId)).toBe(before);
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(0);
    });

    it('rejects a transfer to the same warehouse', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceWarehouseId: warehouseSourceId,
          destinationWarehouseId: warehouseSourceId,
          lines: [{ productVariantId: variantId, quantity: '1' }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects a non-positive quantity', async () => {
      const agent = await loginAs(userAdminId);
      for (const quantity of ['0', '-3']) {
        const res = await agent
          .post('/api/v1/inventory/transfers')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            sourceWarehouseId: warehouseSourceId,
            destinationWarehouseId: warehouseDestId,
            lines: [{ productVariantId: variantId, quantity }],
          });
        expect(res.status).toBe(400);
      }
    });

    it('rejects a product that does not track inventory', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceWarehouseId: warehouseSourceId,
          destinationWarehouseId: warehouseDestId,
          lines: [{ productVariantId: variantServiceId, quantity: '1' }],
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_DOES_NOT_TRACK_INVENTORY',
      );
    });

    it('edits a draft: lines are replaced, not appended', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .patch(`/api/v1/inventory/transfers/${transfer.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          reason: 'Motivo corregido',
          lines: [
            { productVariantId: variantId, quantity: '2' },
            { productVariantId: variantSecondId, quantity: '7' },
          ],
        });
      expect(res.status).toBe(200);
      const updated = (res.body as { transfer: TransferBody }).transfer;
      expect(updated.lines).toHaveLength(2);
      expect(
        updated.lines.find((l) => l.productVariantId === variantId)?.quantity,
      ).toBe('2');
    });

    it('sums duplicate lines for the same variant', async () => {
      const transfer = await createDraft({
        lines: [
          { productVariantId: variantId, quantity: '3' },
          { productVariantId: variantId, quantity: '4' },
        ],
      });
      expect(transfer.lines).toHaveLength(1);
      expect(transfer.lines[0].quantity).toBe('7');
    });

    it('refuses to edit a confirmed transfer', async () => {
      await seedStock(warehouseSourceId, '50');
      const transfer = await createDraft();
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const res = await agent
        .patch(`/api/v1/inventory/transfers/${transfer.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ reason: 'ya no' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'STOCK_TRANSFER_NOT_DRAFT',
      );
    });
  });

  // ---------- confirmation ----------

  describe('confirmation', () => {
    it('moves stock out of the source and into the destination', async () => {
      await seedStock(warehouseSourceId, '30');
      const sourceBefore = Number(await onHand(warehouseSourceId));
      const destBefore = Number(await onHand(warehouseDestId));

      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '10' }],
      });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      expect((res.body as { transfer: TransferBody }).transfer.status).toBe(
        'CONFIRMED',
      );

      expect(Number(await onHand(warehouseSourceId))).toBe(sourceBefore - 10);
      expect(Number(await onHand(warehouseDestId))).toBe(destBefore + 10);

      const movements = await prisma.stockMovement.findMany({
        where: { referenceType: 'StockTransfer', referenceId: transfer.id },
      });
      expect(movements).toHaveLength(2);
      const out = movements.find((m) => m.movementType === 'TRANSFER_OUT')!;
      const inbound = movements.find((m) => m.movementType === 'TRANSFER_IN')!;
      expect(out.warehouseId).toBe(warehouseSourceId);
      expect(out.quantity.toString()).toBe('-10');
      expect(inbound.warehouseId).toBe(warehouseDestId);
      expect(inbound.quantity.toString()).toBe('10');
      // The two halves are equal and opposite: the company holds the same
      // total before and after.
      expect(Number(out.quantity) + Number(inbound.quantity)).toBe(0);
    });

    it('records an audit entry naming both warehouses', async () => {
      await seedStock(warehouseSourceId, '10');
      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '1' }],
      });
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const entry = await prisma.auditLog.findFirst({
        where: {
          entityType: 'StockTransfer',
          entityId: transfer.id,
          action: 'CONFIRM',
        },
      });
      expect(entry).not.toBeNull();
      const metadata = entry!.metadata as Record<string, unknown>;
      expect(metadata.number).toBe(transfer.number);
      expect(metadata.sourceWarehouse).toBeDefined();
      expect(metadata.destinationWarehouse).toBeDefined();
    });

    it('rejects a duplicate confirmation', async () => {
      await seedStock(warehouseSourceId, '10');
      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '2' }],
      });
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const second = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(second.status).toBe(409);

      // And crucially: no second pair of movements.
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(2);
    });

    it('rolls back completely when the source has insufficient stock', async () => {
      const sourceBefore = Number(await onHand(warehouseSourceId));
      const destBefore = Number(await onHand(warehouseDestId));

      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '999999' }],
      });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe('INSUFFICIENT_STOCK');

      // Nothing moved, on EITHER side — the destination must not be left
      // credited by a half-applied transfer.
      expect(Number(await onHand(warehouseSourceId))).toBe(sourceBefore);
      expect(Number(await onHand(warehouseDestId))).toBe(destBefore);
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(0);
      // And the status stayed DRAFT despite the guard having matched.
      const row = await prisma.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      expect(row.status).toBe('DRAFT');
    });
  });

  // ---------- cancellation / compensating movements ----------

  describe('cancellation', () => {
    it('cancels a draft without touching the ledger', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      expect((res.body as { transfer: TransferBody }).transfer.status).toBe(
        'CANCELLED',
      );
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(0);
    });

    it('compensates a confirmed transfer instead of editing its movements', async () => {
      await seedStock(warehouseSourceId, '40');
      const sourceBefore = Number(await onHand(warehouseSourceId));
      const destBefore = Number(await onHand(warehouseDestId));

      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '6' }],
      });
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const afterConfirm = await prisma.stockMovement.findMany({
        where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        orderBy: { createdAt: 'asc' },
      });
      const originalIds = afterConfirm.map((m) => m.id);

      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const all = await prisma.stockMovement.findMany({
        where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        orderBy: { createdAt: 'asc' },
      });
      // Four movements now: the original pair plus a compensating pair.
      expect(all).toHaveLength(4);
      // The originals are still there, byte for byte.
      for (const original of afterConfirm) {
        const still = all.find((m) => m.id === original.id)!;
        expect(still.quantity.toString()).toBe(original.quantity.toString());
        expect(still.movementType).toBe(original.movementType);
        expect(still.warehouseId).toBe(original.warehouseId);
      }
      const compensating = all.filter((m) => !originalIds.includes(m.id));
      expect(compensating).toHaveLength(2);
      // The compensation runs the other way: out of the destination, back
      // into the source.
      const compOut = compensating.find(
        (m) => m.movementType === 'TRANSFER_OUT',
      )!;
      const compIn = compensating.find((m) => m.movementType === 'TRANSFER_IN')!;
      expect(compOut.warehouseId).toBe(warehouseDestId);
      expect(compIn.warehouseId).toBe(warehouseSourceId);

      // Net effect on both balances is zero.
      expect(Number(await onHand(warehouseSourceId))).toBe(sourceBefore);
      expect(Number(await onHand(warehouseDestId))).toBe(destBefore);
    });

    it('rejects a duplicate cancellation and writes no extra movements', async () => {
      await seedStock(warehouseSourceId, '10');
      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '3' }],
      });
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const second = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(second.status).toBe(409);
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(4);
    });

    it('refuses to confirm a cancelled transfer', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);
      const res = await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
    });
  });

  // ---------- concurrency ----------

  describe('concurrency', () => {
    it('two transfers racing for the same stock: exactly one succeeds', async () => {
      // A source holding 10, and two transfers of 7 each. Both can pass a
      // read-time check; only one can pass the balance check that runs
      // inside the transaction.
      const raceWarehouse = await prisma.warehouse.create({
        data: {
          tenantId,
          companyId: companyAId,
          code: `RACE-${suffix}`,
          name: 'Race source',
          allowNegativeStock: false,
        },
      });
      await seedStock(raceWarehouse.id, '10');

      const agent = await loginAs(userAdminId);
      const drafts = await Promise.all([
        createDraft({
          sourceWarehouseId: raceWarehouse.id,
          lines: [{ productVariantId: variantId, quantity: '7' }],
        }),
        createDraft({
          sourceWarehouseId: raceWarehouse.id,
          lines: [{ productVariantId: variantId, quantity: '7' }],
        }),
      ]);

      const results = await Promise.all(
        drafts.map((d) =>
          agent
            .post(`/api/v1/inventory/transfers/${d.id}/confirm`)
            .set(COMPANY_ID_HEADER, companyAId),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 409]);

      // The source went 10 -> 3 exactly once; it never went negative.
      expect(Number(await onHand(raceWarehouse.id))).toBe(3);
    });

    it('two confirmations of the SAME transfer: exactly one writes movements', async () => {
      await seedStock(warehouseSourceId, '20');
      const transfer = await createDraft({
        lines: [{ productVariantId: variantId, quantity: '2' }],
      });
      const agent = await loginAs(userAdminId);

      const results = await Promise.all([
        agent
          .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        agent
          .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.stockMovement.count({
          where: { referenceType: 'StockTransfer', referenceId: transfer.id },
        }),
      ).toBe(2);
    });
  });

  // ---------- company isolation ----------

  describe('company isolation', () => {
    it('rejects a destination warehouse from another company', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceWarehouseId: warehouseSourceId,
          destinationWarehouseId: warehouseOtherCompanyId,
          lines: [{ productVariantId: variantId, quantity: '1' }],
        });
      // "Not found", never "not yours" — see CLAUDE.md.
      expect(res.status).toBe(404);
    });

    it('does not expose a transfer scoped to another company', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/inventory/transfers/${transfer.id}`)
        .set(COMPANY_ID_HEADER, companyBId);
      expect(res.status).toBe(404);
    });

    it('does not list another company transfers', async () => {
      await createDraft();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyBId);
      expect(res.status).toBe(200);
      expect((res.body as { items: unknown[] }).items).toHaveLength(0);
    });
  });

  // ---------- permissions ----------

  describe('permission enforcement', () => {
    it('403s a user with no transfer permissions', async () => {
      const agent = await loginAs(userNoAccessId);
      await agent
        .get('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(403);
    });

    it('a read-only user can list but not create', async () => {
      const agent = await loginAs(userReadOnlyId);
      await agent
        .get('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);
      await agent
        .post('/api/v1/inventory/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceWarehouseId: warehouseSourceId,
          destinationWarehouseId: warehouseDestId,
          lines: [{ productVariantId: variantId, quantity: '1' }],
        })
        .expect(403);
    });

    it('403s confirm without inventory.transfers.confirm', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userNoConfirmId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(403);
    });

    it('403s cancel without inventory.transfers.cancel', async () => {
      const transfer = await createDraft();
      const agent = await loginAs(userNoCancelId);
      await agent
        .post(`/api/v1/inventory/transfers/${transfer.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(403);
    });
  });
});
