import { randomUUID } from 'node:crypto';
import { ArcaWsfeService } from '../src/fiscal/arca-wsfe.service';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import {
  COMPANY_ID_HEADER,
  type FiscalDraftResponse,
  type FiscalPreview,
  type FiscalDraftsResponse,
  type SaveFiscalDraftInput,
} from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { CustomerAccountService } from '../src/accounts/customer-account.service';
import { SalesService } from '../src/sales/sales.service';
import type { SalesDocumentStatus } from '../src/generated/prisma/client';

/** Isolated fixtures; run only against a disposable migrated database. */
describe('Fiscal drafts (e2e)', () => {
  const accepted = {
    status: 'AUTHORIZED',
    cae: '12345678901234',
    expiresAt: '20991231',
    message: 'Autorizado en pruebas',
  };
  const wsfe = {
    validate: jest.fn(),
    lastNumber: jest.fn(),
    authorize: jest.fn(),
    consult: jest.fn(),
  };
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tenantId: string;
  let foreignTenantId: string;
  let companyId: string;
  let foreignCompanyId: string;
  let currencyId: string;
  let foreignCurrencyId: string;
  let warehouseId: string;
  let priceListId: string;
  let customerId: string;
  let variantId: string;
  let editor: request.Agent;
  let reader: request.Agent;
  let noSalesRead: request.Agent;
  let noFiscal: request.Agent;
  let noInvoiceRead: request.Agent;
  let noInvoiceCreate: request.Agent;
  const users: string[] = [];
  const suffix = randomUUID();
  const password = 'Fiscal-e2e-password-1234';
  const endpoint = (id: string) => `/api/v1/fiscal/sales/${id}`;
  async function sale(
    amount = '121',
    status: SalesDocumentStatus = 'CONFIRMED',
    currency = currencyId,
  ) {
    return prisma.$transaction(async (tx) => {
      const document = await tx.salesDocument.create({
        data: {
          tenantId,
          companyId,
          warehouseId,
          priceListId,
          customerId,
          currencyId: currency,
          number: `VTA-${randomUUID()}`,
          status,
          occurredAt: new Date(),
          total: amount,
          subtotal: amount,
          lines: {
            create: {
              productVariantId: variantId,
              description: 'Frozen sale line',
              quantity: '1',
              unitPrice: amount,
              netAmount: amount,
              totalAmount: amount,
            },
          },
        },
        include: { lines: true },
      });
      // Keep historical fixtures ledger-complete so other suites' startup backfill
      // cannot change this company's balances between before/after assertions.
      if (status === 'CONFIRMED') {
        await app.get(CustomerAccountService).postSaleConfirmation(tx, {
          tenantId,
          companyId,
          customerId,
          currencyId: currency,
          salesDocumentId: document.id,
          salesDocumentNumber: document.number,
          total: document.total.toString(),
          occurredAt: document.occurredAt,
          createdBy: null,
        });
      }
      return document;
    });
  }
  const input = (
    lineId: string,
    expectedRevision = 0,
  ): SaveFiscalDraftInput => ({
    invoiceType: 'A',
    amountInterpretation: 'FINAL_AMOUNTS_INCLUDE_VAT',
    lines: [{ salesLineId: lineId, treatment: 'VAT_21' }],
    expectedRevision,
  });
  const save = (
    saleId: string,
    body: object,
    agent = editor,
    company = companyId,
  ) =>
    agent
      .post(`${endpoint(saleId)}/draft`)
      .set(COMPANY_ID_HEADER, company)
      .send(body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ArcaWsfeService)
      .useValue(wsfe)
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    // Own the listener across nested/concurrent requests; close it once in teardown.
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Fiscal tests', slug: `fiscal-${suffix}` },
      })
    ).id;
    foreignTenantId = (
      await prisma.tenant.create({
        data: {
          name: 'Foreign fiscal tenant',
          slug: `foreign-fiscal-${suffix}`,
        },
      })
    ).id;
    for (const foreign of [false, true]) {
      const c = await prisma.company.create({
        data: {
          tenantId: foreign ? foreignTenantId : tenantId,
          legalName: 'Original issuer',
          taxId: `${foreign}-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      });
      if (foreign) foreignCompanyId = c.id;
      else companyId = c.id;
    }
    currencyId = (
      await prisma.currency.upsert({
        where: { code: 'ARS' },
        update: {},
        create: { code: 'ARS', name: 'Peso', symbol: '$', decimalPlaces: 2 },
      })
    ).id;
    foreignCurrencyId = (
      await prisma.currency.create({
        data: {
          code: `F${suffix}`,
          name: 'Foreign',
          symbol: '?',
          decimalPlaces: 2,
        },
      })
    ).id;
    const scope = { tenantId, companyId };
    warehouseId = (
      await prisma.warehouse.create({
        data: {
          ...scope,
          code: 'TEST',
          name: 'Warehouse',
          allowNegativeStock: true,
        },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: { ...scope, code: 'TEST', legalName: 'Original recipient' },
      })
    ).id;
    priceListId = (
      await prisma.priceList.create({
        data: { ...scope, code: 'TEST', name: 'Prices', currencyId },
      })
    ).id;
    const unit = await prisma.unitOfMeasure.create({
      data: {
        ...scope,
        code: 'UN',
        name: 'Unit',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });
    const product = await prisma.product.create({
      data: {
        ...scope,
        code: 'TEST',
        name: 'Product',
        baseUnitId: unit.id,
        allowNegativeStock: true,
      },
    });
    variantId = (
      await prisma.productVariant.create({ data: { productId: product.id } })
    ).id;
    const bundles = [
      ['sales.invoices.read', 'sales.invoices.create', 'sales.documents.read'],
      ['sales.invoices.read'],
      ['sales.invoices.read', 'sales.invoices.create'],
      ['sales.documents.read'],
      ['sales.invoices.create', 'sales.documents.read'],
      ['sales.invoices.read', 'sales.documents.read'],
    ];
    const agents: request.Agent[] = [];
    for (const [index, codes] of bundles.entries()) {
      const user = await prisma.user.create({
        data: {
          email: `fiscal-${index}-${suffix}@example.com`,
          firstName: 'Fiscal',
          lastName: 'Test',
          passwordHash: await argon2.hash(password),
          status: 'ACTIVE',
        },
      });
      users.push(user.id);
      for (const company of index === 0
        ? [companyId, foreignCompanyId]
        : [companyId]) {
        const permissions = await Promise.all(
          codes.map((code) => {
            const [module, resource, action] = code.split('.');
            return prisma.permission.upsert({
              where: { code },
              update: {},
              create: { code, module, resource, action },
            });
          }),
        );
        const role = await prisma.role.create({
          data: {
            tenantId: company === foreignCompanyId ? foreignTenantId : tenantId,
            companyId: company,
            name: `Fiscal ${index}`,
            rolePermissions: {
              create: permissions.map((p) => ({ permissionId: p.id })),
            },
          },
        });
        await prisma.userCompany.create({
          data: {
            userId: user.id,
            tenantId: company === foreignCompanyId ? foreignTenantId : tenantId,
            companyId: company,
            active: true,
          },
        });
        await prisma.userRole.create({
          data: { userId: user.id, companyId: company, roleId: role.id },
        });
      }
      const agent = request.agent(app.getHttpServer());
      await agent
        .post('/api/v1/auth/login')
        .send({ email: user.email, password })
        .expect(200);
      agents.push(agent);
    }
    [editor, reader, noSalesRead, noFiscal, noInvoiceRead, noInvoiceCreate] =
      agents;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma && tenantId) {
      await prisma.fiscalAuthorization.deleteMany({ where: { tenantId } });
      await prisma.fiscalSettings.deleteMany({ where: { tenantId } });
      await prisma.fiscalDraft.deleteMany({ where: { tenantId } });
      await prisma.salesTender.deleteMany({
        where: { salesDocument: { tenantId } },
      });
      await prisma.salesDocumentLine.deleteMany({
        where: { salesDocument: { tenantId } },
      });
      await prisma.salesDocument.deleteMany({ where: { tenantId } });
      await prisma.customerAccountMovement.deleteMany({ where: { tenantId } });
      await prisma.stockMovement.deleteMany({ where: { tenantId } });
      await prisma.inventoryBalance.deleteMany({ where: { companyId } });
      await prisma.salesDocumentSequence.deleteMany({ where: { companyId } });
      await prisma.productVariant.deleteMany({
        where: { product: { tenantId } },
      });
      await prisma.product.deleteMany({ where: { tenantId } });
      await prisma.unitOfMeasure.deleteMany({ where: { tenantId } });
      await prisma.priceList.deleteMany({ where: { tenantId } });
      await prisma.warehouse.deleteMany({ where: { tenantId } });
      await prisma.customer.deleteMany({ where: { tenantId } });
      await prisma.auditLog.deleteMany({
        where: { OR: [{ tenantId }, { userId: { in: users } }] },
      });
      await prisma.userRole.deleteMany({ where: { userId: { in: users } } });
      await prisma.rolePermission.deleteMany({
        where: { role: { tenantId: { in: [tenantId, foreignTenantId] } } },
      });
      await prisma.role.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
      await prisma.userCompany.deleteMany({ where: { userId: { in: users } } });
      await prisma.userSession.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.company.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
      await prisma.tenant.deleteMany({
        where: { id: { in: [tenantId, foreignTenantId] } },
      });
      await prisma.currency.delete({ where: { id: foreignCurrencyId } });
    }
    await app?.close();
  });
  it('requires authentication, fiscal create and sales read; fiscal read alone only reads', async () => {
    const s = await sale();
    const body = input(s.lines[0].id);
    await request(app.getHttpServer()).get('/api/v1/fiscal/drafts').expect(401);
    for (const agent of [reader, noSalesRead, noFiscal]) {
      await save(s.id, body, agent).expect(403);
      await agent
        .get(`${endpoint(s.id)}/source`)
        .set(COMPANY_ID_HEADER, companyId)
        .expect(403);
    }
    await reader
      .get('/api/v1/fiscal/drafts')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(200);
    await noFiscal
      .get('/api/v1/fiscal/drafts')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(403);
    await reader
      .get('/api/v1/fiscal/drafts')
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(403);
  });
  it('saves one audited DRAFT without changing commercial documents or ledgers', async () => {
    const s = await sale();
    const before = await Promise.all([
      prisma.stockMovement.count({ where: { companyId } }),
      prisma.customerAccountMovement.count({ where: { companyId } }),
      prisma.treasuryMovement.count({ where: { companyId } }),
    ]);
    const response = await save(s.id, input(s.lines[0].id)).expect(201);
    const { draft } = response.body as FiscalDraftResponse;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      revision: 1,
      authorizationAvailable: false,
      totals: {
        finalAmount: '121.00',
        netAmount: '100.00',
        vatAmount: '21.00',
      },
    });
    expect(draft.pendingRequirements.length).toBeGreaterThan(0);
    expect(
      await prisma.salesDocument.findUnique({
        where: { id: s.id },
        include: { lines: true },
      }),
    ).toEqual(s);
    expect(
      await Promise.all([
        prisma.stockMovement.count({ where: { companyId } }),
        prisma.customerAccountMovement.count({ where: { companyId } }),
        prisma.treasuryMovement.count({ where: { companyId } }),
      ]),
    ).toEqual(before);
    expect(
      await prisma.auditLog.count({
        where: {
          companyId,
          entityType: 'FiscalDraft',
          entityId: draft.id,
          action: 'CREATE',
        },
      }),
    ).toBe(1);
    await reader
      .get(`/api/v1/fiscal/drafts/${draft.id}`)
      .set(COMPANY_ID_HEADER, companyId)
      .expect(200);
    await editor
      .get(`/api/v1/fiscal/drafts/${draft.id}`)
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(404);
    await editor
      .get(`${endpoint(s.id)}/source`)
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(404);
    await save(s.id, input(s.lines[0].id), editor, foreignCompanyId).expect(
      404,
    );
    const list = await editor
      .get('/api/v1/fiscal/drafts')
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(200);
    expect((list.body as FiscalDraftsResponse).items).toEqual([]);
    const lookup = await editor
      .get(`${endpoint(s.id)}/draft`)
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(200);
    expect((lookup.body as { draft: unknown }).draft).toBeNull();
  });
  it('serializes concurrent creation and editing with optimistic revision conflicts', async () => {
    const s = await sale();
    const body = input(s.lines[0].id);
    const created = await Promise.all([save(s.id, body), save(s.id, body)]);
    expect(created.map((r) => r.status).sort()).toEqual([201, 409]);
    const updated = await Promise.all([
      save(s.id, { ...body, expectedRevision: 1 }),
      save(s.id, { ...body, expectedRevision: 1 }),
    ]);
    expect(updated.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.fiscalDraft.count({
        where: { companyId, salesDocumentId: s.id },
      }),
    ).toBe(1);
    const row = await prisma.fiscalDraft.findFirstOrThrow({
      where: { companyId, salesDocumentId: s.id },
    });
    expect(row.revision).toBe(2);
    expect(
      await prisma.auditLog.count({
        where: { companyId, entityType: 'FiscalDraft', entityId: row.id },
      }),
    ).toBe(2);
  });
  it('retains issuer and recipient snapshots on edits and rejects cancelled sources', async () => {
    const s = await sale();
    const body = input(s.lines[0].id);
    const first = (await save(s.id, body).expect(201))
      .body as FiscalDraftResponse;
    await prisma.customer.update({
      where: { id: customerId },
      data: { legalName: 'Changed recipient' },
    });
    await prisma.company.update({
      where: { id: companyId },
      data: { legalName: 'Changed issuer' },
    });
    const second = (
      await save(s.id, {
        ...body,
        expectedRevision: 1,
        invoiceType: 'B',
      }).expect(201)
    ).body as FiscalDraftResponse;
    expect(second.draft.source).toEqual(first.draft.source);
    await prisma.salesDocument.update({
      where: { id: s.id },
      data: { status: 'CANCELLED' },
    });
    await save(s.id, { ...body, expectedRevision: 2 }).expect(400);
  });
  it('rejects unsupported sales and tampered line/amount/context inputs', async () => {
    for (const s of [
      await sale('121', 'DRAFT'),
      await sale('121', 'CANCELLED'),
      await sale('121', 'CONFIRMED', foreignCurrencyId),
      await sale('121.0001'),
    ])
      await save(s.id, input(s.lines[0].id)).expect(400);
    const s = await sale();
    const body = input(s.lines[0].id);
    for (const extra of [
      { total: '0' },
      { companyId: foreignCompanyId },
      { tenantId },
      { status: 'AUTHORIZED' },
    ])
      await save(s.id, { ...body, ...extra }).expect(400);
    await save(s.id, {
      ...body,
      lines: [{ salesLineId: randomUUID(), treatment: 'VAT_21' }],
    }).expect(400);
    await save(s.id, { ...body, lines: [...body.lines, ...body.lines] }).expect(
      400,
    );
    await save(s.id, { ...body, invoiceType: 'C' }).expect(400);
    expect(
      await prisma.fiscalDraft.count({
        where: { companyId, salesDocumentId: s.id },
      }),
    ).toBe(0);
  });
  it('preserves an actually confirmed sale, stock projection, tender and existing account movements', async () => {
    const draftSale = await sale('121', 'DRAFT');
    await app
      .get(SalesService)
      .confirm({ tenantId, companyId, userId: users[0] }, draftSale.id, {
        method: 'CASH',
        amountReceived: '150',
      });
    const snapshot = () =>
      Promise.all([
        prisma.salesDocument.findFirstOrThrow({
          where: { id: draftSale.id, companyId },
          include: { lines: true, tender: true },
        }),
        prisma.stockMovement.findMany({
          where: { companyId },
          orderBy: { id: 'asc' },
        }),
        prisma.inventoryBalance.findMany({
          where: { companyId },
          orderBy: { productVariantId: 'asc' },
        }),
        prisma.customerAccountMovement.findMany({
          where: { companyId },
          orderBy: { id: 'asc' },
        }),
        prisma.treasuryMovement.findMany({
          where: { companyId },
          orderBy: { id: 'asc' },
        }),
      ]);
    const before = await snapshot();
    expect(before[0].status).toBe('CONFIRMED');
    expect(before[0].tender?.amountApplied.toString()).toBe('121');
    expect(before[1].length).toBeGreaterThan(0);
    expect(before[2].length).toBeGreaterThan(0);
    expect(before[3].length).toBeGreaterThan(0);
    await save(draftSale.id, input(draftSale.lines[0].id)).expect(201);
    await save(draftSale.id, {
      ...input(draftSale.lines[0].id, 1),
      invoiceType: 'B',
    }).expect(201);
    expect(await snapshot()).toEqual(before);
  });
  it('rejects excessive pagination before it reaches Prisma', async () => {
    await editor
      .get('/api/v1/fiscal/drafts?page=1e100')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(400);
  });
  it('preview is non-persistent and save/audit failure rolls back atomically', async () => {
    const s = await sale();
    const { expectedRevision: _revision, ...body } = input(s.lines[0].id);
    await editor
      .post(`${endpoint(s.id)}/preview`)
      .set(COMPANY_ID_HEADER, companyId)
      .send(body)
      .expect(201);
    expect(
      await prisma.fiscalDraft.count({
        where: { companyId, salesDocumentId: s.id },
      }),
    ).toBe(0);
    const audit = jest
      .spyOn(app.get(AuditService), 'recordFromContext')
      .mockRejectedValueOnce(new Error('Intentional audit failure'));
    try {
      await save(s.id, input(s.lines[0].id)).expect(500);
    } finally {
      audit.mockRestore();
    }
    expect(
      await prisma.fiscalDraft.count({
        where: { companyId, salesDocumentId: s.id },
      }),
    ).toBe(0);
  });

  describe('Explicit fiscal identity refresh', () => {
    const validIssuer = {
      legalName: 'Corrected issuer',
      taxId: '30-71234567-1',
    };
    const validRecipient = {
      legalName: 'Corrected recipient',
      taxId: '20-12345678-6',
      documentType: 'CUIT' as const,
      taxCondition: 'RESPONSABLE_INSCRIPTO' as const,
    };
    const refreshBody = { expectedRevision: 1, confirmIdentityRefresh: true };
    const refresh = (
      id: string,
      body: object = refreshBody,
      agent = editor,
      company = companyId,
    ) =>
      agent
        .post(`/api/v1/fiscal/drafts/${id}/refresh-identity`)
        .set(COMPANY_ID_HEADER, company)
        .send(body);
    const authorize = (id: string) =>
      editor
        .post(`/api/v1/fiscal/drafts/${id}/authorize`)
        .set(COMPANY_ID_HEADER, companyId)
        .send({
          expectedRevision: 1,
          confirmHomologation: true,
          exclusivePointOfSale: true,
        });
    const row = (id: string) =>
      prisma.fiscalDraft.findFirstOrThrow({ where: { id, companyId } });
    function noArca() {
      expect(wsfe.validate).not.toHaveBeenCalled();
      expect(wsfe.lastNumber).not.toHaveBeenCalled();
      expect(wsfe.authorize).not.toHaveBeenCalled();
      expect(wsfe.consult).not.toHaveBeenCalled();
    }
    async function correctedMasters() {
      await prisma.company.update({
        where: { id: companyId },
        data: validIssuer,
      });
      await prisma.customer.update({
        where: { id: customerId },
        data: validRecipient,
      });
    }
    async function prepared(real = false) {
      const document = await sale('121', real ? 'DRAFT' : 'CONFIRMED');
      if (real)
        await app
          .get(SalesService)
          .confirm({ companyId, tenantId, userId: users[0] }, document.id, {
            method: 'CASH',
            amountReceived: '150',
          });
      const response = await save(
        document.id,
        input(document.lines[0].id),
      ).expect(201);
      return { document, draft: (response.body as FiscalDraftResponse).draft };
    }
    beforeEach(async () => {
      await prisma.fiscalAuthorization.deleteMany({ where: { tenantId } });
      await prisma.company.update({
        where: { id: companyId },
        data: { legalName: 'Original issuer', taxId: '20123456786' },
      });
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          legalName: 'Original recipient',
          taxId: '20123456786',
          documentType: 'CUIT',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
        },
      });
      await prisma.fiscalSettings.upsert({
        where: { companyId },
        create: {
          companyId,
          tenantId,
          vatCondition: 'RESPONSABLE_INSCRIPTO',
          testPointOfSale: 12,
          createdBy: users[0],
          updatedBy: users[0],
        },
        update: { vatCondition: 'RESPONSABLE_INSCRIPTO', testPointOfSale: 12 },
      });
      wsfe.validate.mockReset().mockResolvedValue(undefined);
      wsfe.lastNumber.mockReset().mockResolvedValue(0);
      wsfe.authorize.mockReset().mockResolvedValue(accepted);
      wsfe.consult.mockReset().mockResolvedValue(null);
    });
    it('repairs incomplete saved identity only through an explicit refresh and preserves the complete monetary snapshot and commercial ledgers', async () => {
      await prisma.company.update({
        where: { id: companyId },
        data: { legalName: 'Pending issuer', taxId: 'pending' },
      });
      await prisma.customer.update({
        where: { id: customerId },
        data: {
          legalName: 'Pending recipient',
          taxId: null,
          documentType: 'OTHER',
          taxCondition: null,
        },
      });
      const { document, draft } = await prepared(true);
      const beforeDraft = await row(draft.id);
      const beforeSnapshot = beforeDraft.snapshot as unknown as FiscalPreview;
      await correctedMasters();
      const unchanged = await editor
        .get(`/api/v1/fiscal/drafts/${draft.id}`)
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);
      expect((unchanged.body as FiscalDraftResponse).draft.source).toEqual(
        draft.source,
      );
      const ledgers = () =>
        Promise.all([
          prisma.salesDocument.findFirst({
            where: { companyId, id: document.id },
            include: { lines: true, tender: true },
          }),
          prisma.stockMovement.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
          }),
          prisma.inventoryBalance.findMany({
            where: { companyId },
            orderBy: { productVariantId: 'asc' },
          }),
          prisma.customerAccountMovement.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
          }),
          prisma.customerCollection.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
            include: { applications: true },
          }),
          prisma.treasuryMovement.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
          }),
          prisma.treasuryAccount.findMany({
            where: { companyId },
            orderBy: { id: 'asc' },
          }),
        ]);
      const beforeLedgers = await ledgers();
      const response = await refresh(draft.id).expect(201);
      expect((response.body as FiscalDraftResponse).draft).toMatchObject({
        id: draft.id,
        revision: 2,
        source: {
          issuer: validIssuer,
          recipient: {
            legalName: validRecipient.legalName,
            documentType: validRecipient.documentType,
            taxId: validRecipient.taxId,
            taxCondition: validRecipient.taxCondition,
          },
        },
      });
      const afterDraft = await row(draft.id);
      expect(afterDraft.snapshot).toEqual({
        ...beforeSnapshot,
        source: {
          ...beforeSnapshot.source,
          issuer: validIssuer,
          recipient: {
            legalName: validRecipient.legalName,
            documentType: validRecipient.documentType,
            taxId: validRecipient.taxId,
            taxCondition: validRecipient.taxCondition,
          },
        },
      });
      expect(afterDraft).toMatchObject({
        id: beforeDraft.id,
        salesDocumentId: beforeDraft.salesDocumentId,
        createdBy: beforeDraft.createdBy,
        createdAt: beforeDraft.createdAt,
        revision: 2,
      });
      expect(await ledgers()).toEqual(beforeLedgers);
      expect(
        await prisma.auditLog.findFirst({
          where: {
            companyId,
            entityType: 'FiscalDraft',
            entityId: draft.id,
            action: 'UPDATE',
          },
        }),
      ).toMatchObject({
        afterData: { operation: 'REFRESH_IDENTITY', revision: 2 },
      });
      expect(
        await prisma.fiscalAuthorization.count({
          where: { companyId, draftId: draft.id },
        }),
      ).toBe(0);
      noArca();
    });
    it('requires authentication and each of invoice read/create and sales read permissions', async () => {
      const { draft } = await prepared();
      const before = await row(draft.id);
      await request(app.getHttpServer())
        .post(`/api/v1/fiscal/drafts/${draft.id}/refresh-identity`)
        .send(refreshBody)
        .expect(401);
      for (const agent of [
        reader,
        noSalesRead,
        noFiscal,
        noInvoiceRead,
        noInvoiceCreate,
      ])
        await refresh(draft.id, refreshBody, agent).expect(403);
      expect(await row(draft.id)).toEqual(before);
      noArca();
    });
    it('rejects foreign identities, stale revisions and payload fields that could overwrite fiscal or commercial data', async () => {
      const { draft } = await prepared();
      const before = await row(draft.id);
      await refresh(draft.id, refreshBody, editor, foreignCompanyId).expect(
        404,
      );
      await refresh(randomUUID()).expect(404);
      await refresh('not-a-uuid').expect(400);
      await refresh(draft.id, { ...refreshBody, expectedRevision: 5 }).expect(
        409,
      );
      for (const body of [
        {},
        { expectedRevision: 1 },
        { ...refreshBody, confirmIdentityRefresh: false },
        { ...refreshBody, expectedRevision: 0 },
        { ...refreshBody, expectedRevision: 1.5 },
        { ...refreshBody, companyId: foreignCompanyId },
        { ...refreshBody, tenantId: foreignTenantId },
        { ...refreshBody, issuer: validIssuer },
        { ...refreshBody, recipient: validRecipient },
        { ...refreshBody, source: { total: '0.01' } },
        { ...refreshBody, invoiceType: 'C' },
      ])
        await refresh(draft.id, body).expect(400);
      expect(await row(draft.id)).toEqual(before);
      noArca();
    });
    it.each([
      ['issuer checksum', { taxId: '20123456780' }, {}],
      ['issuer format', { taxId: 'CUIT20123456786' }, {}],
      ['recipient missing CUIT', {}, { taxId: null }],
      ['recipient checksum', {}, { taxId: '20123456780' }],
      ['recipient document type', {}, { documentType: 'DNI' }],
      ['recipient unknown IVA', {}, { taxCondition: null }],
    ] as const)(
      'rejects incomplete or invalid current %s without changing the saved draft',
      async (_name, issuer, recipient) => {
        const { draft } = await prepared();
        const before = await row(draft.id);
        await prisma.company.update({ where: { id: companyId }, data: issuer });
        await prisma.customer.update({
          where: { id: customerId },
          data: recipient,
        });
        await refresh(draft.id).expect(400);
        expect(await row(draft.id)).toEqual(before);
        noArca();
      },
    );
    it.each(['CANCELLED', 'DRAFT'] as const)(
      'rejects a source sale in %s state',
      async (status) => {
        const { draft, document } = await prepared();
        const before = await row(draft.id);
        await prisma.salesDocument.update({
          where: { id: document.id },
          data: { status },
        });
        await refresh(draft.id).expect(400);
        expect(await row(draft.id)).toEqual(before);
        noArca();
      },
    );
    it('rejects an unsupported source currency or existing tax instead of refreshing an ineligible sale', async () => {
      const { draft, document } = await prepared();
      const before = await row(draft.id);
      await prisma.salesDocument.update({
        where: { id: document.id },
        data: { currencyId: foreignCurrencyId },
      });
      await refresh(draft.id).expect(400);
      await prisma.salesDocument.update({
        where: { id: document.id },
        data: { currencyId, taxTotal: '1.00' },
      });
      await refresh(draft.id).expect(400);
      expect(await row(draft.id)).toEqual(before);
      noArca();
    });
    it('rolls back both identity and revision when its audit fails', async () => {
      const { draft } = await prepared();
      const before = await row(draft.id);
      const beforeAudits = await prisma.auditLog.count({
        where: { companyId, entityType: 'FiscalDraft', entityId: draft.id },
      });
      await correctedMasters();
      const audit = jest
        .spyOn(app.get(AuditService), 'recordFromContext')
        .mockRejectedValueOnce(new Error('Refresh audit unavailable'));
      try {
        await refresh(draft.id).expect(500);
      } finally {
        audit.mockRestore();
      }
      expect(await row(draft.id)).toEqual(before);
      expect(
        await prisma.auditLog.count({
          where: { companyId, entityType: 'FiscalDraft', entityId: draft.id },
        }),
      ).toBe(beforeAudits);
      noArca();
    });
    it('serializes concurrent refreshes and a refresh racing an ordinary draft edit', async () => {
      const first = await prepared();
      await correctedMasters();
      const refreshes = await Promise.all([
        refresh(first.draft.id),
        refresh(first.draft.id),
      ]);
      expect(refreshes.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect((await row(first.draft.id)).revision).toBe(2);
      const second = await prepared();
      const edits = await Promise.all([
        refresh(second.draft.id),
        save(second.document.id, {
          ...input(second.document.lines[0].id, 1),
          invoiceType: 'B',
        }),
      ]);
      expect(edits.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect((await row(second.draft.id)).revision).toBe(2);
      expect(
        await prisma.auditLog.count({
          where: {
            companyId,
            entityType: 'FiscalDraft',
            entityId: second.draft.id,
            action: 'UPDATE',
          },
        }),
      ).toBe(1);
      noArca();
    });
    it.each(['SENDING', 'UNKNOWN', 'AUTHORIZED', 'REJECTED'])(
      'preserves the historical identity when any %s authorization already exists',
      async (status) => {
        const { draft } = await prepared();
        const existing = await prisma.fiscalAuthorization.create({
          data: {
            tenantId,
            companyId,
            draftId: draft.id,
            draftRevision: 1,
            issuerCuit: '20123456786',
            pointOfSale: 12,
            voucherType: 1,
            voucherNumber: 1,
            status,
            request: {},
            message: 'Existing attempt',
            createdBy: users[0],
            cae: status === 'AUTHORIZED' ? accepted.cae : null,
            expiresAt: status === 'AUTHORIZED' ? accepted.expiresAt : null,
          },
        });
        const before = await row(draft.id);
        await correctedMasters();
        await refresh(draft.id).expect(409);
        expect(await row(draft.id)).toEqual(before);
        expect(
          await prisma.fiscalAuthorization.findFirst({
            where: { companyId, id: existing.id },
          }),
        ).toEqual(existing);
        noArca();
      },
    );
    it('invalidates an authorization preflight when identity refresh wins the draft lock', async () => {
      const { draft } = await prepared();
      let entered!: () => void;
      let release!: () => void;
      const atPreflight = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      wsfe.validate.mockImplementationOnce(async () => {
        entered();
        await gate;
      });
      const sending = authorize(draft.id).then((response) => response);
      try {
        await Promise.race([
          atPreflight,
          sending.then((response) => {
            throw new Error(
              `Authorization finished before preflight: ${response.status}`,
            );
          }),
        ]);
        await correctedMasters();
        await refresh(draft.id).expect(201);
      } finally {
        release();
      }
      expect((await sending).status).toBe(409);
      expect((await row(draft.id)).revision).toBe(2);
      expect(
        await prisma.fiscalAuthorization.count({
          where: { companyId, draftId: draft.id },
        }),
      ).toBe(0);
      expect(wsfe.authorize).not.toHaveBeenCalled();
    });
    it('refuses refresh after authorization has claimed the draft, while the external response is still pending', async () => {
      const { draft } = await prepared();
      const before = await row(draft.id);
      let entered!: () => void;
      let release!: () => void;
      const atSend = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      wsfe.authorize.mockImplementationOnce(async () => {
        entered();
        await gate;
        return accepted;
      });
      const sending = authorize(draft.id).then((response) => response);
      try {
        await Promise.race([
          atSend,
          sending.then((response) => {
            throw new Error(
              `Authorization finished before sending: ${response.status}`,
            );
          }),
        ]);
        expect(
          await prisma.fiscalAuthorization.findFirst({
            where: { companyId, draftId: draft.id },
          }),
        ).toMatchObject({ status: 'SENDING' });
        await correctedMasters();
        await refresh(draft.id).expect(409);
        expect(await row(draft.id)).toEqual(before);
      } finally {
        release();
      }
      expect((await sending).status).toBe(201);
      expect(wsfe.authorize).toHaveBeenCalledTimes(1);
      expect(
        await prisma.fiscalAuthorization.findFirst({
          where: { companyId, draftId: draft.id },
        }),
      ).toMatchObject({ status: 'AUTHORIZED', draftRevision: 1 });
    });
  });
});
