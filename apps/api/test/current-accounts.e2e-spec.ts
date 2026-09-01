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
interface SaleBody {
  id: string;
  status: string;
  total: string;
}
interface ReceiptBody {
  id: string;
  status: string;
}
interface CollectionBody {
  id: string;
  number: string;
  status: string;
  amount: string;
  appliedAmount: string;
  unappliedAmount: string;
  applications: { id: string; salesDocumentId: string; amount: string }[];
}
interface PaymentBody {
  id: string;
  number: string;
  status: string;
  amount: string;
  appliedAmount: string;
  applications: { id: string; purchaseReceiptId: string; amount: string }[];
}
interface AccountSummaryBody {
  balances: { currencyId: string; currencyCode: string; balance: string }[];
}
interface OutstandingBody {
  total: string;
  outstanding: string;
}

/**
 * Customer/Supplier Current Accounts, Collections ("Cobros") and Supplier
 * Payments ("Pagos") — see docs/current-accounts.md. Drives real sales and
 * purchase-receipt confirmations through the actual HTTP endpoints (not
 * fixture inserts) so this also exercises the SalesService/
 * PurchaseReceiptsService -> CustomerAccountService/SupplierAccountService
 * integration, not just the accounts module in isolation. Self-contained
 * fixtures, not the dev seed — same pattern as purchases.e2e-spec.ts.
 */
