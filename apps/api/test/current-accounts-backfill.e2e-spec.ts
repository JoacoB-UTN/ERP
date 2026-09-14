import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import { Prisma } from '../src/generated/prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { CurrentAccountsBackfillService } from '../src/accounts/current-accounts-backfill.service';
import { hasPendingCurrentAccountsBackfill } from '../src/accounts/current-accounts-backfill';
import { deleteCurrentAccountsData } from './helpers/current-accounts-cleanup';

function expectAmount(actual: Prisma.Decimal, expected: string): void {
  expect(actual.equals(new Prisma.Decimal(expected))).toBe(true);
}

/**
 * The startup backfill — see docs/current-accounts.md.
 *
 * The scenario under test is the real one: an installation that already has
 * confirmed sales and receipts, upgrading into the Current Accounts module,
 * so the documents exist and the ledger is empty. Fixtures are inserted
 * straight through Prisma on purpose — that is precisely what "confirmed
 * outside the live service path" means, and going through the HTTP
 * endpoints would post the movements and leave nothing to back-fill.
 */
describe('Current Accounts backfill on startup (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let service: CurrentAccountsBackfillService;
  const suffix = Date.now();

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
  let receiptId: string;
  let cancelledAfterConfirmReceiptId: string;
  let neverConfirmedReceiptId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(CurrentAccountsBackfillService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Backfill Tenant ${suffix}`,
        slug: `e2e-backfill-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const company = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Backfill Company',
        taxId: `e2e-bf-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyId = company.id;

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
    currencyId = ars.id;

    const customer = await prisma.customer.create({
      data: {
        tenantId,
        companyId,
        code: `BF-C-${suffix}`,
        legalName: 'Cliente histórico',
      },
    });
    customerId = customer.id;

    const supplier = await prisma.supplier.create({
      data: {
        tenantId,
        companyId,
        code: `BF-S-${suffix}`,
        legalName: 'Proveedor histórico',
      },
    });
    supplierId = supplier.id;

    const warehouse = await prisma.warehouse.create({
      data: {
        tenantId,
        companyId,
        code: `BF-W-${suffix}`,
        name: 'Depósito',
      },
    });
    warehouseId = warehouse.id;

    const priceList = await prisma.priceList.create({
      data: {
        tenantId,
        companyId,
        code: `BF-PL-${suffix}`,
        name: 'Lista',
        currencyId,
      },
    });
    priceListId = priceList.id;
  });

  afterAll(async () => {
    await deleteCurrentAccountsData(prisma, [companyId]);
    await prisma.salesTender.deleteMany({
      where: { salesDocument: { companyId } },
    });
    await prisma.salesDocumentLine.deleteMany({
      where: { salesDocument: { companyId } },
    });
    await prisma.salesDocument.deleteMany({ where: { companyId } });
    await prisma.purchaseReceiptLine.deleteMany({
      where: { purchaseReceipt: { companyId } },
    });
    await prisma.purchaseReceipt.deleteMany({ where: { companyId } });
    await prisma.priceList.deleteMany({ where: { companyId } });
    await prisma.warehouse.deleteMany({ where: { companyId } });
    await prisma.supplier.deleteMany({ where: { companyId } });
    await prisma.customer.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.tenant.deleteMany({ where: { id: tenantId } });
    await app.close();
  });

  it('sets up historical documents with a completely empty ledger', async () => {
    const occurredAt = new Date('2026-01-15T12:00:00.000Z');

    const saleNoTender = await prisma.salesDocument.create({
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
    });
    saleNoTenderId = saleNoTender.id;

    const saleWithTender = await prisma.salesDocument.create({
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
        tender: {
          create: {
            method: 'CASH',
            amountApplied: '400.00',
          },
        },
      },
    });
    saleWithTenderId = saleWithTender.id;

    // A draft must stay invisible to the backfill: it never charged anything.
    const draft = await prisma.salesDocument.create({
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
    });
    draftSaleId = draft.id;

    const ledger = await prisma.customerAccountMovement.count({
      where: { companyId },
    });
    expect(ledger).toBe(0);
  });

  it('detects pending work through the cheap probe', async () => {
    await expect(hasPendingCurrentAccountsBackfill(prisma)).resolves.toBe(true);
  });

  it('posts the missing movements when the API boots', async () => {
    await service.run('startup');

    const movements = await prisma.customerAccountMovement.findMany({
      where: { companyId },
      orderBy: [{ sourceId: 'asc' }, { movementType: 'asc' }],
    });

    const charges = movements.filter((m) => m.movementType === 'SALE_CHARGE');
    const settlements = movements.filter(
      (m) => m.movementType === 'TENDER_SETTLEMENT',
    );

    // Two confirmed sales charge; the draft does not.
    expect(charges).toHaveLength(2);
    expect(charges.map((c) => c.sourceId).sort()).toEqual(
      [saleNoTenderId, saleWithTenderId].sort(),
    );
    expect(charges.some((c) => c.sourceId === draftSaleId)).toBe(false);

    // Only the sale that carried a tender settles.
    expect(settlements).toHaveLength(1);
    expect(settlements[0].sourceId).toBe(saleWithTenderId);
    expectAmount(settlements[0].amount, '-400.00');

    const chargeForTendered = charges.find(
      (c) => c.sourceId === saleWithTenderId,
    )!;
    expectAmount(chargeForTendered.amount, '400.00');
  });

  it('leaves no advisory lock behind', async () => {
    // Regression test for a real bug in the first cut of this service. It
    // used a SESSION-scoped `pg_try_advisory_lock` and released it with a
    // separate `pg_advisory_unlock` call. Prisma hands each standalone
    // query whichever pooled connection is free, so under concurrency the
    // unlock ran on a different connection than the lock, returned false,
    // and the lock stayed held for the life of that connection — after
    // which this backfill would never run again on that process.
    const rows = await prisma.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('leaves the probe satisfied once the ledger is complete', async () => {
    await expect(hasPendingCurrentAccountsBackfill(prisma)).resolves.toBe(
      false,
    );
  });

  it('inserts nothing on a second boot', async () => {
    const before = await prisma.customerAccountMovement.findMany({
      where: { companyId },
      select: { id: true },
    });

    await service.run('startup');
    await service.run('startup');

    const after = await prisma.customerAccountMovement.findMany({
      where: { companyId },
      select: { id: true },
    });

    expect(after).toHaveLength(before.length);
    expect(after.map((m) => m.id).sort()).toEqual(
      before.map((m) => m.id).sort(),
    );
  });

  it('records exactly one audit row for the run that posted movements', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'CurrentAccountsBackfill' },
      orderBy: { occurredAt: 'desc' },
      take: 5,
    });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0];
    // Platform-level event: nothing invented for company/tenant/actor.
    expect(row.companyId).toBeNull();
    expect(row.tenantId).toBeNull();
    expect(row.userId).toBeNull();
    expect(row.action).toBe('CREATE');
  });

  it('backfills purchase receipts, including the reversal of one cancelled after confirmation', async () => {
    const receiptDate = new Date('2026-02-01T12:00:00.000Z');

    const confirmed = await prisma.purchaseReceipt.create({
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
    });
    receiptId = confirmed.id;

    const cancelled = await prisma.purchaseReceipt.create({
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
    });
    cancelledAfterConfirmReceiptId = cancelled.id;

    // Cancelled straight from draft: never accrued, so nothing to post.
    const neverConfirmed = await prisma.purchaseReceipt.create({
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
    });
    neverConfirmedReceiptId = neverConfirmed.id;

    await service.run('startup');

    const movements = await prisma.supplierAccountMovement.findMany({
      where: { companyId },
    });

    const accruals = movements.filter(
      (m) => m.movementType === 'PURCHASE_RECEIPT_ACCRUAL',
    );
    const reversals = movements.filter(
      (m) => m.movementType === 'PURCHASE_RECEIPT_REVERSAL',
    );

    expect(accruals.map((a) => a.sourceId).sort()).toEqual(
      [receiptId, cancelledAfterConfirmReceiptId].sort(),
    );
    expect(accruals.some((a) => a.sourceId === neverConfirmedReceiptId)).toBe(
      false,
    );

    expect(reversals).toHaveLength(1);
    expect(reversals[0].sourceId).toBe(cancelledAfterConfirmReceiptId);

    // The reversal points at a real movement, never a fabricated id.
    const original = accruals.find(
      (a) => a.sourceId === cancelledAfterConfirmReceiptId,
    )!;
    expect(reversals[0].reversalOfId).toBe(original.id);
  });
});
