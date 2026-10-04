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
  type FiscalCreditNoteResponse,
  type FiscalDraftsResponse,
  type FiscalLatestAuthorizationResponse,
  type FiscalAuthorizationResponse,
  type SaveFiscalDraftInput,
} from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { SalesService } from '../src/sales/sales.service';
import { CustomerAccountService } from '../src/accounts/customer-account.service';
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
      // Keep historical fixtures complete so another suite's startup repair cannot
      // change this company's account snapshots while testing NC isolation.
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
      await prisma.fiscalCreditNoteAuthorization.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
      await prisma.fiscalCreditNoteDraft.deleteMany({
        where: { tenantId: { in: [tenantId, foreignTenantId] } },
      });
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
    await prisma.fiscalCreditNoteAuthorization.deleteMany({
      where: { tenantId },
    });
    await prisma.fiscalCreditNoteDraft.deleteMany({ where: { tenantId } });
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
  describe('credit note preparation', () => {
    const reason = 'Corrección total de comprobante de pruebas';
    const route = (id: string) =>
      `/api/v1/fiscal/authorizations/${id}/credit-note-draft`;
    const getCredit = (id: string, agent = editor, company = companyId) =>
      agent.get(route(id)).set(COMPANY_ID_HEADER, company);
    const saveCredit = (
      id: string,
      body: object = { reason, expectedRevision: 0 },
      agent = editor,
      company = companyId,
    ) => agent.post(route(id)).set(COMPANY_ID_HEADER, company).send(body);
    const result = (response: { body: unknown }) =>
      (response.body as FiscalCreditNoteResponse).draft!;
    async function original(real = false) {
      const prepared = await makeDraft(real);
      const response = await authorize(prepared.draft.id).expect(201);
      return {
        ...prepared,
        authorization: (response.body as FiscalAuthorizationResponse)
          .authorization,
      };
    }
    function clearArcaCalls() {
      wsfe.validate.mockClear();
      wsfe.lastNumber.mockClear();
      wsfe.authorize.mockClear();
      wsfe.consult.mockClear();
      wsaa.getTicket.mockClear();
    }
    function expectNoArcaCalls() {
      expect(wsfe.validate).not.toHaveBeenCalled();
      expect(wsfe.lastNumber).not.toHaveBeenCalled();
      expect(wsfe.authorize).not.toHaveBeenCalled();
      expect(wsfe.consult).not.toHaveBeenCalled();
      expect(wsaa.getTicket).not.toHaveBeenCalled();
    }
    it('saves and reopens total immutable source amounts; only reason changes by revision', async () => {
      const { draft, authorization } = await original();
      const authorized = await prisma.fiscalAuthorization.findFirstOrThrow({
        where: { companyId, id: authorization.id },
      });
      const authorizedRequest =
        authorized.request as unknown as ArcaInvoiceRequest;
      expect((await getCredit(authorization.id).expect(200)).body).toEqual({
        draft: null,
      });
      clearArcaCalls();
      await prisma.customer.update({
        where: { id: customerId },
        data: { legalName: 'Changed after original authorization' },
      });
      try {
        const created = result(
          await saveCredit(authorization.id, {
            reason: `  ${reason}  `,
            expectedRevision: 0,
          }).expect(201),
        );
        expect(created).toMatchObject({
          status: 'DRAFT',
          environment: 'HOMOLOGATION',
          revision: 1,
          reason,
          creditNoteType: 3,
          original: {
            authorizationId: authorization.id,
            issuerCuit: authorizedRequest.issuerCuit,
            pointOfSale: 12,
            voucherType: 1,
            voucherNumber: 1,
            cae: accepted.cae,
          },
          authorizedAmounts: {
            total: authorizedRequest.total,
            net: authorizedRequest.net,
            vat: authorizedRequest.vat,
            exempt: authorizedRequest.exempt,
            notTaxed: authorizedRequest.notTaxed,
            iva: authorizedRequest.iva,
          },
          invoice: {
            source: draft.source,
            lines: draft.lines,
            totals: draft.totals,
            invoiceType: draft.invoiceType,
          },
        });
        expect(created).not.toHaveProperty('cae');
        expect(created).not.toHaveProperty('voucherNumber');
        const changed = result(
          await saveCredit(authorization.id, {
            reason: 'Motivo corregido para esta preparación',
            expectedRevision: 1,
          }).expect(201),
        );
        expect(changed).toMatchObject({
          id: created.id,
          revision: 2,
          original: created.original,
          invoice: created.invoice,
          authorizedAmounts: created.authorizedAmounts,
        });
        expect(
          result(await getCredit(authorization.id, reader).expect(200)),
        ).toEqual(changed);
        await saveCredit(authorization.id, {
          reason,
          expectedRevision: 1,
        }).expect(409);
        expect(
          await prisma.fiscalCreditNoteDraft.count({
            where: { companyId, originalAuthorizationId: authorization.id },
          }),
        ).toBe(1);
        expectNoArcaCalls();
      } finally {
        await prisma.customer.update({
          where: { id: customerId },
          data: { legalName: 'Original recipient' },
        });
      }
    });
    it('serializes concurrent create and update, with exactly one winner each', async () => {
      const { authorization } = await original();
      clearArcaCalls();
      const creates = await Promise.all([
        saveCredit(authorization.id),
        saveCredit(authorization.id),
      ]);
      expect(creates.map((r) => r.status).sort()).toEqual([201, 409]);
      const updates = await Promise.all([
        saveCredit(authorization.id, {
          reason: 'Primer motivo concurrente',
          expectedRevision: 1,
        }),
        saveCredit(authorization.id, {
          reason: 'Segundo motivo concurrente',
          expectedRevision: 1,
        }),
      ]);
      expect(updates.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        result(await getCredit(authorization.id).expect(200)).revision,
      ).toBe(2);
      expect(
        await prisma.fiscalCreditNoteDraft.count({
          where: { companyId, originalAuthorizationId: authorization.id },
        }),
      ).toBe(1);
      expectNoArcaCalls();
    });
    it('requires scoped read/create permissions and rejects untrusted fields', async () => {
      const { authorization } = await original();
      clearArcaCalls();
      await getCredit(authorization.id, reader).expect(200);
      await getCredit(authorization.id, noFiscal).expect(403);
      await getCredit(authorization.id, noSalesRead).expect(403);
      await saveCredit(
        authorization.id,
        { reason, expectedRevision: 0 },
        reader,
      ).expect(403);
      await saveCredit(
        authorization.id,
        { reason, expectedRevision: 0 },
        noSalesRead,
      ).expect(403);
      await saveCredit(
        authorization.id,
        { reason, expectedRevision: 0 },
        noFiscal,
      ).expect(403);
      await getCredit(authorization.id, editor, foreignCompanyId).expect(404);
      await saveCredit(
        authorization.id,
        { reason, expectedRevision: 0 },
        editor,
        foreignCompanyId,
      ).expect(404);
      await getCredit(randomUUID()).expect(404);
      for (const body of [
        { reason, expectedRevision: 0, companyId: foreignCompanyId },
        { reason, expectedRevision: 0, total: '0.01' },
        { reason, expectedRevision: 0, cae: accepted.cae },
        { reason, expectedRevision: 0, creditNoteType: 13 },
        { reason: '    ', expectedRevision: 0 },
        { reason: 'a'.repeat(501), expectedRevision: 0 },
        { reason, expectedRevision: -1 },
      ])
        await saveCredit(authorization.id, body).expect(400);
      expect(
        await prisma.fiscalCreditNoteDraft.count({ where: { companyId } }),
      ).toBe(0);
      expectNoArcaCalls();
    });
    it.each(['SENDING', 'UNKNOWN', 'REJECTED'])(
      'rejects an original in %s state',
      async (status) => {
        const { authorization } = await original();
        await prisma.fiscalAuthorization.update({
          where: { id: authorization.id },
          data: { status, cae: null, expiresAt: null },
        });
        clearArcaCalls();
        await saveCredit(authorization.id).expect(400);
        expect(
          await prisma.fiscalCreditNoteDraft.count({ where: { companyId } }),
        ).toBe(0);
        expectNoArcaCalls();
      },
    );
    it.each([
      ['B', 6, 8],
      ['C', 11, 13],
    ] as const)(
      'maps original %s to its matching NC class',
      async (invoiceType, voucherType, creditNoteType) => {
        await prisma.customer.update({
          where: { id: customerId },
          data: { taxCondition: 'EXENTO' },
        });
        if (invoiceType === 'C')
          await prisma.fiscalSettings.update({
            where: { companyId },
            data: { vatCondition: 'MONOTRIBUTO' },
          });
        try {
          const document = await sale();
          const draft = (
            await save(document.id, {
              ...input(document.lines[0].id),
              invoiceType,
              lines: [
                {
                  salesLineId: document.lines[0].id,
                  treatment: invoiceType === 'C' ? 'C_NO_VAT' : 'VAT_21',
                },
              ],
            }).expect(201)
          ).body as FiscalDraftResponse;
          const attempt = (await authorize(draft.draft.id).expect(201))
            .body as FiscalAuthorizationResponse;
          expect(attempt.authorization.voucherType).toBe(voucherType);
          clearArcaCalls();
          const prepared = result(
            await saveCredit(attempt.authorization.id).expect(201),
          );
          expect(prepared.creditNoteType).toBe(creditNoteType);
          expect(prepared.authorizedAmounts.total).toBe('121.00');
          expect(prepared.original.voucherType).toBe(voucherType);
          expectNoArcaCalls();
        } finally {
          await prisma.customer.update({
            where: { id: customerId },
            data: { taxCondition: 'RESPONSABLE_INSCRIPTO' },
          });
          await prisma.fiscalSettings.update({
            where: { companyId },
            data: { vatCondition: 'RESPONSABLE_INSCRIPTO' },
          });
        }
      },
    );
    it('rolls back draft creation and reason updates when audit fails', async () => {
      const { authorization } = await original();
      clearArcaCalls();
      const audit = app.get(AuditService);
      let spy = jest
        .spyOn(audit, 'recordFromContext')
        .mockRejectedValueOnce(new Error('NC audit unavailable'));
      try {
        await saveCredit(authorization.id).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(
        await prisma.fiscalCreditNoteDraft.count({ where: { companyId } }),
      ).toBe(0);
      const created = result(await saveCredit(authorization.id).expect(201));
      spy = jest
        .spyOn(audit, 'recordFromContext')
        .mockRejectedValueOnce(new Error('NC audit unavailable'));
      try {
        await saveCredit(authorization.id, {
          reason: 'Un cambio que debe revertirse',
          expectedRevision: 1,
        }).expect(500);
      } finally {
        spy.mockRestore();
      }
      expect(result(await getCredit(authorization.id).expect(200))).toEqual(
        created,
      );
      expectNoArcaCalls();
    });
    it('preserves the authorized invoice, real sale, stock, balances, collections and treasury exactly', async () => {
      const { sale: document, authorization } = await original(true);
      const snapshot = () =>
        Promise.all([
          prisma.salesDocument.findUnique({
            where: { id: document.id },
            include: { lines: true, tender: true },
          }),
          prisma.fiscalAuthorization.findFirst({
            where: { companyId, id: authorization.id },
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
      const before = await snapshot();
      clearArcaCalls();
      await saveCredit(authorization.id).expect(201);
      await saveCredit(authorization.id, {
        reason: 'Cambio de motivo sin efectos comerciales',
        expectedRevision: 1,
      }).expect(201);
      await getCredit(authorization.id).expect(200);
      expect(await snapshot()).toEqual(before);
      expectNoArcaCalls();
    });
    describe('credit note authorization', () => {
      const sendNote = (
        id: string,
        body: object = acknowledgement,
        agent = editor,
        company = companyId,
      ) =>
        agent
          .post(`/api/v1/fiscal/credit-notes/${id}/authorize`)
          .set(COMPANY_ID_HEADER, company)
          .send(body);
      const latestNote = (id: string, agent = editor, company = companyId) =>
        agent
          .get(`/api/v1/fiscal/credit-notes/${id}/authorization`)
          .set(COMPANY_ID_HEADER, company);
      const consultNote = (
        id: string,
        agent = editor,
        company = companyId,
        body: object = {},
      ) =>
        agent
          .post(`/api/v1/fiscal/credit-note-authorizations/${id}/reconcile`)
          .set(COMPANY_ID_HEADER, company)
          .send(body);
      const attempt = (response: { body: unknown }) =>
        (response.body as FiscalAuthorizationResponse).authorization;
      async function prepareNote(real = false) {
        const invoice = await original(real);
        const note = result(
          await saveCredit(invoice.authorization.id).expect(201),
        );
        clearArcaCalls();
        return { ...invoice, note };
      }
      it('requires scoped read/create permissions, revision and acknowledgements without accepting fiscal payload fields', async () => {
        const { note } = await prepareNote();
        expect((await latestNote(note.id, reader).expect(200)).body).toEqual({
          authorization: null,
        });
        await latestNote(note.id, noFiscal).expect(403);
        await latestNote(note.id, noSalesRead).expect(403);
        await latestNote(note.id, editor, foreignCompanyId).expect(404);
        await latestNote(randomUUID()).expect(404);
        for (const agent of [reader, noFiscal, noSalesRead])
          await sendNote(note.id, acknowledgement, agent).expect(403);
        await sendNote(
          note.id,
          acknowledgement,
          editor,
          foreignCompanyId,
        ).expect(404);
        for (const body of [
          {},
          { ...acknowledgement, confirmHomologation: false },
          { ...acknowledgement, exclusivePointOfSale: false },
          { ...acknowledgement, companyId: foreignCompanyId },
          { ...acknowledgement, total: '0.01' },
          { ...acknowledgement, cae: accepted.cae },
          { ...acknowledgement, voucherType: 13 },
          { ...acknowledgement, expectedRevision: 0 },
        ])
          await sendNote(note.id, body).expect(400);
        await sendNote(note.id, {
          ...acknowledgement,
          expectedRevision: 5,
        }).expect(409);
        expectNoArcaCalls();
        expect(
          await prisma.fiscalCreditNoteAuthorization.count({
            where: { companyId },
          }),
        ).toBe(0);
      });
      it('commits the request before sending once, freezes the note and preserves the original and all commercial ledgers', async () => {
        const { note, sale: document, authorization } = await prepareNote(true);
        const snapshot = () =>
          Promise.all([
            prisma.salesDocument.findFirst({
              where: { id: document.id, companyId },
              include: { lines: true, tender: true },
            }),
            prisma.fiscalAuthorization.findFirst({
              where: { companyId, id: authorization.id },
            }),
            prisma.fiscalCreditNoteDraft.findFirst({
              where: { companyId, id: note.id },
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
        const before = await snapshot();
        wsfe.authorize.mockImplementation(async () => {
          const row =
            await prisma.fiscalCreditNoteAuthorization.findFirstOrThrow({
              where: { companyId, creditNoteDraftId: note.id },
            });
          expect(row).toMatchObject({
            status: 'SENDING',
            voucherType: 3,
            voucherNumber: 1,
          });
          expect(
            await prisma.auditLog.findFirst({
              where: {
                companyId,
                entityId: row.id,
                entityType: 'FiscalCreditNoteAuthorization',
                action: 'CREATE',
              },
            }),
          ).not.toBeNull();
          expect(attempt(await latestNote(note.id).expect(200))).toMatchObject({
            status: 'SENDING',
          });
          await saveCredit(authorization.id, {
            reason: 'No cambiar durante el envío',
            expectedRevision: 1,
          }).expect(409);
          return accepted;
        });
        const responses = await Promise.all([
          sendNote(note.id),
          sendNote(note.id),
        ]);
        expect(responses.map((r) => r.status)).toEqual([201, 201]);
        expect(wsfe.authorize).toHaveBeenCalledTimes(1);
        await sendNote(note.id).expect(201);
        expect(wsfe.authorize).toHaveBeenCalledTimes(1);
        const current = attempt(await latestNote(note.id, reader).expect(200));
        expect(current).toMatchObject({
          status: 'AUTHORIZED',
          cae: accepted.cae,
          draftId: note.id,
          draftRevision: 1,
          pointOfSale: 12,
          voucherType: 3,
          voucherNumber: 1,
        });
        // Invoice and NC have distinct legal numbering series and may both be number 1.
        expect(authorization).toMatchObject({
          voucherType: 1,
          voucherNumber: 1,
        });
        expect(wsfe.lastNumber).toHaveBeenCalledWith(
          companyId,
          note.original.issuerCuit,
          12,
          3,
        );
        await saveCredit(authorization.id, {
          reason: 'No cambiar después de autorizar',
          expectedRevision: 1,
        }).expect(409);
        expect(await snapshot()).toEqual(before);
        expect(JSON.stringify(current)).not.toMatch(
          /private-ticket|private-sign|recipientCuit|associated/,
        );
      });
      it('keeps uncertain sends and their series blocked, then consults exactly the stored association without resending', async () => {
        const first = await prepareNote();
        wsfe.lastNumber.mockResolvedValue(1);
        const second = await prepareNote();
        wsfe.lastNumber.mockResolvedValue(0);
        wsfe.authorize.mockRejectedValue(new Error('Uncertain NC network'));
        const sent = attempt(await sendNote(first.note.id).expect(201));
        expect(sent.status).toBe('UNKNOWN');
        const stored =
          await prisma.fiscalCreditNoteAuthorization.findFirstOrThrow({
            where: { companyId, id: sent.id },
          });
        expect(stored.request).toMatchObject({
          voucherType: 3,
          voucherNumber: 1,
          pointOfSale: 12,
          associated: {
            issuerCuit: first.note.original.issuerCuit,
            voucherType: 1,
            voucherNumber: first.authorization.voucherNumber,
            pointOfSale: 12,
            date: first.note.original.date,
          },
        });
        await sendNote(second.note.id).expect(409);
        await sendNote(first.note.id).expect(201);
        await saveCredit(first.authorization.id, {
          reason: 'Bloqueado por incertidumbre',
          expectedRevision: 1,
        }).expect(409);
        await consultNote(sent.id, reader).expect(403);
        await consultNote(sent.id, noFiscal).expect(403);
        await consultNote(sent.id, editor, foreignCompanyId).expect(404);
        await consultNote(sent.id, editor, companyId, {
          companyId: foreignCompanyId,
        }).expect(400);
        await consultNote(randomUUID()).expect(404);
        expect(attempt(await consultNote(sent.id).expect(201))).toMatchObject({
          id: sent.id,
          status: 'UNKNOWN',
        });
        wsfe.consult.mockRejectedValueOnce(
          new Error('Consult transport error'),
        );
        expect(attempt(await consultNote(sent.id).expect(201)).status).toBe(
          'UNKNOWN',
        );
        wsfe.consult.mockResolvedValue(accepted);
        expect(attempt(await consultNote(sent.id).expect(201))).toMatchObject({
          id: sent.id,
          status: 'AUTHORIZED',
          voucherNumber: 1,
        });
        for (const call of wsfe.consult.mock.calls as [string, unknown][])
          expect(call).toEqual([companyId, stored.request]);
        const calls = wsfe.consult.mock.calls.length;
        await consultNote(sent.id).expect(201);
        expect(wsfe.consult).toHaveBeenCalledTimes(calls);
        expect(wsfe.authorize).toHaveBeenCalledTimes(1);
      });
      it('blocks the pending NC series across companies with the same legal issuer without leaking the other request', async () => {
        const first = await prepareNote();
        const scope = {
          tenantId: foreignTenantId,
          companyId: foreignCompanyId,
        };
        const warehouse = await prisma.warehouse.create({
          data: { ...scope, code: 'NC-SERIES', name: 'Foreign NC warehouse' },
        });
        const customer = await prisma.customer.create({
          data: {
            ...scope,
            code: 'NC-SERIES',
            legalName: 'Foreign NC recipient',
            documentType: 'CUIT',
            taxId: '20123456786',
            taxCondition: 'RESPONSABLE_INSCRIPTO',
          },
        });
        const prices = await prisma.priceList.create({
          data: {
            ...scope,
            code: 'NC-SERIES',
            name: 'Foreign NC prices',
            currencyId,
          },
        });
        const unit = await prisma.unitOfMeasure.create({
          data: {
            ...scope,
            code: 'NC-SERIES',
            name: 'Unit',
            symbol: 'u',
            decimalPlaces: 0,
          },
        });
        const product = await prisma.product.create({
          data: {
            ...scope,
            code: 'NC-SERIES',
            name: 'Foreign NC product',
            baseUnitId: unit.id,
          },
        });
        const variant = await prisma.productVariant.create({
          data: { productId: product.id },
        });
        try {
          const document = await prisma.$transaction(async (tx) => {
            const created = await tx.salesDocument.create({
              data: {
                ...scope,
                warehouseId: warehouse.id,
                customerId: customer.id,
                priceListId: prices.id,
                currencyId,
                number: `VTA-NC-${randomUUID()}`,
                status: 'CONFIRMED',
                occurredAt: new Date(),
                total: '121',
                subtotal: '121',
                lines: {
                  create: {
                    productVariantId: variant.id,
                    description: 'Foreign NC source item',
                    quantity: '1',
                    unitPrice: '121',
                    netAmount: '121',
                    totalAmount: '121',
                  },
                },
              },
              include: { lines: true },
            });
            await app.get(CustomerAccountService).postSaleConfirmation(tx, {
              ...scope,
              customerId: customer.id,
              currencyId,
              salesDocumentId: created.id,
              salesDocumentNumber: created.number,
              total: created.total.toString(),
              occurredAt: created.occurredAt,
              createdBy: null,
            });
            return created;
          });
          const foreignDraft = (
            await save(
              document.id,
              input(document.lines[0].id),
              editor,
              foreignCompanyId,
            ).expect(201)
          ).body as FiscalDraftResponse;
          wsfe.lastNumber.mockResolvedValue(1);
          const foreignInvoice = attempt(
            await authorize(
              foreignDraft.draft.id,
              acknowledgement,
              editor,
              foreignCompanyId,
            ).expect(201),
          );
          const foreignNote = result(
            await saveCredit(
              foreignInvoice.id,
              { reason, expectedRevision: 0 },
              editor,
              foreignCompanyId,
            ).expect(201),
          );
          clearArcaCalls();
          wsfe.lastNumber.mockResolvedValue(0);
          wsfe.authorize.mockRejectedValueOnce(
            new Error('Uncertain NC network'),
          );
          const pendingNote = attempt(
            await sendNote(first.note.id).expect(201),
          );
          expect(pendingNote).toMatchObject({
            status: 'UNKNOWN',
            voucherType: 3,
            voucherNumber: 1,
          });
          // A different candidate number proves that pending-series uniqueness,
          // rather than active-number uniqueness, prevents the foreign send.
          wsfe.lastNumber.mockResolvedValue(42);
          const blocked = await sendNote(
            foreignNote.id,
            acknowledgement,
            editor,
            foreignCompanyId,
          ).expect(409);
          expect(wsfe.validate).toHaveBeenCalledWith(
            foreignCompanyId,
            expect.objectContaining({
              issuerCuit: '20123456786',
              pointOfSale: 12,
              voucherType: 3,
            }),
          );
          expect(wsfe.authorize).toHaveBeenCalledTimes(1);
          expect(
            await prisma.fiscalCreditNoteAuthorization.count({
              where: { ...scope, creditNoteDraftId: foreignNote.id },
            }),
          ).toBe(0);
          expect(
            await prisma.fiscalCreditNoteAuthorization.findFirst({
              where: { companyId, id: pendingNote.id },
            }),
          ).toMatchObject({ status: 'UNKNOWN', voucherNumber: 1 });
          expect(JSON.stringify(blocked.body)).not.toContain(pendingNote.id);
          expect(JSON.stringify(blocked.body)).not.toContain(first.note.id);
          await latestNote(first.note.id, editor, foreignCompanyId).expect(404);
          await consultNote(pendingNote.id, editor, foreignCompanyId).expect(
            404,
          );
        } finally {
          await prisma.fiscalCreditNoteAuthorization.deleteMany({
            where: scope,
          });
          await prisma.fiscalCreditNoteDraft.deleteMany({ where: scope });
          await prisma.fiscalAuthorization.deleteMany({ where: scope });
          await prisma.fiscalDraft.deleteMany({ where: scope });
          await prisma.customerAccountMovement.deleteMany({ where: scope });
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
      it('retains rejected history and allows an explicit edited retry with the same unconsumed number', async () => {
        const { note, authorization } = await prepareNote();
        wsfe.authorize.mockResolvedValueOnce({
          status: 'REJECTED',
          cae: null,
          expiresAt: null,
          message: 'Rechazo NC de pruebas',
        });
        const rejected = attempt(await sendNote(note.id).expect(201));
        expect(rejected.status).toBe('REJECTED');
        expect(attempt(await latestNote(note.id).expect(200)).id).toBe(
          rejected.id,
        );
        const updated = result(
          await saveCredit(authorization.id, {
            reason: 'Motivo revisado después del rechazo',
            expectedRevision: 1,
          }).expect(201),
        );
        expect(updated).toMatchObject({
          id: note.id,
          revision: 2,
          authorizedAmounts: note.authorizedAmounts,
        });
        await sendNote(note.id).expect(409);
        const retried = attempt(
          await sendNote(note.id, {
            ...acknowledgement,
            expectedRevision: 2,
          }).expect(201),
        );
        expect(retried).toMatchObject({
          status: 'AUTHORIZED',
          draftRevision: 2,
          voucherNumber: rejected.voucherNumber,
        });
        expect(retried.id).not.toBe(rejected.id);
        expect(
          await prisma.fiscalCreditNoteAuthorization.count({
            where: { companyId, creditNoteDraftId: note.id },
          }),
        ).toBe(2);
        expect(
          await prisma.fiscalCreditNoteAuthorization.findFirst({
            where: { companyId, id: rejected.id },
          }),
        ).toMatchObject({ status: 'REJECTED' });
        expect(wsfe.authorize).toHaveBeenCalledTimes(2);
      });
      it('never sends or claims a number when preflight or the claim audit fails', async () => {
        const { note } = await prepareNote();
        wsfe.validate.mockRejectedValueOnce(
          new Error('Certificate unavailable'),
        );
        await sendNote(note.id).expect(503);
        wsfe.lastNumber.mockRejectedValueOnce(
          new Error('Number lookup unavailable'),
        );
        await sendNote(note.id).expect(503);
        const failed = jest
          .spyOn(app.get(AuditService), 'recordFromContext')
          .mockRejectedValueOnce(new Error('Claim audit unavailable'));
        try {
          await sendNote(note.id).expect(500);
        } finally {
          failed.mockRestore();
        }
        expect(wsfe.authorize).not.toHaveBeenCalled();
        expect(
          await prisma.fiscalCreditNoteAuthorization.count({
            where: { companyId, creditNoteDraftId: note.id },
          }),
        ).toBe(0);
      });
      it('retains SENDING if result storage fails after a successful send and recovers by consultation only', async () => {
        const { note, authorization } = await prepareNote();
        const audit = app.get(AuditService);
        const originalAudit = audit.recordFromContext.bind(
          audit,
        ) as AuditService['recordFromContext'];
        const spy = jest
          .spyOn(audit, 'recordFromContext')
          .mockImplementationOnce(originalAudit)
          .mockRejectedValueOnce(new Error('NC result audit unavailable'));
        try {
          await sendNote(note.id).expect(500);
        } finally {
          spy.mockRestore();
        }
        const stored =
          await prisma.fiscalCreditNoteAuthorization.findFirstOrThrow({
            where: { companyId, creditNoteDraftId: note.id },
          });
        expect(stored).toMatchObject({ status: 'SENDING', cae: null });
        expect(attempt(await sendNote(note.id).expect(201))).toMatchObject({
          id: stored.id,
          status: 'SENDING',
        });
        await saveCredit(authorization.id, {
          reason: 'No cambiar solicitud pendiente',
          expectedRevision: 1,
        }).expect(409);
        wsfe.consult.mockResolvedValue(accepted);
        expect(attempt(await consultNote(stored.id).expect(201))).toMatchObject(
          { id: stored.id, status: 'AUTHORIZED', cae: accepted.cae },
        );
        expect(wsfe.consult).toHaveBeenCalledWith(companyId, stored.request);
        expect(wsfe.authorize).toHaveBeenCalledTimes(1);
      });
      it('requires the original point of sale and never silently redirects a saved note to current settings', async () => {
        const { note } = await prepareNote();
        await prisma.fiscalSettings.update({
          where: { companyId },
          data: { testPointOfSale: 13 },
        });
        try {
          await sendNote(note.id).expect(400);
          expectNoArcaCalls();
          expect(
            await prisma.fiscalCreditNoteAuthorization.count({
              where: { companyId },
            }),
          ).toBe(0);
        } finally {
          await prisma.fiscalSettings.update({
            where: { companyId },
            data: { testPointOfSale: 12 },
          });
        }
      });
      it('rechecks the note revision after preflight before claiming or sending', async () => {
        const { note, authorization } = await prepareNote();
        wsfe.validate.mockImplementationOnce(async () => {
          await saveCredit(authorization.id, {
            reason: 'Cambio concurrente antes de enviar',
            expectedRevision: 1,
          }).expect(201);
        });
        await sendNote(note.id).expect(409);
        expect(wsfe.authorize).not.toHaveBeenCalled();
        expect(
          await prisma.fiscalCreditNoteAuthorization.count({
            where: { companyId },
          }),
        ).toBe(0);
        expect(
          result(await getCredit(authorization.id).expect(200)).revision,
        ).toBe(2);
      });
      it('does not allow the database to mark a null CAE as authorized', async () => {
        const { note } = await prepareNote();
        wsfe.authorize.mockRejectedValue(new Error('NC timeout'));
        const pendingNote = attempt(await sendNote(note.id).expect(201));
        await expect(
          prisma.fiscalCreditNoteAuthorization.update({
            where: { id: pendingNote.id, companyId },
            data: { status: 'AUTHORIZED', cae: null, expiresAt: null },
          }),
        ).rejects.toThrow();
        expect(
          await prisma.fiscalCreditNoteAuthorization.findFirst({
            where: { companyId, id: pendingNote.id },
          }),
        ).toMatchObject({ status: 'UNKNOWN' });
      });
    });
  });
});