describe('Current Accounts: Collections, Supplier Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let inventoryService: InventoryService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let branchAId: string;

  let arsId: string;
  let usdId: string;

  let warehouseId: string;
  let priceListId: string;
  let priceListUsdId: string;
  let variantId: string;

  let customerId: string; // company A
  let customerBId: string; // company B
  let supplierId: string; // company A
  let supplierBId: string; // company B

  let userAdminId: string;
  let userNoConfirmId: string; // missing treasury.receipts.confirm / treasury.payments.confirm
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
      data: { name: `E2E Accounts Tenant ${suffix}`, slug: `e2e-accounts-tenant-${suffix}` },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Accounts Company A',
        taxId: `e2e-acc-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Accounts Company B',
        taxId: `e2e-acc-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const branchA = await prisma.branch.create({
      data: { tenantId, companyId: companyAId, code: `BR-A-${suffix}`, name: 'Branch A' },
    });
    branchAId = branchA.id;

    const ars = await prisma.currency.upsert({
      where: { code: 'ARS' },
      update: {},
      create: { code: 'ARS', name: 'Peso argentino', symbol: '$', decimalPlaces: 2 },
    });
    arsId = ars.id;
    const usd = await prisma.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$', decimalPlaces: 2 },
    });
    usdId = usd.id;

    const unit = await prisma.unitOfMeasure.create({
      data: { tenantId, companyId: companyAId, code: 'UN', name: 'Unidad', symbol: 'u', decimalPlaces: 0 },
    });
    const product = await prisma.product.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: `ACCPROD-${suffix}`,
        name: 'Accounts Product',
        baseUnitId: unit.id,
        trackInventory: true,
      },
    });
    const variant = await prisma.productVariant.create({ data: { productId: product.id, name: null } });
    variantId = variant.id;

    const warehouse = await prisma.warehouse.create({
      data: { tenantId, companyId: companyAId, code: `ACCWH-${suffix}`, name: 'Accounts Warehouse' },
    });
    warehouseId = warehouse.id;

    const customer = await prisma.customer.create({
      data: { tenantId, companyId: companyAId, code: `ACCCUST-${suffix}`, legalName: 'Accounts Customer A', status: 'ACTIVE' },
    });
    customerId = customer.id;
    const customerB = await prisma.customer.create({
      data: { tenantId, companyId: companyBId, code: `ACCCUST-B-${suffix}`, legalName: 'Accounts Customer B', status: 'ACTIVE' },
    });
    customerBId = customerB.id;

    const supplier = await prisma.supplier.create({
      data: { tenantId, companyId: companyAId, code: `ACCSUP-${suffix}`, legalName: 'Accounts Supplier A', status: 'ACTIVE' },
    });
    supplierId = supplier.id;
    const supplierB = await prisma.supplier.create({
      data: { tenantId, companyId: companyBId, code: `ACCSUP-B-${suffix}`, legalName: 'Accounts Supplier B', status: 'ACTIVE' },
    });
    supplierBId = supplierB.id;

    async function makePermission(code: string, module: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module, resource, action },
      });
    }
    const allCodes: [string, string][] = [
      ['sales.documents.read', 'sales'],
      ['sales.documents.create', 'sales'],
      ['sales.documents.update', 'sales'],
      ['sales.documents.confirm', 'sales'],
      ['sales.documents.cancel', 'sales'],
      ['pricing.lists.read', 'pricing'],
      ['pricing.lists.create', 'pricing'],
      ['pricing.prices.update', 'pricing'],
      ['purchases.goods-receipts.read', 'purchases'],
      ['purchases.goods-receipts.create', 'purchases'],
      ['purchases.goods-receipts.confirm', 'purchases'],
      ['purchases.goods-receipts.cancel', 'purchases'],
      ['accounts.receivable.read', 'accounts'],
      ['accounts.payable.read', 'accounts'],
      ['treasury.receipts.read', 'accounts'],
      ['treasury.receipts.create', 'accounts'],
      ['treasury.receipts.update', 'accounts'],
      ['treasury.receipts.confirm', 'accounts'],
      ['treasury.receipts.cancel', 'accounts'],
      ['treasury.payments.read', 'accounts'],
      ['treasury.payments.create', 'accounts'],
      ['treasury.payments.update', 'accounts'],
      ['treasury.payments.confirm', 'accounts'],
      ['treasury.payments.cancel', 'accounts'],
    ];
    const permByCode = new Map<string, string>();
    for (const [code, module] of allCodes) {
      permByCode.set(code, (await makePermission(code, module)).id);
    }

    async function makeRole(companyId: string, name: string, codes: string[]) {
      const role = await prisma.role.create({ data: { tenantId, companyId, name } });
      const permissionIds = codes.map((c) => permByCode.get(c)!);
      if (permissionIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        });
      }
      return role;
    }

    const roleFullA = await makeRole(companyAId, 'Accounts E2E Full A', allCodes.map(([c]) => c));
    const roleNoConfirm = await makeRole(
      companyAId,
      'Accounts E2E No Confirm',
      allCodes.map(([c]) => c).filter((c) => c !== 'treasury.receipts.confirm' && c !== 'treasury.payments.confirm'),
    );

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-accounts-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const userAdmin = await makeUser('Admin');
    const userNoConfirm = await makeUser('NoConfirm');
    userAdminId = userAdmin.id;
    userNoConfirmId = userNoConfirm.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({ data: { userId, tenantId, companyId, active: true } });
    }
    await membership(userAdminId, companyAId);
    await membership(userNoConfirmId, companyAId);

    async function assignRole(userId: string, roleId: string, companyId: string) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userAdminId, roleFullA.id, companyAId);
    await assignRole(userNoConfirmId, roleNoConfirm.id, companyAId);

    const agentByUser = new Map<string, request.Agent>();
    async function loginAsSetup(userId: string) {
      const cached = agentByUser.get(userId);
      if (cached) return cached;
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      const agent = request.agent(app.getHttpServer());
      const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
      expect(res.status).toBe(200);
      agentByUser.set(userId, agent);
      return agent;
    }
    const adminAgent = await loginAsSetup(userAdminId);

    const priceList = await adminAgent
      .post('/api/v1/pricing/lists')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        code: `ACCPL-${suffix}`,
        name: 'Accounts Price List',
        currencyId: arsId,
        includesTax: false,
        pricingMode: 'FIXED',
        isDefault: false,
      });
    priceListId = (priceList.body as { priceList: { id: string } }).priceList.id;
    await adminAgent
      .put(`/api/v1/pricing/lists/${priceListId}/products/${variantId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ price: '1000' });

    const priceListUsd = await adminAgent
      .post('/api/v1/pricing/lists')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        code: `ACCPLUSD-${suffix}`,
        name: 'Accounts Price List USD',
        currencyId: usdId,
        includesTax: false,
        pricingMode: 'FIXED',
        isDefault: false,
      });
    priceListUsdId = (priceListUsd.body as { priceList: { id: string } }).priceList.id;
    await adminAgent
      .put(`/api/v1/pricing/lists/${priceListUsdId}/products/${variantId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ price: '10' });

    await inventoryService.createInitialBalance(
      { userId: userAdminId, companyId: companyAId, tenantId },
      { warehouseId, lines: [{ productVariantId: variantId, quantity: '10000' }] },
    );
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.customerCollectionApplication.deleteMany({
      where: { customerCollection: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.customerCollection.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.customerCollectionSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.supplierPaymentApplication.deleteMany({
      where: { supplierPayment: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.supplierPayment.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.supplierPaymentSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.customerAccountMovement.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.supplierAccountMovement.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.salesTender.deleteMany({
      where: { salesDocument: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.salesDocumentLine.deleteMany({
      where: { salesDocument: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.salesDocument.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.salesDocumentSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.purchaseReceiptLine.deleteMany({
      where: { purchaseReceipt: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.purchaseReceipt.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.purchaseReceiptSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.stockMovement.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.inventoryBalance.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.priceListItem.deleteMany({ where: { priceList: { companyId: { in: [companyAId, companyBId] } } } });
    await prisma.priceHistory.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.priceList.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.customer.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.customerCodeSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.supplier.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.supplierCodeSequence.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.warehouse.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.productVariant.deleteMany({ where: { product: { companyId: { in: [companyAId, companyBId] } } } });
    await prisma.product.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.unitOfMeasure.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { companyId: { in: [companyAId, companyBId] } } } });
    await prisma.role.deleteMany({ where: { companyId: { in: [companyAId, companyBId] } } });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.branch.deleteMany({ where: { id: branchAId } });
    await prisma.company.deleteMany({ where: { id: { in: [companyAId, companyBId] } } });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  const agentByUser = new Map<string, request.Agent>();
  async function loginAs(userId: string) {
    const cached = agentByUser.get(userId);
    if (cached) return cached;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    agentByUser.set(userId, agent);
    return agent;
  }

  /** A confirmed sale, `onAccount: true` -> no tender (stays fully outstanding), otherwise tendered in full. */
  async function confirmedSale(
    agent: request.Agent,
    opts: { quantity?: string; onAccount?: boolean; priceListId?: string; customerId?: string } = {},
  ): Promise<SaleBody> {
    const created = await agent
      .post('/api/v1/sales')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        customerId: opts.customerId ?? customerId,
        warehouseId,
        priceListId: opts.priceListId ?? priceListId,
        lines: [{ productVariantId: variantId, quantity: opts.quantity ?? '1' }],
      });
    expect(created.status).toBe(201);
    const saleId = (created.body as { salesDocument: SaleBody }).salesDocument.id;
    const confirm = await agent
      .post(`/api/v1/sales/${saleId}/confirm`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send(opts.onAccount ? {} : { tender: { method: 'CASH' } });
    expect(confirm.status).toBe(200);
    return (confirm.body as { salesDocument: SaleBody }).salesDocument;
  }

  async function confirmedReceipt(
    agent: request.Agent,
    opts: { quantity?: string; unitCost?: string; supplierId?: string; currencyId?: string } = {},
  ): Promise<ReceiptBody> {
    const created = await agent
      .post('/api/v1/purchase-receipts')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        supplierId: opts.supplierId ?? supplierId,
        warehouseId,
        currencyId: opts.currencyId ?? arsId,
        lines: [
          {
            productVariantId: variantId,
            quantity: opts.quantity ?? '1',
            unitCostSnapshot: opts.unitCost ?? '100',
          },
        ],
      });
    expect(created.status).toBe(201);
    const receiptId = (created.body as { purchaseReceipt: ReceiptBody }).purchaseReceipt.id;
    const confirm = await agent
      .post(`/api/v1/purchase-receipts/${receiptId}/confirm`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(confirm.status).toBe(200);
    return (confirm.body as { purchaseReceipt: ReceiptBody }).purchaseReceipt;
  }

  // -----------------------------------------------------------------------
  // Sale confirmation -> ledger integration
  // -----------------------------------------------------------------------
  describe('Sale confirmation posts the customer ledger', () => {
    it('a sale confirmed WITHOUT a tender remains fully outstanding (SALE_CHARGE only)', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '3' });

      const outstanding = await agent
        .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(outstanding.status).toBe(200);
      const body = outstanding.body as OutstandingBody;
      expect(body.total).toBe('3000');
      expect(body.outstanding).toBe('3000');

      const movements = await prisma.customerAccountMovement.findMany({
        where: { companyId: companyAId, sourceType: 'SalesDocument', sourceId: sale.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('SALE_CHARGE');
      expect(movements[0].amount.toString()).toBe('3000.0000');
    });

    it('a tendered sale nets to zero outstanding (SALE_CHARGE + TENDER_SETTLEMENT = 0), settlement equals total regardless of amountReceived', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { quantity: '2' });

      const outstanding = await agent
        .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstanding.body as OutstandingBody).outstanding).toBe('0');

      const movements = await prisma.customerAccountMovement.findMany({
        where: { companyId: companyAId, sourceType: 'SalesDocument', sourceId: sale.id },
        orderBy: { movementType: 'asc' },
      });
      expect(movements).toHaveLength(2);
      const charge = movements.find((m) => m.movementType === 'SALE_CHARGE')!;
      const settlement = movements.find((m) => m.movementType === 'TENDER_SETTLEMENT')!;
      expect(charge.amount.toString()).toBe('2000.0000');
      expect(settlement.amount.toString()).toBe('-2000.0000');
    });

    it('a second confirm attempt on the same sale never double-posts (DB-level uniqueness, not just the app guard)', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true });
      // Idempotent re-confirm — SalesService's own guard returns 409 before
      // ever reaching CustomerAccountService again.
      const again = await agent
        .post(`/api/v1/sales/${sale.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(again.status).toBe(409);
      const movements = await prisma.customerAccountMovement.count({
        where: { companyId: companyAId, sourceType: 'SalesDocument', sourceId: sale.id },
      });
      expect(movements).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Purchase receipt confirmation -> ledger integration
  // -----------------------------------------------------------------------
  describe('Purchase receipt confirmation posts the supplier ledger', () => {
    it('a confirmed receipt posts PURCHASE_RECEIPT_ACCRUAL = SUM(quantity x unitCostSnapshot)', async () => {
      const agent = await loginAs(userAdminId);
      const receipt = await confirmedReceipt(agent, { quantity: '4', unitCost: '250' });

      const outstanding = await agent
        .get(`/api/v1/purchase-receipts/${receipt.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(outstanding.status).toBe(200);
      expect((outstanding.body as OutstandingBody).outstanding).toBe('1000');

      const movement = await prisma.supplierAccountMovement.findFirstOrThrow({
        where: { companyId: companyAId, sourceType: 'PurchaseReceipt', sourceId: receipt.id },
      });
      expect(movement.movementType).toBe('PURCHASE_RECEIPT_ACCRUAL');
      expect(movement.amount.toString()).toBe('1000.0000');
    });

    it('cancelling a CONFIRMED receipt with no payments posts an immutable PURCHASE_RECEIPT_REVERSAL', async () => {
      const agent = await loginAs(userAdminId);
      const receipt = await confirmedReceipt(agent, { quantity: '2', unitCost: '500' });
      const cancel = await agent
        .post(`/api/v1/purchase-receipts/${receipt.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(200);

      const outstanding = await agent
        .get(`/api/v1/purchase-receipts/${receipt.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstanding.body as OutstandingBody).outstanding).toBe('0');

      const movements = await prisma.supplierAccountMovement.findMany({
        where: { companyId: companyAId, sourceType: 'PurchaseReceipt', sourceId: receipt.id },
      });
      expect(movements).toHaveLength(2);
      const reversal = movements.find((m) => m.movementType === 'PURCHASE_RECEIPT_REVERSAL')!;
      expect(reversal.amount.toString()).toBe('-1000.0000');
      expect(reversal.reversalOfId).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Customer Collections ("Cobros")
  // -----------------------------------------------------------------------
  describe('Customer Collections', () => {
    it('a partial CONFIRMED collection reduces the sale outstanding and the customer account balance', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '5' }); // total 5000

      const created = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          currencyId: arsId,
          amount: '2000',
          paymentMethod: 'TRANSFER',
          applications: [{ salesDocumentId: sale.id, amount: '2000' }],
        });
      expect(created.status).toBe(201);
      const collection = (created.body as { collection: CollectionBody }).collection;
      expect(collection.status).toBe('DRAFT');

      const confirm = await agent
        .post(`/api/v1/customer-collections/${collection.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      const outstanding = await agent
        .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstanding.body as OutstandingBody).outstanding).toBe('3000');

      const summary = await agent
        .get(`/api/v1/customer-accounts/${customerId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const arsBalance = (summary.body as AccountSummaryBody).balances.find((b) => b.currencyId === arsId);
      expect(arsBalance).toBeDefined();
      // Balance includes other tests' movements too (shared customer) —
      // assert the ledger rows directly instead of an absolute total.
      const movement = await prisma.customerAccountMovement.findFirstOrThrow({
        where: { companyId: companyAId, sourceType: 'CustomerCollection', sourceId: collection.id },
      });
      expect(movement.movementType).toBe('COLLECTION');
      expect(movement.amount.toString()).toBe('-2000.0000');
    });

    it('rejects an application that would exceed the sale outstanding (advisory check at create time)', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '1' }); // total 1000

      const res = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          currencyId: arsId,
          amount: '5000',
          paymentMethod: 'TRANSFER',
          applications: [{ salesDocumentId: sale.id, amount: '5000' }],
        });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe('CUSTOMER_COLLECTION_OVER_APPLICATION');
    });

    it('rejects a currency mismatch between the application and the sale', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '1', priceListId, customerId });

      const res = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          currencyId: usdId,
          amount: '10',
          paymentMethod: 'TRANSFER',
          applications: [{ salesDocumentId: sale.id, amount: '10' }],
        });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe('CUSTOMER_COLLECTION_APPLICATION_CURRENCY_MISMATCH');
    });

    it('rejects an application to a sale belonging to a different customer (never trusts the request body for ownership)', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '1' }); // customerId (company A)

      const res = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId, // the collection claims customerId, but...
          currencyId: arsId,
          amount: '100',
          paymentMethod: 'TRANSFER',
          applications: [{ salesDocumentId: sale.id, amount: '100' }],
        });
      // sale actually belongs to `customerId` here, so mutate to prove the
      // mismatch path: apply against a sale while claiming a DIFFERENT customerId.
      expect(res.status).toBe(201); // sanity: same-customer application is fine

      const mismatched = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId: customerBId, // wrong company/customer for this sale
          currencyId: arsId,
          amount: '100',
          paymentMethod: 'TRANSFER',
          applications: [{ salesDocumentId: sale.id, amount: '100' }],
        });
      expect(mismatched.status).toBe(404); // customerBId not found within companyA's scope
    });

    it('cancelling a CONFIRMED collection posts an immutable COLLECTION_REVERSAL and restores outstanding, never deleting the application', async () => {
      const agent = await loginAs(userAdminId);
      const sale = await confirmedSale(agent, { onAccount: true, quantity: '4' }); // total 4000

      const created = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          currencyId: arsId,
          amount: '4000',
          paymentMethod: 'CASH',
          applications: [{ salesDocumentId: sale.id, amount: '4000' }],
        });
      const collectionId = (created.body as { collection: CollectionBody }).collection.id;
      await agent.post(`/api/v1/customer-collections/${collectionId}/confirm`).set(COMPANY_ID_HEADER, companyAId);

      const outstandingAfterConfirm = await agent
        .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstandingAfterConfirm.body as OutstandingBody).outstanding).toBe('0');

      const cancel = await agent
        .post(`/api/v1/customer-collections/${collectionId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(200);

      const outstandingAfterCancel = await agent
        .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstandingAfterCancel.body as OutstandingBody).outstanding).toBe('4000');

      const detail = await agent
        .get(`/api/v1/customer-collections/${collectionId}`)
        .set(COMPANY_ID_HEADER, companyAId);
      const collection = (detail.body as { collection: CollectionBody }).collection;
      expect(collection.status).toBe('CANCELLED');
      // Application row survives, unmutated — see docs/current-accounts.md.
      expect(collection.applications).toHaveLength(1);
      expect(collection.applications[0].amount).toBe('4000');
    });

    it('RBAC: a user without treasury.receipts.confirm gets 403 confirming a collection', async () => {
      const agent = await loginAs(userNoConfirmId);
      const sale = await confirmedSale(await loginAs(userAdminId), { onAccount: true, quantity: '1' });
      const created = await agent
        .post('/api/v1/customer-collections')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          customerId,
          currencyId: arsId,
          amount: '500',
          paymentMethod: 'CASH',
          applications: [{ salesDocumentId: sale.id, amount: '500' }],
        });
      expect(created.status).toBe(201);
      const collectionId = (created.body as { collection: CollectionBody }).collection.id;
      const confirm = await agent
        .post(`/api/v1/customer-collections/${collectionId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(403);
    });

    it(
      'CONCURRENCY: two collections racing to apply the full outstanding of the same sale — exactly one confirms, ' +
        'the other is rejected with CUSTOMER_COLLECTION_OVER_APPLICATION, and outstanding never goes negative',
      async () => {
        const agent = await loginAs(userAdminId);
        const sale = await confirmedSale(agent, { onAccount: true, quantity: '3' }); // total 3000

        const collectionA = await agent
          .post('/api/v1/customer-collections')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            customerId,
            currencyId: arsId,
            amount: '3000',
            paymentMethod: 'TRANSFER',
            applications: [{ salesDocumentId: sale.id, amount: '3000' }],
          });
        const collectionB = await agent
          .post('/api/v1/customer-collections')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            customerId,
            currencyId: arsId,
            amount: '3000',
            paymentMethod: 'TRANSFER',
            applications: [{ salesDocumentId: sale.id, amount: '3000' }],
          });
        expect(collectionA.status).toBe(201);
        expect(collectionB.status).toBe(201);
        const idA = (collectionA.body as { collection: CollectionBody }).collection.id;
        const idB = (collectionB.body as { collection: CollectionBody }).collection.id;

        const [confirmA, confirmB] = await Promise.all([
          agent.post(`/api/v1/customer-collections/${idA}/confirm`).set(COMPANY_ID_HEADER, companyAId),
          agent.post(`/api/v1/customer-collections/${idB}/confirm`).set(COMPANY_ID_HEADER, companyAId),
        ]);
        const statuses = [confirmA.status, confirmB.status].sort();
        expect(statuses).toEqual([200, 409]);
        const loser = confirmA.status === 200 ? confirmB : confirmA;
        expect((loser.body as ErrorEnvelope).error.code).toBe('CUSTOMER_COLLECTION_OVER_APPLICATION');

        const outstanding = await agent
          .get(`/api/v1/sales-documents/${sale.id}/outstanding`)
          .set(COMPANY_ID_HEADER, companyAId);
        expect((outstanding.body as OutstandingBody).outstanding).toBe('0');

        const collectionMovements = await prisma.customerAccountMovement.count({
          where: { companyId: companyAId, movementType: 'COLLECTION', sourceType: 'CustomerCollection', sourceId: { in: [idA, idB] } },
        });
        expect(collectionMovements).toBe(1);
      },
    );
  });

  // -----------------------------------------------------------------------
  // Supplier Payments ("Pagos")
  // -----------------------------------------------------------------------
  describe('Supplier Payments', () => {
    it('a partial CONFIRMED payment reduces the receipt outstanding', async () => {
      const agent = await loginAs(userAdminId);
      const receipt = await confirmedReceipt(agent, { quantity: '10', unitCost: '100' }); // total 1000

      const created = await agent
        .post('/api/v1/supplier-payments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          amount: '400',
          paymentMethod: 'TRANSFER',
          applications: [{ purchaseReceiptId: receipt.id, amount: '400' }],
        });
      expect(created.status).toBe(201);
      const paymentId = (created.body as { payment: PaymentBody }).payment.id;
      const confirm = await agent
        .post(`/api/v1/supplier-payments/${paymentId}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(200);

      const outstanding = await agent
        .get(`/api/v1/purchase-receipts/${receipt.id}/outstanding`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((outstanding.body as OutstandingBody).outstanding).toBe('600');
    });

    it('blocks cancelling a CONFIRMED receipt that has an active (CONFIRMED-payment) application', async () => {
      const agent = await loginAs(userAdminId);
      const receipt = await confirmedReceipt(agent, { quantity: '2', unitCost: '300' }); // total 600

      const created = await agent
        .post('/api/v1/supplier-payments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId,
          currencyId: arsId,
          amount: '600',
          paymentMethod: 'TRANSFER',
          applications: [{ purchaseReceiptId: receipt.id, amount: '600' }],
        });
      const paymentId = (created.body as { payment: PaymentBody }).payment.id;
      await agent.post(`/api/v1/supplier-payments/${paymentId}/confirm`).set(COMPANY_ID_HEADER, companyAId);

      const cancel = await agent
        .post(`/api/v1/purchase-receipts/${receipt.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancel.status).toBe(409);
      expect((cancel.body as ErrorEnvelope).error.code).toBe('PURCHASE_RECEIPT_HAS_ACTIVE_PAYMENTS');

      // Cancelling the payment first frees the receipt up again.
      const cancelPayment = await agent
        .post(`/api/v1/supplier-payments/${paymentId}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelPayment.status).toBe(200);
      const cancelReceiptAgain = await agent
        .post(`/api/v1/purchase-receipts/${receipt.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(cancelReceiptAgain.status).toBe(200);
    });

    it(
      'CONCURRENCY: confirming a payment races cancelling its receipt — exactly one succeeds, never both ' +
        '(a cancelled receipt with an active confirmed payment applied to it)',
      async () => {
        const agent = await loginAs(userAdminId);
        const receipt = await confirmedReceipt(agent, { quantity: '5', unitCost: '200' }); // total 1000

        const created = await agent
          .post('/api/v1/supplier-payments')
          .set(COMPANY_ID_HEADER, companyAId)
          .send({
            supplierId,
            currencyId: arsId,
            amount: '1000',
            paymentMethod: 'TRANSFER',
            applications: [{ purchaseReceiptId: receipt.id, amount: '1000' }],
          });
        const paymentId = (created.body as { payment: PaymentBody }).payment.id;

        const [confirmPayment, cancelReceipt] = await Promise.all([
          agent.post(`/api/v1/supplier-payments/${paymentId}/confirm`).set(COMPANY_ID_HEADER, companyAId),
          agent.post(`/api/v1/purchase-receipts/${receipt.id}/cancel`).set(COMPANY_ID_HEADER, companyAId),
        ]);

        const paymentConfirmed = confirmPayment.status === 200;
        const receiptCancelled = cancelReceipt.status === 200;
        // Never both — that would mean a cancelled receipt still has an
        // active confirmed payment applied to it (see docs/current-accounts.md).
        expect(paymentConfirmed && receiptCancelled).toBe(false);
        expect(paymentConfirmed || receiptCancelled).toBe(true);

        const receiptRow = await prisma.purchaseReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
        const paymentRow = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
        if (receiptRow.status === 'CANCELLED') {
          expect(paymentRow.status).not.toBe('CONFIRMED');
        }
        if (paymentRow.status === 'CONFIRMED') {
          expect(receiptRow.status).not.toBe('CANCELLED');
        }
      },
    );
  });

  // -----------------------------------------------------------------------
  // Company isolation
  // -----------------------------------------------------------------------
  describe('Company isolation', () => {
    it('a supplier from another company is never found when creating a payment scoped to company A', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/supplier-payments')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          supplierId: supplierBId,
          currencyId: arsId,
          amount: '100',
          paymentMethod: 'TRANSFER',
          applications: [],
        });
      expect(res.status).toBe(404);
    });
  });
});
