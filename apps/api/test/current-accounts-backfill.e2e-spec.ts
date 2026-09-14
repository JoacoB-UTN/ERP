import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { CurrentAccountsBackfillService } from '../src/accounts/current-accounts-backfill.service';
import {
  deleteCurrentAccountsDocuments,
  deleteCurrentAccountsMovements,
} from './helpers/current-accounts-cleanup';

/** Must match CurrentAccountsBackfillService's own entityType. */
const AUDIT_ENTITY_TYPE = 'CurrentAccountsBackfill';

function expectAmount(actual: Prisma.Decimal, expected: string): void {
  expect(actual.equals(new Prisma.Decimal(expected))).toBe(true);
}

/**
 * The startup backfill, exercised the way it actually runs — see
 * docs/current-accounts.md.
 *
 * The rule this suite follows: **nothing here calls `backfillCurrentAccounts`
 * or `AuditService.record` to produce the result it then asserts.** Doing
 * that would prove the helper works, not that booting the API loads the
 * history. The fixtures go in through a SEPARATE Prisma client before any
 * Nest application exists, and the only thing that makes the backfill happen
 * is `app.init()`.
 *
 * Fixtures are inserted through Prisma rather than the HTTP endpoints on
 * purpose: "confirmed outside the live service path" is precisely what
 * historical data is, and confirming through the API would post the
 * movements itself and leave nothing to back-fill.
 */
