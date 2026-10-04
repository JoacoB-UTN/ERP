import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import {
  COMPANY_ID_HEADER,
  type FiscalDraftResponse,
  type FiscalDraftsResponse,
  type SaveFiscalDraftInput,
} from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { SalesService } from '../src/sales/sales.service';
import type { SalesDocumentStatus } from '../src/generated/prisma/client';

/** Isolated fixtures; run only against a disposable migrated database. */
describe('Fiscal drafts (e2e)', () => {
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
  const users: string[] = [];
  const suffix = randomUUID();
  const password = 'Fiscal-e2e-password-1234';
  const endpoint = (id: string) => `/api/v1/fiscal/sales/${id}`;
  async function sale(
    amount = '121',
    status: SalesDocumentStatus = 'CONFIRMED',
    currency = currencyId,
  ) {
    return prisma.salesDocument.create({
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
    }).compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
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
      ['sales.invoices.create'],
      ['sales.documents.read'],
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
    [editor, reader, noSalesRead, noFiscal] = agents;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma && tenantId) {
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
});
