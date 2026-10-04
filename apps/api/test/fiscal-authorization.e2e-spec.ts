import {
  ArcaWsfeService,
  type ArcaInvoiceRequest,
} from '../src/fiscal/arca-wsfe.service';
import { ArcaWsaaService } from '../src/fiscal/arca-wsaa.service';
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
  type FiscalLatestAuthorizationResponse,
  type FiscalAuthorizationResponse,
  type SaveFiscalDraftInput,
} from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { SalesService } from '../src/sales/sales.service';
import type { SalesDocumentStatus } from '../src/generated/prisma/client';

/** Isolated fixtures; run only against a disposable migrated database. */
describe('Fiscal authorization (e2e)', () => {
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
  const wsaa = {
    getTicket: jest.fn().mockResolvedValue({
      token: 'private-ticket',
      sign: 'private-sign',
      expiresAt: '2099-12-31T00:00:00Z',
    }),
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
    })
      .overrideProvider(ArcaWsfeService)
      .useValue(wsfe)
      .overrideProvider(ArcaWsaaService)
      .useValue(wsaa)
      .compile();
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
          taxId: '20123456786',
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
        data: {
          ...scope,
          code: 'TEST',
          legalName: 'Original recipient',
          documentType: 'CUIT',
          taxId: '20123456786',
          taxCondition: 'RESPONSABLE_INSCRIPTO',
        },
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
      [
        'sales.invoices.read',
        'sales.invoices.create',
        'sales.documents.read',
        'configuration.manage',
      ],
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
            const [module, resource, third] = code.split('.');
            const action = third ?? resource;
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
    for (const [index, company] of [companyId, foreignCompanyId].entries()) {
      await prisma.fiscalSettings.create({
        data: {
          companyId: company,
          tenantId: index === 0 ? tenantId : foreignTenantId,
          vatCondition: 'RESPONSABLE_INSCRIPTO',
          testPointOfSale: 12,
          createdBy: users[0],
          updatedBy: users[0],
        },
      });
    }
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    if (prisma && tenantId) {
      await prisma.fiscalAuthorization.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
      await prisma.fiscalSettings.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
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

  beforeEach(async () => {
    await prisma.fiscalAuthorization.deleteMany({ where: { tenantId } });
    wsfe.validate.mockReset().mockResolvedValue(undefined);
    wsfe.lastNumber.mockReset().mockResolvedValue(0);
    wsfe.authorize.mockReset().mockResolvedValue(accepted);
    wsfe.consult.mockReset().mockResolvedValue(null);
  });
  async function makeDraft(real = false) {
    const document = await sale('121', real ? 'DRAFT' : 'CONFIRMED');
    if (real)
      await app
        .get(SalesService)
        .confirm({ companyId, tenantId, userId: users[0] }, document.id, {
          method: 'CASH',
          amountReceived: '121',
        });
    const response = await save(
      document.id,
      input(document.lines[0].id),
    ).expect(201);
    return {
      draft: (response.body as FiscalDraftResponse).draft,
      sale: document,
    };
  }
  const acknowledgement = {
    expectedRevision: 1,
    confirmHomologation: true,
    exclusivePointOfSale: true,
  };
  const authorize = (
    id: string,
    body: object = acknowledgement,
    agent = editor,
    company = companyId,
  ) =>
    agent
      .post(`/api/v1/fiscal/drafts/${id}/authorize`)
      .set(COMPANY_ID_HEADER, company)
      .send(body);
  const reconcile = (id: string, agent = editor, company = companyId) =>
    agent
      .post(`/api/v1/fiscal/authorizations/${id}/reconcile`)
      .set(COMPANY_ID_HEADER, company)
      .send({});
  async function listed(id: string) {
    const response = await reader
      .get('/api/v1/fiscal/drafts?pageSize=100')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(200);
    return (response.body as FiscalDraftsResponse).items.find(
      (row) => row.id === id,
    )?.authorization;
  }
  it('lists only the latest company-scoped attempt without request or credential details', async () => {
    const { draft } = await makeDraft();
    expect(await listed(draft.id)).toBeNull();
    wsfe.authorize.mockResolvedValueOnce({
      status: 'REJECTED',
      cae: null,
      expiresAt: null,
      message: 'Rejected',
    });
    await authorize(draft.id).expect(201);
    expect(await listed(draft.id)).toEqual({
      status: 'REJECTED',
      pointOfSale: 12,
      voucherType: 1,
      voucherNumber: 1,
    });
    await authorize(draft.id).expect(201);
    expect(await listed(draft.id)).toEqual({
      status: 'AUTHORIZED',
      pointOfSale: 12,
      voucherType: 1,
      voucherNumber: 1,
    });
    const foreign = await editor
      .get('/api/v1/fiscal/drafts?pageSize=100')
      .set(COMPANY_ID_HEADER, foreignCompanyId)
      .expect(200);
    expect(
      (foreign.body as FiscalDraftsResponse).items.some(
        (row) => row.id === draft.id,
      ),
    ).toBe(false);
    await noFiscal
      .get('/api/v1/fiscal/drafts')
      .set(COMPANY_ID_HEADER, companyId)
      .expect(403);
  });
  it('requires explicit acknowledgements, revision and correct scoped permissions', async () => {
    const { draft } = await makeDraft();
    await authorize(draft.id, acknowledgement, reader).expect(403);
    await authorize(draft.id, acknowledgement, noSalesRead).expect(403);
    await authorize(draft.id, acknowledgement, noFiscal).expect(403);
    await authorize(draft.id, acknowledgement, editor, foreignCompanyId).expect(
      404,
    );
    await authorize(draft.id, {
      ...acknowledgement,
      confirmHomologation: false,
    }).expect(400);
    await authorize(draft.id, {
      ...acknowledgement,
      companyId: foreignCompanyId,
    }).expect(400);
    await authorize(draft.id, {
      ...acknowledgement,
      expectedRevision: 5,
    }).expect(409);
    expect(wsfe.authorize).not.toHaveBeenCalled();
  });
  it('persists before sending, serializes repeat clicks, freezes the draft and preserves real sale ledgers', async () => {
    const { draft, sale: document } = await makeDraft(true);
    const snapshot = async () =>
      Promise.all([
        prisma.salesDocument.findUnique({
          where: { id: document.id },
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
    wsfe.authorize.mockImplementation(async () => {
      expect(
        await prisma.fiscalAuthorization.findFirst({
          where: { companyId, draftId: draft.id },
        }),
      ).toMatchObject({ status: 'SENDING', voucherNumber: 1 });
      expect(await listed(draft.id)).toMatchObject({ status: 'SENDING' });
      return accepted;
    });
    const requests = await Promise.all([
      authorize(draft.id),
      authorize(draft.id),
    ]);
    expect(requests.map((r) => r.status)).toEqual([201, 201]);
    expect(wsfe.authorize).toHaveBeenCalledTimes(1);
    await authorize(draft.id).expect(201);
    expect(wsfe.authorize).toHaveBeenCalledTimes(1);
    const latest = await editor
      .get(`/api/v1/fiscal/drafts/${draft.id}/authorization`)
      .set(COMPANY_ID_HEADER, companyId)
      .expect(200);
    expect(
      (latest.body as FiscalLatestAuthorizationResponse).authorization,
    ).toMatchObject({ status: 'AUTHORIZED', cae: accepted.cae });
    await save(document.id, input(document.lines[0].id, 1)).expect(409);
    expect(await snapshot()).toEqual(before);
    expect(JSON.stringify(latest.body)).not.toMatch(
      /private-ticket|private-sign/,
    );
  });
  it('keeps uncertain sends blocked and consults the same number without resending', async () => {
    const first = await makeDraft();
    const second = await makeDraft();
    wsfe.authorize.mockRejectedValue(new Error('Uncertain network'));
    const response = await authorize(first.draft.id).expect(201);
    const attempt = (response.body as FiscalAuthorizationResponse)
      .authorization;
    expect(attempt.status).toBe('UNKNOWN');
    expect(await listed(first.draft.id)).toMatchObject({ status: 'UNKNOWN' });
    await authorize(second.draft.id).expect(409);
    await save(first.sale.id, input(first.sale.lines[0].id, 1)).expect(409);
    const missing = await reconcile(attempt.id).expect(201);
    expect(
      (missing.body as FiscalAuthorizationResponse).authorization.status,
    ).toBe('UNKNOWN');
    await reconcile(attempt.id, reader).expect(403);
    await reconcile(attempt.id, editor, foreignCompanyId).expect(404);
    wsfe.consult.mockResolvedValue(accepted);
    const found = await reconcile(attempt.id).expect(201);
    expect(
      (found.body as FiscalAuthorizationResponse).authorization,
    ).toMatchObject({ id: attempt.id, status: 'AUTHORIZED', voucherNumber: 1 });
    const consultCalls = wsfe.consult.mock.calls as [
      string,
      ArcaInvoiceRequest,
    ][];
    expect(consultCalls[0][1]).toMatchObject({
      voucherNumber: 1,
      pointOfSale: 12,
    });
    expect(wsfe.authorize).toHaveBeenCalledTimes(1);
  });
  it('blocks a pending fiscal series globally across companies with the same CUIT', async () => {
    const first = await makeDraft();
    const scope = { tenantId: foreignTenantId, companyId: foreignCompanyId };
    const warehouse = await prisma.warehouse.create({
      data: { ...scope, code: 'SERIES', name: 'Foreign warehouse' },
    });
    const customer = await prisma.customer.create({
      data: {
        ...scope,
        code: 'SERIES',
        legalName: 'Foreign recipient',
        documentType: 'CUIT',
        taxId: '20123456786',
        taxCondition: 'RESPONSABLE_INSCRIPTO',
      },
    });
    const prices = await prisma.priceList.create({
      data: { ...scope, code: 'SERIES', name: 'Foreign prices', currencyId },
    });
    const unit = await prisma.unitOfMeasure.create({
      data: {
        ...scope,
        code: 'SERIES',
        name: 'Unit',
        symbol: 'u',
        decimalPlaces: 0,
      },
    });
    const product = await prisma.product.create({
      data: {
        ...scope,
        code: 'SERIES',
        name: 'Foreign product',
        baseUnitId: unit.id,
      },
    });
    const variant = await prisma.productVariant.create({
      data: { productId: product.id },
    });
    const document = await prisma.salesDocument.create({
      data: {
        ...scope,
        warehouseId: warehouse.id,
        customerId: customer.id,
        priceListId: prices.id,
        currencyId,
        number: `VTA-${randomUUID()}`,
        status: 'CONFIRMED',
        occurredAt: new Date(),
        total: '121',
        subtotal: '121',
        lines: {
          create: {
            productVariantId: variant.id,
            description: 'Foreign frozen item',
            quantity: '1',
            unitPrice: '121',
            netAmount: '121',
            totalAmount: '121',
          },
        },
      },
      include: { lines: true },
    });
    try {
      const foreignDraft = (
        await save(
          document.id,
          input(document.lines[0].id),
          editor,
          foreignCompanyId,
        ).expect(201)
      ).body as FiscalDraftResponse;
      wsfe.authorize.mockRejectedValueOnce(new Error('Uncertain network'));
      const pending = (await authorize(first.draft.id).expect(201))
        .body as FiscalAuthorizationResponse;
      expect(pending.authorization).toMatchObject({
        status: 'UNKNOWN',
        voucherNumber: 1,
      });
      // A different number rules out active-number uniqueness as the cause:
      // the cross-company pending-series constraint itself must stop this claim.
      wsfe.lastNumber.mockResolvedValue(42);
      const blocked = await authorize(
        foreignDraft.draft.id,
        acknowledgement,
        editor,
        foreignCompanyId,
      ).expect(409);
      expect(wsfe.validate).toHaveBeenCalledWith(
        foreignCompanyId,
        expect.objectContaining({
          issuerCuit: '20123456786',
          pointOfSale: 12,
          voucherType: 1,
        }),
      );
      expect(wsfe.authorize).toHaveBeenCalledTimes(1);
      expect(
        await prisma.fiscalAuthorization.count({
          where: {
            companyId: foreignCompanyId,
            draftId: foreignDraft.draft.id,
          },
        }),
      ).toBe(0);
      expect(
        await prisma.fiscalAuthorization.findFirst({
          where: { companyId, id: pending.authorization.id },
        }),
      ).toMatchObject({ status: 'UNKNOWN', voucherNumber: 1 });
      expect(JSON.stringify(blocked.body)).not.toContain(
        pending.authorization.id,
      );
      expect(JSON.stringify(blocked.body)).not.toContain(first.draft.id);
    } finally {
      await prisma.fiscalAuthorization.deleteMany({ where: scope });
      await prisma.fiscalDraft.deleteMany({ where: scope });
      await prisma.salesDocumentLine.deleteMany({
        where: { salesDocument: scope },
      });
      await prisma.salesDocument.deleteMany({ where: scope });
      await prisma.productVariant.deleteMany({ where: { product: scope } });
      await prisma.product.deleteMany({ where: scope });
      await prisma.unitOfMeasure.deleteMany({ where: scope });
      await prisma.priceList.deleteMany({ where: scope });
      await prisma.warehouse.deleteMany({ where: scope });
      await prisma.customer.deleteMany({ where: scope });
    }
  });
  it('permits a deliberate retry after definite rejection without reserving another number', async () => {
    const { draft } = await makeDraft();
    wsfe.authorize.mockResolvedValueOnce({
      status: 'REJECTED',
      cae: null,
      expiresAt: null,
      message: 'Rechazo de pruebas',
    });
    const rejected = await authorize(draft.id).expect(201);
    expect(
      (rejected.body as FiscalAuthorizationResponse).authorization.status,
    ).toBe('REJECTED');
    const next = await authorize(draft.id).expect(201);
    expect(
      (next.body as FiscalAuthorizationResponse).authorization,
    ).toMatchObject({ status: 'AUTHORIZED', voucherNumber: 1 });
    expect(
      await prisma.fiscalAuthorization.count({
        where: { companyId, draftId: draft.id },
      }),
    ).toBe(2);
  });
  it('does not send when preflight or claim audit fails', async () => {
    const { draft } = await makeDraft();
    wsfe.validate.mockRejectedValueOnce(new Error('No certificate'));
    await authorize(draft.id).expect(503);
    const failed = jest
      .spyOn(app.get(AuditService), 'recordFromContext')
      .mockRejectedValueOnce(new Error('Audit failed'));
    try {
      await authorize(draft.id).expect(500);
    } finally {
      failed.mockRestore();
    }
    expect(wsfe.authorize).not.toHaveBeenCalled();
    expect(
      await prisma.fiscalAuthorization.count({
        where: { companyId, draftId: draft.id },
      }),
    ).toBe(0);
  });
  it('retains a durable pending attempt if result persistence fails after successful send', async () => {
    const { draft } = await makeDraft();
    const audit = app.get(AuditService);
    const original = audit.recordFromContext.bind(
      audit,
    ) as AuditService['recordFromContext'];
    const spy = jest
      .spyOn(audit, 'recordFromContext')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('Result storage failed'));
    try {
      await authorize(draft.id).expect(500);
    } finally {
      spy.mockRestore();
    }
    const row = await prisma.fiscalAuthorization.findFirstOrThrow({
      where: { companyId, draftId: draft.id },
    });
    expect(row.status).toBe('SENDING');
    await authorize(draft.id).expect(201);
    expect(wsfe.authorize).toHaveBeenCalledTimes(1);
    wsfe.consult.mockResolvedValue(accepted);
    expect(
      (
        (await reconcile(row.id).expect(201))
          .body as FiscalAuthorizationResponse
      ).authorization.status,
    ).toBe('AUTHORIZED');
  });
  it('database cannot mark a null CAE as authorized', async () => {
    const { draft } = await makeDraft();
    wsfe.authorize.mockRejectedValue(new Error('Timeout'));
    const row = (
      (await authorize(draft.id).expect(201))
        .body as FiscalAuthorizationResponse
    ).authorization;
    await expect(
      prisma.fiscalAuthorization.update({
        where: { id: row.id },
        data: { status: 'AUTHORIZED', cae: null, expiresAt: null },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.fiscalAuthorization.findFirst({
        where: { companyId, id: row.id },
      }),
    ).toMatchObject({ status: 'UNKNOWN' });
  });
  it('auth check returns no secret ticket or signature', async () => {
    await reader
      .post('/api/v1/fiscal/settings/authentication')
      .set(COMPANY_ID_HEADER, companyId)
      .send({})
      .expect(403);
    const response = await editor
      .post('/api/v1/fiscal/settings/authentication')
      .set(COMPANY_ID_HEADER, companyId)
      .send({})
      .expect(201);
    expect(response.body).toMatchObject({
      status: 'READY',
      environment: 'HOMOLOGATION',
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /private-ticket|private-sign/,
    );
  });
});
