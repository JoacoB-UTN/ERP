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
import { RealtimePublisher } from '../src/realtime/realtime.publisher';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface SupplierBody {
  id: string;
  code: string;
  legalName: string;
  status: string;
}
interface PurchaseOrderLineBody {
  id: string;
  productVariantId: string;
  quantity: string;
  unitCost: string;
  lineTotal: string;
  receivedQuantity: string;
  pendingQuantity: string;
}
interface PurchaseOrderBody {
  id: string;
  number: string;
  status: string;
  total: string;
  currencyCode: string;
  lines: PurchaseOrderLineBody[];
  receipts: { id: string; number: string; status: string }[];
}
interface PurchaseReceiptLineBody {
  id: string;
  productVariantId: string;
  quantity: string;
  unitCostSnapshot: string;
  purchaseOrderLineId: string | null;
}
interface PurchaseReceiptBody {
  id: string;
  number: string;
  status: string;
  lines: PurchaseReceiptLineBody[];
}

/**
 * Suppliers + Purchase Orders + Goods Receipts — see docs/purchases.md and
 * Prompt #21. Self-contained fixtures, not the dev seed — same pattern as
 * every other e2e spec in this suite. Mixes supertest (HTTP contract,
 * permissions, company isolation) with direct `app.get(InventoryService)`
 * calls to inspect the resulting ledger, same as sales.e2e-spec.ts.
 */