describe('Current Accounts backfill on startup (e2e)', () => {
  const suffix = Date.now();

  let seed: PrismaClient;
  let tenantId: string;
  let companyId: string;
  let currencyId: string;
  let customerId: string;
  let supplierId: string;
  let warehouseId: string;
  let priceListId: string;

  let saleNoTenderId: string;
  let saleWithTenderId: string;
  let draftSaleId: string;
  let confirmedReceiptId: string;
  let cancelledAfterConfirmReceiptId: string;
  let neverConfirmedReceiptId: string;

  /** Set just before the first boot, so teardown removes only our own rows. */
  let bootedAt = new Date();

  const apps: INestApplication<App>[] = [];

  async function bootApp(): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // This is the whole mechanism under test: init() runs
    // onApplicationBootstrap, which runs the backfill.
    await app.init();
    apps.push(app);
    return app;
  }

  async function customerMovements() {
    return seed.customerAccountMovement.findMany({
      where: { companyId },
      orderBy: [{ sourceId: 'asc' }, { movementType: 'asc' }],
    });
  }

  async function supplierMovements() {
    return seed.supplierAccountMovement.findMany({ where: { companyId } });
  }

  beforeAll(async () => {
    seed = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });

    tenantId = (
      await seed.tenant.create({
        data: {
          name: `E2E Backfill Tenant ${suffix}`,
          slug: `e2e-backfill-tenant-${suffix}`,
        },
      })
    ).id;

    companyId = (
      await seed.company.create({
        data: {
          tenantId,
          legalName: 'E2E Backfill Company',
          taxId: `e2e-bf-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      })
    ).id;

    currencyId = (
      await seed.currency.upsert({
        where: { code: 'ARS' },
        update: {},
        create: {
          code: 'ARS',
          name: 'Peso argentino',
          symbol: '$',
          decimalPlaces: 2,
        },
      })
    ).id;

    customerId = (
      await seed.customer.create({
        data: {
          tenantId,
          companyId,
          code: `BF-C-${suffix}`,
          legalName: 'Cliente histórico',
        },
      })
    ).id;

    supplierId = (
      await seed.supplier.create({
        data: {
          tenantId,
          companyId,
          code: `BF-S-${suffix}`,
          legalName: 'Proveedor histórico',
        },
      })
    ).id;

    warehouseId = (
      await seed.warehouse.create({
        data: { tenantId, companyId, code: `BF-W-${suffix}`, name: 'Depósito' },
      })
    ).id;

    priceListId = (
      await seed.priceList.create({
        data: {
          tenantId,
          companyId,
          code: `BF-PL-${suffix}`,
          name: 'Lista',
          currencyId,
        },
      })
    ).id;

    // ---- The history, all of it before any app exists ----
    const occurredAt = new Date('2026-01-15T12:00:00.000Z');

    saleNoTenderId = (
      await seed.salesDocument.create({
        data: {
          tenantId,
          companyId,
          warehouseId,
          customerId,
          priceListId,
          currencyId,
          number: `BF-VTA-${suffix}-1`,
          status: 'CONFIRMED',
          subtotal: '1000.00',
          total: '1000.00',
          occurredAt,
          confirmedAt: occurredAt,
        },
      })
    ).id;

    saleWithTenderId = (
      await seed.salesDocument.create({
        data: {
          tenantId,
          companyId,
          warehouseId,
          customerId,
          priceListId,
          currencyId,
          number: `BF-VTA-${suffix}-2`,
          status: 'CONFIRMED',
          subtotal: '400.00',
          total: '400.00',
          occurredAt,
          confirmedAt: occurredAt,
          tender: { create: { method: 'CASH', amountApplied: '400.00' } },
        },
      })
    ).id;

    // A draft never charged anything: invisible to the backfill.
    draftSaleId = (
      await seed.salesDocument.create({
        data: {
          tenantId,
          companyId,
          warehouseId,
          customerId,
          priceListId,
          currencyId,
          number: `BF-VTA-${suffix}-3`,
          status: 'DRAFT',
          subtotal: '999.00',
          total: '999.00',
          occurredAt,
        },
      })
    ).id;

    const receiptDate = new Date('2026-02-01T12:00:00.000Z');

    confirmedReceiptId = (
      await seed.purchaseReceipt.create({
        data: {
          tenantId,
          companyId,
          supplierId,
          warehouseId,
          currencyId,
          number: `BF-REC-${suffix}-1`,
          status: 'CONFIRMED',
          receiptDate,
          confirmedAt: receiptDate,
        },
      })
    ).id;

    cancelledAfterConfirmReceiptId = (
      await seed.purchaseReceipt.create({
        data: {
          tenantId,
          companyId,
          supplierId,
          warehouseId,
          currencyId,
          number: `BF-REC-${suffix}-2`,
          status: 'CANCELLED',
          receiptDate,
          confirmedAt: receiptDate,
          cancelledAt: new Date('2026-02-05T12:00:00.000Z'),
        },
      })
    ).id;

    // Cancelled straight from draft: never accrued, nothing to post.
    neverConfirmedReceiptId = (
      await seed.purchaseReceipt.create({
        data: {
          tenantId,
          companyId,
          supplierId,
          warehouseId,
          currencyId,
          number: `BF-REC-${suffix}-3`,
          status: 'CANCELLED',
          receiptDate,
          cancelledAt: new Date('2026-02-05T12:00:00.000Z'),
        },
      })
    ).id;
  });

  afterAll(async () => {
    for (const app of apps) await app.close();

    const prisma = seed as unknown as PrismaService;
    await deleteCurrentAccountsDocuments(prisma, [companyId]);
    await seed.salesTender.deleteMany({
      where: { salesDocument: { companyId } },
    });
    await seed.salesDocumentLine.deleteMany({
      where: { salesDocument: { companyId } },
    });
    await seed.salesDocument.deleteMany({ where: { companyId } });
    await seed.purchaseReceiptLine.deleteMany({
      where: { purchaseReceipt: { companyId } },
    });
    await seed.purchaseReceipt.deleteMany({ where: { companyId } });
    // Only once the documents are gone: otherwise a sibling suite booting
    // right now re-creates these from documents that are still there.
    await deleteCurrentAccountsMovements(prisma, [companyId]);
    await seed.auditLog.deleteMany({
      where: { entityType: AUDIT_ENTITY_TYPE, occurredAt: { gte: bootedAt } },
    });
    await seed.priceList.deleteMany({ where: { companyId } });
    await seed.warehouse.deleteMany({ where: { companyId } });
    await seed.supplier.deleteMany({ where: { companyId } });
    await seed.customer.deleteMany({ where: { companyId } });
    await seed.company.deleteMany({ where: { id: companyId } });
    await seed.tenant.deleteMany({ where: { id: tenantId } });
    await seed.$disconnect();
  });

  it('starts with the documents in place and the ledger empty', async () => {
    expect(
      await seed.customerAccountMovement.count({ where: { companyId } }),
    ).toBe(0);
    expect(
      await seed.supplierAccountMovement.count({ where: { companyId } }),
    ).toBe(0);
  });

  it('loads the history when the API boots', async () => {
    bootedAt = new Date();
    const app = await bootApp();

    const movements = await customerMovements();
    const charges = movements.filter((m) => m.movementType === 'SALE_CHARGE');
    const settlements = movements.filter(
      (m) => m.movementType === 'TENDER_SETTLEMENT',
    );

    // Two confirmed sales charge; the draft does not.
    expect(charges.map((c) => c.sourceId).sort()).toEqual(
      [saleNoTenderId, saleWithTenderId].sort(),
    );
    expect(charges.some((c) => c.sourceId === draftSaleId)).toBe(false);

    // Only the sale that carried a tender settles, and it settles negative.
    expect(settlements).toHaveLength(1);
    expect(settlements[0].sourceId).toBe(saleWithTenderId);
    expectAmount(settlements[0].amount, '-400.00');
    const tenderedCharge = charges.find((c) => c.sourceId === saleWithTenderId);
    expectAmount(tenderedCharge!.amount, '400.00');

    // Receipts: accrual for both that were ever confirmed, a reversal only
    // for the one cancelled afterwards, nothing for the draft-cancelled one.
    const supplier = await supplierMovements();
    const accruals = supplier.filter(
      (m) => m.movementType === 'PURCHASE_RECEIPT_ACCRUAL',
    );
    const reversals = supplier.filter(
      (m) => m.movementType === 'PURCHASE_RECEIPT_REVERSAL',
    );
    expect(accruals.map((a) => a.sourceId).sort()).toEqual(
      [confirmedReceiptId, cancelledAfterConfirmReceiptId].sort(),
    );
    expect(accruals.some((a) => a.sourceId === neverConfirmedReceiptId)).toBe(
      false,
    );
    expect(reversals).toHaveLength(1);
    expect(reversals[0].sourceId).toBe(cancelledAfterConfirmReceiptId);
    // The reversal points at a real movement, never a fabricated id.
    const original = accruals.find(
      (a) => a.sourceId === cancelledAfterConfirmReceiptId,
    );
    expect(reversals[0].reversalOfId).toBe(original!.id);

    expect(app.get(CurrentAccountsBackfillService).getState()).toBe('complete');
  });

  it('records the audit row that boot wrote, with no invented company, tenant or actor', async () => {
    const rows = await seed.auditLog.findMany({
      where: { entityType: AUDIT_ENTITY_TYPE, occurredAt: { gte: bootedAt } },
      orderBy: { occurredAt: 'desc' },
    });

    // Written by the boot above — nothing in this suite calls audit.record.
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    expect(row.action).toBe('CREATE');
    // Platform-level event: the backfill spans every company, has no actor.
    expect(row.companyId).toBeNull();
    expect(row.tenantId).toBeNull();
    expect(row.userId).toBeNull();
  });

  it('a second boot inserts no duplicates', async () => {
    const before = await customerMovements();
    const beforeSupplier = await supplierMovements();

    await bootApp();

    expect((await customerMovements()).map((m) => m.id).sort()).toEqual(
      before.map((m) => m.id).sort(),
    );
    expect((await supplierMovements()).map((m) => m.id).sort()).toEqual(
      beforeSupplier.map((m) => m.id).sort(),
    );
  });

  it('two instances booting at the same time post the history exactly once', async () => {
    // The real shape of the problem on a LAN: two API processes starting
    // together against one database. The advisory lock is what decides that
    // one does the work and the other moves on, and `skipDuplicates` is what
    // makes it harmless if both ever got through.
    //
    // Deterministic by construction: both are awaited, and the assertion is
    // on the rows that exist afterwards, not on which instance won.
    const cleared = await seed.customerAccountMovement.deleteMany({
      where: { companyId },
    });
    expect(cleared.count).toBeGreaterThan(0);
    await seed.supplierAccountMovement.deleteMany({ where: { companyId } });

    const [first, second] = await Promise.all([bootApp(), bootApp()]);

    const movements = await customerMovements();
    const charges = movements.filter((m) => m.movementType === 'SALE_CHARGE');
    const settlements = movements.filter(
      (m) => m.movementType === 'TENDER_SETTLEMENT',
    );

    // Exactly once each, not twice: no duplicate charge, no duplicate
    // settlement, and the unique constraint was never violated.
    expect(charges).toHaveLength(2);
    expect(settlements).toHaveLength(1);
    expect(new Set(charges.map((c) => c.sourceId)).size).toBe(2);

    const supplier = await supplierMovements();
    expect(
      supplier.filter((m) => m.movementType === 'PURCHASE_RECEIPT_ACCRUAL'),
    ).toHaveLength(2);
    expect(
      supplier.filter((m) => m.movementType === 'PURCHASE_RECEIPT_REVERSAL'),
    ).toHaveLength(1);

    // Both instances end up serving current accounts. The one that lost the
    // advisory lock legitimately recorded `pending` — it skipped its own
    // pass — and resolves on its next request, which is what
    // `refreshIfPending` is for and what the readiness gate calls. Asserting
    // `getState()` directly here would be asserting who won the race.
    for (const app of [first, second]) {
      await expect(
        app.get(CurrentAccountsBackfillService).refreshIfPending(),
      ).resolves.toBe('complete');
    }

    // And the gate really does open for both, over HTTP.
    for (const app of [first, second]) {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/customer-accounts',
      );
      expect(res.status).not.toBe(503);
    }
  });

  it('a failed pass reports "failed" and keeps current accounts closed', async () => {
    const app = await bootApp();
    const service = app.get(CurrentAccountsBackfillService);
    expect(service.getState()).toBe('complete');

    // The failure is injected into a real dependency, not simulated by
    // faking the backfill's result: the transaction the pass opens rejects,
    // exactly as it would on a lost connection or a statement timeout.
    const prisma = app.get(PrismaService);
    const spy = jest
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(
        new Error('Transaction API error: Transaction already closed'),
      );

    try {
      // Force a pass with work to do, so the transaction is actually opened.
      await seed.customerAccountMovement.deleteMany({ where: { companyId } });
      await service.run('startup');

      expect(service.getState()).toBe('failed');
      expect(service.getLastError()).toContain('Transaction');

      // The API is still up — a ledger missing rows is bad, an API that
      // will not boot is worse — but current accounts refuse to answer
      // rather than report a balance built on incomplete history.
      const res = await request(app.getHttpServer()).get(
        '/api/v1/customer-accounts',
      );
      expect(res.status).toBe(503);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe(
        'CURRENT_ACCOUNTS_NOT_READY',
      );
    } finally {
      spy.mockRestore();
    }

    // And it recovers: the next pass finds the work and completes.
    await service.run('startup');
    expect(service.getState()).toBe('complete');
    expect(
      (await request(app.getHttpServer()).get('/api/v1/customer-accounts'))
        .status,
    ).not.toBe(503);
  });
});