describe('Purchases: Suppliers, Purchase Orders, Goods Receipts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  let realtimePublisher: RealtimePublisher;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let branchAId: string; // company A
  let branchBId: string; // company B

  let arsId: string;
  let usdId: string;

  let unitId: string;

  let variantAId: string; // company A, trackInventory=true, baseUnit decimalPlaces=0
  let variantBId: string; // company B

  let warehouseId: string; // ACTIVE, allowsPurchases=true, company A
  let warehouseNoPurchasesId: string; // ACTIVE, allowsPurchases=false

  let supplierId: string; // ACTIVE, company A
  let supplierInactiveId: string; // INACTIVE, company A
  let supplierBId: string; // company B

  let userAdminId: string; // full perms, member of A AND B
  let userNoOrderApproveId: string;
  let userNoReceiptConfirmId: string;
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
    realtimePublisher = app.get(RealtimePublisher);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Purchases Tenant ${suffix}`,
        slug: `e2e-purchases-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Purchases Company A',
        taxId: `e2e-purch-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Purchases Company B',
        taxId: `e2e-purch-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const branchA = await prisma.branch.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `BR-A-${suffix}`,
        name: 'Branch A',
      },
    });
    branchAId = branchA.id;
    const branchB = await prisma.branch.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `BR-B-${suffix}`,
        name: 'Branch B',
      },
    });
    branchBId = branchB.id;

    const ars = await prisma.currency.upsert({
      where: { code: 'ARS' },
      update: {},
      create: {
        code: 'ARS',
        name: 'Peso argentino',
        symbol: '$',
        decimalPlaces: 2,
      },
    });
    arsId = ars.id;
    const usd = await prisma.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: {
        code: 'USD',
        name: 'Dólar estadounidense',
        symbol: 'US$',
        decimalPlaces: 2,
      },
    });
    usdId = usd.id;

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

    const productA = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `PPROD-A-${suffix}`,
        name: 'Purchases Product A',
        baseUnitId: unitId,
        trackInventory: true,
      },
    });
    const variantA = await prisma.productVariant.create({
      data: { productId: productA.id, name: null },
    });
    variantAId = variantA.id;

    const productB = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `PPROD-B-${suffix}`,
        name: 'Purchases Product B',
        baseUnitId: unitB.id,
        trackInventory: true,
      },
    });
    const variantB = await prisma.productVariant.create({
      data: { productId: productB.id, name: null },
    });
    variantBId = variantB.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `PWH-A-${suffix}`,
        name: 'Purchases Warehouse A',
        allowsPurchases: true,
      },
    });
    warehouseId = warehouse.id;
    const warehouseNoPurchases = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `PWH-NOPUR-${suffix}`,
        name: 'Purchases Warehouse No-Purchases',
        allowsPurchases: false,
      },
    });
    warehouseNoPurchasesId = warehouseNoPurchases.id;

    const supplier = await prisma.supplier.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `PSUP-A-${suffix}`,
        legalName: 'Purchases Supplier A',
        status: 'ACTIVE',
      },
    });
    supplierId = supplier.id;
    const supplierInactive = await prisma.supplier.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `PSUP-INACT-${suffix}`,
        legalName: 'Purchases Supplier Inactive',
        status: 'INACTIVE',
      },
    });
    supplierInactiveId = supplierInactive.id;
    const supplierB = await prisma.supplier.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: `PSUP-B-${suffix}`,
        legalName: 'Purchases Supplier B',
        status: 'ACTIVE',
      },
    });
    supplierBId = supplierB.id;

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'purchases', resource, action },
      });
    }
    const allCodes = [
      'purchases.suppliers.read',
      'purchases.suppliers.create',
      'purchases.suppliers.update',
      'purchases.suppliers.deactivate',
      'purchases.orders.read',
      'purchases.orders.create',
      'purchases.orders.update',
      'purchases.orders.approve',
      'purchases.orders.cancel',
      'purchases.goods-receipts.read',
      'purchases.goods-receipts.create',
      'purchases.goods-receipts.confirm',
      'purchases.goods-receipts.cancel',
    ];
    const permByCode = new Map<string, string>();
    for (const code of allCodes) {
      permByCode.set(code, (await makePermission(code)).id);
    }

    async function makeRole(companyId: string, name: string, codes: string[]) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name },
      });
      const permissionIds = codes.map((c) => permByCode.get(c)!);
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
      'Purchases E2E Full A',
      allCodes,
    );
    const roleFullB = await makeRole(
      companyBId,
      'Purchases E2E Full B',
      allCodes,
    );
    const roleNoOrderApprove = await makeRole(
      companyAId,
      'Purchases E2E No Order Approve',
      allCodes.filter((c) => c !== 'purchases.orders.approve'),
    );
    const roleNoReceiptConfirm = await makeRole(
      companyAId,
      'Purchases E2E No Receipt Confirm',
      allCodes.filter((c) => c !== 'purchases.goods-receipts.confirm'),
    );
    const roleNoAccess = await makeRole(
      companyAId,
      'Purchases E2E No Access',
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
          email: `e2e-purchases-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userAdmin = await makeUser('Admin');
    const userNoOrderApprove = await makeUser('NoOrderApprove');
    const userNoReceiptConfirm = await makeUser('NoReceiptConfirm');
    const userNoAccess = await makeUser('NoAccess');
    userAdminId = userAdmin.id;
    userNoOrderApproveId = userNoOrderApprove.id;
    userNoReceiptConfirmId = userNoReceiptConfirm.id;
    userNoAccessId = userNoAccess.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userAdminId, companyBId);
    await membership(userNoOrderApproveId, companyAId);
    await membership(userNoReceiptConfirmId, companyAId);
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
    await assignRole(userNoOrderApproveId, roleNoOrderApprove.id, companyAId);
    await assignRole(
      userNoReceiptConfirmId,
      roleNoReceiptConfirm.id,
      companyAId,
    );
    await assignRole(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.purchaseReceiptLine.deleteMany({
      where: {
        purchaseReceipt: { companyId: { in: [companyAId, companyBId] } },
      },
    });
    await prisma.purchaseReceipt.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.purchaseReceiptSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrder: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.purchaseOrder.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.purchaseOrderSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.stockMovement.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.inventoryBalance.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.supplier.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.supplierCodeSequence.deleteMany({
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
    await prisma.branch.deleteMany({
      where: { id: { in: [branchAId, branchBId] } },
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

  async function freshVariant(label: string) {
    const productA = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantAId },
      include: { product: true },
    });
    const v = await prisma.productVariant.create({
      data: {
        productId: productA.productId,
        name: `${label}-${suffix}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return v.id;
  }

  // -----------------------------------------------------------------------
  // Suppliers
  // -----------------------------------------------------------------------
  describe('Suppliers', () => {
    it('creates a supplier with an auto-generated code and an audit record, ignoring a spoofed companyId', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/suppliers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          legalName: `New Supplier ${suffix}`,
          companyId: companyBId,
          taxCondition: 'RESPONSABLE_INSCRIPTO',
        });
      expect(res.status).toBe(201);
      const supplier = (res.body as { supplier: SupplierBody }).supplier;
      expect(supplier.code).toMatch(/^\d{6}$/);

      const row = await prisma.supplier.findUniqueOrThrow({
        where: { id: supplier.id },
      });
      expect(row.companyId).toBe(companyAId);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          entityType: 'Supplier',
          entityId: supplier.id,
          action: 'CREATE',
        },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('rejects a duplicate ACTIVE taxId but allows it after the original is deactivated', async () => {
      const agent = await loginAs(userAdminId);
      // DNI (not CUIT/CUIL) so no checksum validation applies — see
      // packages/shared/src/tax-id.ts's validateTaxIdForDocumentType.
      const taxId = `${suffix}`.slice(-8);
      const first = await agent
        .post('/api/v1/suppliers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Tax Id Owner', documentType: 'DNI', taxId });
      expect(first.status).toBe(201);
      const firstId = (first.body as { supplier: SupplierBody }).supplier.id;

      const duplicate = await agent
        .post('/api/v1/suppliers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Tax Id Duplicate', documentType: 'DNI', taxId });
      expect(duplicate.status).toBe(409);
      expect((duplicate.body as ErrorEnvelope).error.code).toBe(
        'SUPPLIER_TAX_ID_ALREADY_EXISTS',
      );

      await agent
        .post(`/api/v1/suppliers/${firstId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      const afterDeactivate = await agent
        .post('/api/v1/suppliers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Tax Id Reused', documentType: 'DNI', taxId });
      expect(afterDeactivate.status).toBe(201);
    });

    it('never exposes a company B supplier to a company A request', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/suppliers/${supplierBId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('403s a user with no purchases permissions', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/suppliers')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    // -----------------------------------------------------------------------
    // Effective documentType/taxId validation on update() — a PATCH only
    // carries the fields it actually sends, so the shared Zod schema's own
    // superRefine (which only sees the PATCH body) can't catch an update
    // that leaves an EFFECTIVE (existing + patched) documentType/taxId pair
    // invalid. See SuppliersService.update() and docs/purchases.md.
    // -----------------------------------------------------------------------
    describe('effective documentType/taxId validation on update', () => {
      it('rejects PATCH taxId alone on an existing CUIT supplier when the new taxId fails the checksum', async () => {
        const agent = await loginAs(userAdminId);
        const created = await agent
          .post('/api/v1/suppliers')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            legalName: 'Effective Tax Id A',
            documentType: 'CUIT',
            taxId: '30711223440', // valid checksum
          });
        expect(created.status).toBe(201);
        const supplierIdUnderTest = (created.body as { supplier: SupplierBody })
          .supplier.id;

        // Only `taxId` is sent — `documentType` is NOT resent, so a schema
        // that only looks at the PATCH body (not the persisted CUIT
        // documentType) would skip checksum validation entirely.
        const res = await agent
          .patch(`/api/v1/suppliers/${supplierIdUnderTest}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ taxId: '30713344223' }); // fails the mod-11 checksum
        expect(res.status).toBe(400);
        expect((res.body as ErrorEnvelope).error.code).toBe(
          'SUPPLIER_INVALID_TAX_ID',
        );

        // The supplier's original, valid taxId must be untouched.
        const unchanged = await agent
          .get(`/api/v1/suppliers/${supplierIdUnderTest}`)
          .set(COMPANY_ID_HEADER, companyAId);
        expect(
          (unchanged.body as { supplier: SupplierBody & { taxId: string } })
            .supplier.taxId,
        ).toBe('30711223440');
      });

      it('rejects PATCH documentType alone to CUIT when the existing taxId is incompatible', async () => {
        const agent = await loginAs(userAdminId);
        const created = await agent
          .post('/api/v1/suppliers')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            legalName: 'Effective Tax Id B',
            documentType: 'DNI',
            taxId: '12345678', // valid as a DNI (no checksum), invalid as a CUIT
          });
        expect(created.status).toBe(201);
        const supplierIdUnderTest = (created.body as { supplier: SupplierBody })
          .supplier.id;

        const res = await agent
          .patch(`/api/v1/suppliers/${supplierIdUnderTest}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ documentType: 'CUIT' }); // taxId not resent
        expect(res.status).toBe(400);
        expect((res.body as ErrorEnvelope).error.code).toBe(
          'SUPPLIER_INVALID_TAX_ID',
        );
      });

      it('accepts a valid effective CUIT update (documentType and taxId changed together)', async () => {
        const agent = await loginAs(userAdminId);
        const created = await agent
          .post('/api/v1/suppliers')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            legalName: 'Effective Tax Id C',
            documentType: 'DNI',
            taxId: '87654321',
          });
        expect(created.status).toBe(201);
        const supplierIdUnderTest = (created.body as { supplier: SupplierBody })
          .supplier.id;

        const res = await agent
          .patch(`/api/v1/suppliers/${supplierIdUnderTest}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ documentType: 'CUIT', taxId: '30722334457' }); // valid, distinct from other tests' CUITs
        expect(res.status).toBe(200);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Purchase Orders — state machine, no stock effect, currency handling
  // -----------------------------------------------------------------------
  describe('Purchase Orders', () => {
    async function draftOrder(
      a: request.Agent,
      overrides: Record<string, unknown> = {},
    ) {
      const res = await a
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          lines: [
            { productVariantId: variantAId, quantity: '10', unitCost: '100' },
          ],
          ...overrides,
        });
      return res;
    }

    it('creates a DRAFT order with a server-computed total, ignoring a client-supplied total', async () => {
      const agent = await loginAs(userAdminId);
      const res = await draftOrder(agent, { total: '999999' });
      expect(res.status).toBe(201);
      const order = (res.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder;
      expect(order.status).toBe('DRAFT');
      expect(order.total).toBe('1000'); // 10 * 100, server-computed — never the spoofed 999999
      expect(order.number).toMatch(/^OC-\d{6}$/);
    });

    it('supports ARS and USD as document currencies', async () => {
      const agent = await loginAs(userAdminId);
      const usdRes = await draftOrder(agent, { currencyId: usdId });
      expect(usdRes.status).toBe(201);
      expect(
        (usdRes.body as { purchaseOrder: PurchaseOrderBody }).purchaseOrder
          .currencyCode,
      ).toBe('USD');
    });

    it('rejects an unknown currencyId', async () => {
      const agent = await loginAs(userAdminId);
      const res = await draftOrder(agent, {
        currencyId: '00000000-0000-0000-0000-000000000000',
      });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('CURRENCY_NOT_FOUND');
    });

    it('rejects an inactive supplier', async () => {
      const agent = await loginAs(userAdminId);
      const res = await draftOrder(agent, { supplierId: supplierInactiveId });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_SUPPLIER_INACTIVE',
      );
    });

    it('rejects a company B supplierId on create', async () => {
      const agent = await loginAs(userAdminId);
      const res = await draftOrder(agent, { supplierId: supplierBId });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('rejects a company B productVariantId on create', async () => {
      const agent = await loginAs(userAdminId);
      const res = await draftOrder(agent, {
        lines: [
          { productVariantId: variantBId, quantity: '1', unitCost: '10' },
        ],
      });
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    });

    it('CONFIRMING a purchase order does NOT change stock', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('po-no-stock');
      const balanceBefore = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );

      const created = await draftOrder(agent, {
        lines: [{ productVariantId: variant, quantity: '10', unitCost: '100' }],
      });
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const confirmSpy = jest.spyOn(realtimePublisher, 'stockChanged');
      const confirmed = await agent
        .post(`/api/v1/purchase-orders/${orderId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmed.status).toBe(200);
      expect(
        (confirmed.body as { purchaseOrder: PurchaseOrderBody }).purchaseOrder
          .status,
      ).toBe('CONFIRMED');

      const balanceAfter = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();

      const movementCount = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseOrder',
          referenceId: orderId,
        },
      });
      expect(movementCount).toBe(0);

      const auditRows = await prisma.auditLog.findMany({
        where: {
          entityType: 'PurchaseOrder',
          entityId: orderId,
          action: 'CONFIRM',
        },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('a CONFIRMED order is terminal — cancel is rejected', async () => {
      const agent = await loginAs(userAdminId);
      const created = await draftOrder(agent);
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;
      await agent
        .post(`/api/v1/purchase-orders/${orderId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);

      const cancelRes = await agent
        .post(`/api/v1/purchase-orders/${orderId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelRes.status).toBe(409);
      expect((cancelRes.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_NOT_EDITABLE',
      );

      const reconfirmRes = await agent
        .post(`/api/v1/purchase-orders/${orderId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(reconfirmRes.status).toBe(409);
      expect((reconfirmRes.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_ALREADY_CONFIRMED',
      );
    });

    it('DRAFT -> CANCELLED has no stock effect and is also terminal', async () => {
      const agent = await loginAs(userAdminId);
      const created = await draftOrder(agent);
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const cancelRes = await agent
        .post(`/api/v1/purchase-orders/${orderId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelRes.status).toBe(200);
      expect(
        (cancelRes.body as { purchaseOrder: PurchaseOrderBody }).purchaseOrder
          .status,
      ).toBe('CANCELLED');

      const confirmRes = await agent
        .post(`/api/v1/purchase-orders/${orderId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmRes.status).toBe(409);
      expect((confirmRes.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_NOT_EDITABLE',
      );
    });

    it('403s confirm for a user missing purchases.orders.approve specifically, while still allowing read/create', async () => {
      const adminAgent = await loginAs(userAdminId);
      const created = await draftOrder(adminAgent);
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const agent = await loginAs(userNoOrderApproveId);
      const listRes = await agent
        .get('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(listRes.status).toBe(200);

      const confirmRes = await agent
        .post(`/api/v1/purchase-orders/${orderId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmRes.status).toBe(403);
    });

    it('never exposes a company B order to a company A request', async () => {
      const agentB = await loginAs(userAdminId);
      const createdB = await agentB
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyBId)
        .send({
          supplierId: supplierBId,
          currencyId: arsId,
          lines: [
            { productVariantId: variantBId, quantity: '1', unitCost: '10' },
          ],
        });
      expect(createdB.status).toBe(201);
      const orderBId = (createdB.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const res = await agentB
        .get(`/api/v1/purchase-orders/${orderBId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(404);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_NOT_FOUND',
      );
    });

    // -----------------------------------------------------------------------
    // branchId cross-company isolation — a branchId is a raw UUID supplied
    // by the client; the FK to `branches` alone doesn't prove it belongs to
    // the caller's company. See PurchaseOrdersService.assertBranchBelongsToCompany
    // and docs/purchases.md.
    // -----------------------------------------------------------------------
    describe('branchId company isolation', () => {
      it('rejects a company B branchId on create', async () => {
        const agent = await loginAs(userAdminId);
        const res = await draftOrder(agent, { branchId: branchBId });
        expect(res.status).toBe(400);
        expect((res.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_ORDER_INVALID_BRANCH',
        );
      });

      it('accepts a valid branch from the current company on create', async () => {
        const agent = await loginAs(userAdminId);
        const res = await draftOrder(agent, { branchId: branchAId });
        expect(res.status).toBe(201);
        expect(
          (res.body as { purchaseOrder: { branch: { id: string } | null } })
            .purchaseOrder.branch?.id,
        ).toBe(branchAId);
      });

      it('rejects a company B branchId on update', async () => {
        const agent = await loginAs(userAdminId);
        const created = await draftOrder(agent);
        const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
          .purchaseOrder.id;

        const res = await agent
          .patch(`/api/v1/purchase-orders/${orderId}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ branchId: branchBId });
        expect(res.status).toBe(400);
        expect((res.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_ORDER_INVALID_BRANCH',
        );
      });
    });
  });

  // -----------------------------------------------------------------------
  // Purchase Receipts — the only Purchases document that touches stock
  // -----------------------------------------------------------------------
  describe('Purchase Receipts', () => {
    it('CONFIRMING a receipt increases stock via a real PURCHASE StockMovement, and publishes realtime events only after commit', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('receipt-confirm');
      const balanceBefore = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );

      const created = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variant,
              quantity: '15',
              unitCostSnapshot: '200',
            },
          ],
        });
      expect(created.status).toBe(201);
      const receiptId = (
        created.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.id;

      const receiptSpy = jest.spyOn(
        realtimePublisher,
        'purchaseReceiptConfirmed',
      );
      const stockSpy = jest.spyOn(realtimePublisher, 'stockChanged');
      const confirmed = await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmed.status).toBe(200);
      expect(receiptSpy).toHaveBeenCalledWith(companyAId, receiptId);
      expect(stockSpy).toHaveBeenCalledWith(companyAId, warehouseId, variant);
      receiptSpy.mockRestore();
      stockSpy.mockRestore();

      expect(balanceBefore.onHand).toBe('0'); // a freshly created variant starts at zero
      const balanceAfter = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balanceAfter.onHand).toBe('15');

      const movement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseReceipt',
          referenceId: receiptId,
        },
      });
      expect(movement?.movementType).toBe('PURCHASE');
      expect(movement?.quantity.toString()).toBe('15');
      expect(movement?.unitCost?.toString()).toBe('200');

      const auditRows = await prisma.auditLog.findMany({
        where: {
          entityType: 'PurchaseReceipt',
          entityId: receiptId,
          action: 'CONFIRM',
        },
      });
      expect(auditRows).toHaveLength(1);
    });

    it('a DRAFT receipt has zero inventory effect', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('receipt-draft-no-effect');
      const balanceBefore = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );

      await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variant,
              quantity: '15',
              unitCostSnapshot: '200',
            },
          ],
        });

      const balanceAfter = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand);
    });

    it('CANCELLING a CONFIRMED receipt creates a compensating reversal and never deletes the original movement', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('receipt-cancel-reversal');
      const balanceBefore = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );

      const created = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variant,
              quantity: '8',
              unitCostSnapshot: '300',
            },
          ],
        });
      const receiptId = (
        created.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.id;
      await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);

      const cancelled = await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelled.status).toBe(200);
      expect(
        (cancelled.body as { purchaseReceipt: PurchaseReceiptBody })
          .purchaseReceipt.status,
      ).toBe('CANCELLED');

      const balanceAfter = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balanceAfter.onHand).toBe(balanceBefore.onHand); // net zero

      const movements = await prisma.stockMovement.findMany({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseReceipt',
          referenceId: receiptId,
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements).toHaveLength(2); // original PURCHASE + reversal, never edited/deleted
      expect(movements[0].movementType).toBe('PURCHASE');
      expect(movements[0].quantity.toString()).toBe('8');
      expect(movements[1].movementType).toBe('PURCHASE_RETURN');
      expect(movements[1].quantity.toString()).toBe('-8');

      // Cancelling again is idempotent, not a second reversal.
      const doubleCancel = await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(doubleCancel.status).toBe(409);
      expect((doubleCancel.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_ALREADY_CANCELLED',
      );
      const movementsAfterDoubleCancel = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseReceipt',
          referenceId: receiptId,
        },
      });
      expect(movementsAfterDoubleCancel).toBe(2);
    });

    it('DRAFT -> CANCELLED has zero inventory effect', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('receipt-draft-cancel');
      const created = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variant,
              quantity: '5',
              unitCostSnapshot: '100',
            },
          ],
        });
      const receiptId = (
        created.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.id;

      const cancelled = await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelled.status).toBe(200);

      const movementCount = await prisma.stockMovement.count({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseReceipt',
          referenceId: receiptId,
        },
      });
      expect(movementCount).toBe(0);
    });

    it('rejects a warehouse that does not allow purchases', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId: warehouseNoPurchasesId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variantAId,
              quantity: '1',
              unitCostSnapshot: '10',
            },
          ],
        });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_WAREHOUSE_INVALID',
      );
    });

    it('requires a currencyId for a direct receipt with no purchaseOrderId', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          lines: [
            {
              productVariantId: variantAId,
              quantity: '1',
              unitCostSnapshot: '10',
            },
          ],
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_CURRENCY_REQUIRED',
      );
    });

    it('403s confirm for a user missing purchases.goods-receipts.confirm specifically', async () => {
      const adminAgent = await loginAs(userAdminId);
      const variant = await freshVariant('receipt-perm');
      const created = await adminAgent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variant,
              quantity: '1',
              unitCostSnapshot: '10',
            },
          ],
        });
      const receiptId = (
        created.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.id;

      const agent = await loginAs(userNoReceiptConfirmId);
      const res = await agent
        .post(`/api/v1/purchase-receipts/${receiptId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
    });

    // -----------------------------------------------------------------------
    // branchId cross-company isolation — same reasoning as Purchase Orders'
    // own branchId isolation tests above.
    // -----------------------------------------------------------------------
    describe('branchId company isolation', () => {
      it('rejects a company B branchId on create', async () => {
        const agent = await loginAs(userAdminId);
        const variant = await freshVariant('receipt-branch-cross-company');
        const res = await agent
          .post('/api/v1/purchase-receipts')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            supplierId,
            warehouseId,
            currencyId: arsId,
            branchId: branchBId,
            lines: [
              {
                productVariantId: variant,
                quantity: '1',
                unitCostSnapshot: '10',
              },
            ],
          });
        expect(res.status).toBe(400);
        expect((res.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_RECEIPT_INVALID_BRANCH',
        );
      });

      it('accepts a valid branch from the current company on create', async () => {
        const agent = await loginAs(userAdminId);
        const variant = await freshVariant('receipt-branch-valid');
        const res = await agent
          .post('/api/v1/purchase-receipts')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            supplierId,
            warehouseId,
            currencyId: arsId,
            branchId: branchAId,
            lines: [
              {
                productVariantId: variant,
                quantity: '1',
                unitCostSnapshot: '10',
              },
            ],
          });
        expect(res.status).toBe(201);
      });
    });
  });

  // -----------------------------------------------------------------------
  // Partial receipts, over-receipt rejection, and concurrency — the
  // Prompt #21 spec's own worked example (100 ordered / 40 + 35 received /
  // 25 pending).
  // -----------------------------------------------------------------------
  describe('Partial receipts, over-receipt rejection, and concurrency', () => {
    async function confirmedOrder(quantity: string, unitCost = '10') {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('partial');
      const created = await agent
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          lines: [{ productVariantId: variant, quantity, unitCost }],
        });
      expect(created.status).toBe(201);
      const order = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder;
      const lineId = order.lines[0].id;
      const confirmRes = await agent
        .post(`/api/v1/purchase-orders/${order.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirmRes.status).toBe(200);
      return { orderId: order.id, lineId, variant };
    }

    async function receiveAgainstLine(
      a: request.Agent,
      params: {
        orderId: string;
        lineId: string;
        variant: string;
        quantity: string;
      },
    ) {
      const created = await a
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          purchaseOrderId: params.orderId,
          lines: [
            {
              productVariantId: params.variant,
              quantity: params.quantity,
              unitCostSnapshot: '10',
              purchaseOrderLineId: params.lineId,
            },
          ],
        });
      return created;
    }

    it('100 ordered / 40 then 35 received / 25 pending — the exact worked example from the spec', async () => {
      const agent = await loginAs(userAdminId);
      const { orderId, lineId, variant } = await confirmedOrder('100');

      const r1 = await receiveAgainstLine(agent, {
        orderId,
        lineId,
        variant,
        quantity: '40',
      });
      expect(r1.status).toBe(201);
      const r1Id = (r1.body as { purchaseReceipt: PurchaseReceiptBody })
        .purchaseReceipt.id;
      const r1Confirm = await agent
        .post(`/api/v1/purchase-receipts/${r1Id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(r1Confirm.status).toBe(200);

      const afterFirst = await agent
        .get(`/api/v1/purchase-orders/${orderId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const lineAfterFirst = (
        afterFirst.body as { purchaseOrder: PurchaseOrderBody }
      ).purchaseOrder.lines[0];
      expect(lineAfterFirst.receivedQuantity).toBe('40');
      expect(lineAfterFirst.pendingQuantity).toBe('60');

      const r2 = await receiveAgainstLine(agent, {
        orderId,
        lineId,
        variant,
        quantity: '35',
      });
      expect(r2.status).toBe(201);
      const r2Id = (r2.body as { purchaseReceipt: PurchaseReceiptBody })
        .purchaseReceipt.id;
      const r2Confirm = await agent
        .post(`/api/v1/purchase-receipts/${r2Id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(r2Confirm.status).toBe(200);

      const afterSecond = await agent
        .get(`/api/v1/purchase-orders/${orderId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const lineAfterSecond = (
        afterSecond.body as { purchaseOrder: PurchaseOrderBody }
      ).purchaseOrder.lines[0];
      expect(lineAfterSecond.receivedQuantity).toBe('75');
      expect(lineAfterSecond.pendingQuantity).toBe('25');

      const balance = await inventoryService.getBalance(
        companyAId,
        warehouseId,
        variant,
      );
      expect(balance.onHand).toBe('75');
    });

    it('rejects receiving more than the pending quantity', async () => {
      const agent = await loginAs(userAdminId);
      const { orderId, lineId, variant } = await confirmedOrder('10');
      const res = await receiveAgainstLine(agent, {
        orderId,
        lineId,
        variant,
        quantity: '11',
      });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_ORDER_OVER_RECEIPT',
      );
    });

    it('rejects a receipt line referencing a purchaseOrderLineId from a different order/variant', async () => {
      const agent = await loginAs(userAdminId);
      const { lineId, variant } = await confirmedOrder('10');
      const { orderId: otherOrderId } = await confirmedOrder('10');
      const res = await receiveAgainstLine(agent, {
        orderId: otherOrderId,
        lineId,
        variant,
        quantity: '5',
      });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_LINE_NOT_FROM_ORDER',
      );
    });

    it('rejects receiving against a DRAFT (not yet confirmed) order', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('draft-order-receipt');
      const created = await agent
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          lines: [
            { productVariantId: variant, quantity: '10', unitCost: '10' },
          ],
        });
      const order = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder;
      const res = await receiveAgainstLine(agent, {
        orderId: order.id,
        lineId: order.lines[0].id,
        variant,
        quantity: '5',
      });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_ORDER_NOT_CONFIRMED',
      );
    });

    it('rejects a receipt supplier that does not match the order supplier', async () => {
      const agent = await loginAs(userAdminId);
      const { orderId, lineId, variant } = await confirmedOrder('10');
      const otherSupplier = await prisma.supplier.create({
        data: {
          tenantId,
          companyId: companyAId,
          code: `PSUP-MISMATCH-${suffix}-${Math.random().toString(36).slice(2)}`,
          legalName: 'Mismatched Supplier',
          status: 'ACTIVE',
        },
      });
      const res = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId: otherSupplier.id,
          warehouseId,
          purchaseOrderId: orderId,
          lines: [
            {
              productVariantId: variant,
              quantity: '5',
              unitCostSnapshot: '10',
              purchaseOrderLineId: lineId,
            },
          ],
        });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'PURCHASE_RECEIPT_SUPPLIER_MISMATCH',
      );
    });

    it(
      'CONCURRENCY: two workstations racing to receive the same remaining PO quantity — ' +
        'exactly one succeeds, no over-receipt, and the loser leaves no partial StockMovement',
      async () => {
        const agent = await loginAs(userAdminId);
        // Ordered 10; two DRAFT receipts each request 6 — individually valid
        // at their own creation time (pending was still 10 for both), but
        // 6 + 6 = 12 > 10 if both were allowed to confirm.
        const { orderId, lineId, variant } = await confirmedOrder('10');

        const receiptA = await receiveAgainstLine(agent, {
          orderId,
          lineId,
          variant,
          quantity: '6',
        });
        const receiptB = await receiveAgainstLine(agent, {
          orderId,
          lineId,
          variant,
          quantity: '6',
        });
        expect(receiptA.status).toBe(201);
        expect(receiptB.status).toBe(201);
        const receiptAId = (
          receiptA.body as { purchaseReceipt: PurchaseReceiptBody }
        ).purchaseReceipt.id;
        const receiptBId = (
          receiptB.body as { purchaseReceipt: PurchaseReceiptBody }
        ).purchaseReceipt.id;

        const [confirmA, confirmB] = await Promise.all([
          agent
            .post(`/api/v1/purchase-receipts/${receiptAId}/confirm`)
            .set(COMPANY_ID_HEADER, companyAId),
          agent
            .post(`/api/v1/purchase-receipts/${receiptBId}/confirm`)
            .set(COMPANY_ID_HEADER, companyAId),
        ]);
        const statuses = [confirmA.status, confirmB.status].sort();
        expect(statuses).toEqual([200, 409]);

        const winnerId = confirmA.status === 200 ? receiptAId : receiptBId;
        const loserId = confirmA.status === 200 ? receiptBId : receiptAId;
        const loserResponse = confirmA.status === 200 ? confirmB : confirmA;
        expect((loserResponse.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_ORDER_OVER_RECEIPT',
        );

        // Never both received — balance reflects exactly one 6-unit receipt.
        const balance = await inventoryService.getBalance(
          companyAId,
          warehouseId,
          variant,
        );
        expect(balance.onHand).toBe('6');

        const winnerMovements = await prisma.stockMovement.count({
          where: {
            companyId: companyAId,
            referenceType: 'PurchaseReceipt',
            referenceId: winnerId,
          },
        });
        expect(winnerMovements).toBe(1);

        // The loser rolled back completely: still DRAFT, zero movements.
        const loserRow = await prisma.purchaseReceipt.findUniqueOrThrow({
          where: { id: loserId },
        });
        expect(loserRow.status).toBe('DRAFT');
        const loserMovements = await prisma.stockMovement.count({
          where: {
            companyId: companyAId,
            referenceType: 'PurchaseReceipt',
            referenceId: loserId,
          },
        });
        expect(loserMovements).toBe(0);

        const orderRes = await agent
          .get(`/api/v1/purchase-orders/${orderId}`)
          .set(COMPANY_ID_HEADER, companyAId);
        const line = (orderRes.body as { purchaseOrder: PurchaseOrderBody })
          .purchaseOrder.lines[0];
        expect(line.receivedQuantity).toBe('6');
        expect(line.pendingQuantity).toBe('4');
      },
    );
  });

  // -----------------------------------------------------------------------
  // Concurrency safety — update() vs confirm()/cancel() races. Distinct
  // from the over-receipt concurrency test above (that one proves the
  // PurchaseOrderLine FOR UPDATE lock; these prove the document-row guard
  // that makes update()/confirm()/cancel() mutually exclusive once a
  // document leaves DRAFT — see docs/purchases.md's "Concurrency" section
  // and PurchaseOrdersService/PurchaseReceiptsService's update()/confirm()/
  // cancel(). The exact winner of each race may vary; the property under
  // test is that the final state is always internally consistent, never
  // that one specific side wins.
  // -----------------------------------------------------------------------
  describe('Concurrency safety: update/confirm/cancel races', () => {
    it('A/B: a receipt update racing its own confirm never leaves the confirmed lines out of sync with the stock ledger, and never mutates an already-confirmed receipt', async () => {
      const agent = await loginAs(userAdminId);
      const variantOriginal = await freshVariant(
        'race-receipt-update-original',
      );
      const variantReplacement = await freshVariant(
        'race-receipt-update-replacement',
      );

      const created = await agent
        .post('/api/v1/purchase-receipts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          warehouseId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variantOriginal,
              quantity: '5',
              unitCostSnapshot: '10',
            },
          ],
        });
      expect(created.status).toBe(201);
      const receiptId = (
        created.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.id;

      const [confirmRes, updateRes] = await Promise.all([
        agent
          .post(`/api/v1/purchase-receipts/${receiptId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        agent
          .patch(`/api/v1/purchase-receipts/${receiptId}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            lines: [
              {
                productVariantId: variantReplacement,
                quantity: '3',
                unitCostSnapshot: '20',
              },
            ],
          }),
      ]);

      // Nothing else contends for THIS receipt's own DRAFT->CONFIRMED
      // transition here, so confirm always succeeds; update either wins
      // the race (200) or loses it because confirm's guard got there
      // first (409 — proving B: update can never mutate an
      // already-confirmed receipt).
      expect(confirmRes.status).toBe(200);
      expect([200, 409]).toContain(updateRes.status);

      const finalReceipt = await agent
        .get(`/api/v1/purchase-receipts/${receiptId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const persistedLine = (
        finalReceipt.body as { purchaseReceipt: PurchaseReceiptBody }
      ).purchaseReceipt.lines[0];

      const movement = await prisma.stockMovement.findFirst({
        where: {
          companyId: companyAId,
          referenceType: 'PurchaseReceipt',
          referenceId: receiptId,
        },
      });
      expect(movement).not.toBeNull();

      if (updateRes.status === 200) {
        // update won — confirm() reloaded fresh from inside its own
        // transaction and booked stock for the REPLACEMENT line.
        expect(persistedLine.productVariantId).toBe(variantReplacement);
        expect(persistedLine.quantity).toBe('3');
      } else {
        expect((updateRes.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_RECEIPT_NOT_EDITABLE',
        );
        expect(persistedLine.productVariantId).toBe(variantOriginal);
        expect(persistedLine.quantity).toBe('5');
      }

      // A: the property that must hold regardless of which side won — the
      // confirmed document's persisted lines and its StockMovement ledger
      // always agree, never a stale/mismatched pair.
      expect(movement!.productVariantId).toBe(persistedLine.productVariantId);
      expect(movement!.quantity.toString()).toBe(persistedLine.quantity);
    });

    it('C: a PO update racing its own confirm never leaves the order in an inconsistent state', async () => {
      const agent = await loginAs(userAdminId);
      const variantOriginal = await freshVariant('race-po-update-original');
      const variantReplacement = await freshVariant(
        'race-po-update-replacement',
      );

      const created = await agent
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          lines: [
            {
              productVariantId: variantOriginal,
              quantity: '5',
              unitCost: '100',
            },
          ],
        });
      expect(created.status).toBe(201);
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const [confirmRes, updateRes] = await Promise.all([
        agent
          .post(`/api/v1/purchase-orders/${orderId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        agent
          .patch(`/api/v1/purchase-orders/${orderId}`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            lines: [
              {
                productVariantId: variantReplacement,
                quantity: '3',
                unitCost: '200',
              },
            ],
          }),
      ]);

      expect(confirmRes.status).toBe(200);
      expect([200, 409]).toContain(updateRes.status);

      const finalOrder = await agent
        .get(`/api/v1/purchase-orders/${orderId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const body = (finalOrder.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder;
      expect(body.status).toBe('CONFIRMED');

      if (updateRes.status === 200) {
        expect(body.lines[0].productVariantId).toBe(variantReplacement);
        expect(body.lines[0].quantity).toBe('3');
      } else {
        expect((updateRes.body as ErrorEnvelope).error.code).toBe(
          'PURCHASE_ORDER_NOT_EDITABLE',
        );
        expect(body.lines[0].productVariantId).toBe(variantOriginal);
        expect(body.lines[0].quantity).toBe('5');
      }
    });

    it('D: PO confirm racing cancel never produces an illegal DRAFT -> CONFIRMED -> CANCELLED transition', async () => {
      const agent = await loginAs(userAdminId);
      const variant = await freshVariant('race-po-confirm-cancel');
      const created = await agent
        .post('/api/v1/purchase-orders')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          lines: [{ productVariantId: variant, quantity: '1', unitCost: '10' }],
        });
      const orderId = (created.body as { purchaseOrder: PurchaseOrderBody })
        .purchaseOrder.id;

      const [confirmRes, cancelRes] = await Promise.all([
        agent
          .post(`/api/v1/purchase-orders/${orderId}/confirm`)
          .set(COMPANY_ID_HEADER, companyAId),
        agent
          .post(`/api/v1/purchase-orders/${orderId}/cancel`)
          .set(COMPANY_ID_HEADER, companyAId),
      ]);

      const statuses = [confirmRes.status, cancelRes.status].sort();
      expect(statuses).toEqual([200, 409]); // exactly one side wins, never both

      const finalOrder = await agent
        .get(`/api/v1/purchase-orders/${orderId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const finalStatus = (
        finalOrder.body as { purchaseOrder: PurchaseOrderBody }
      ).purchaseOrder.status;
      expect(finalStatus).toBe(
        confirmRes.status === 200 ? 'CONFIRMED' : 'CANCELLED',
      );

      // Exactly one terminal-transition audit record exists — never both a
      // CONFIRM and a CANCEL for the same order (that would be the illegal
      // DRAFT -> CONFIRMED -> CANCELLED transition this test guards against).
      const auditRows = await prisma.auditLog.findMany({
        where: {
          entityType: 'PurchaseOrder',
          entityId: orderId,
          action: { in: ['CONFIRM', 'CANCEL'] },
        },
      });
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe(
        confirmRes.status === 200 ? 'CONFIRM' : 'CANCEL',
      );
    });
  });
});
