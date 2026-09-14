import { Prisma } from '../generated/prisma/client';

/**
 * Either a real `PrismaClient` or the `tx` handed to `$transaction` — the
 * startup path runs the whole backfill inside one transaction (see
 * current-accounts-backfill.service.ts) while the CLI and the seed pass the
 * client directly. `PrismaClient` is assignable to this.
 */
type BackfillClient = Prisma.TransactionClient;

export interface BackfillCurrentAccountsResult {
  salesCharges: number;
  salesSettlements: number;
  receiptAccruals: number;
  receiptReversals: number;
}

/**
 * How many source documents are loaded per round trip. The whole point of
 * batching is that this function also runs on API startup (see
 * current-accounts-backfill.service.ts), where an unbounded `findMany` over
 * every confirmed sale — and over every receipt *with its lines* — would
 * mean an installation's entire history in memory on every boot.
 */
export const BACKFILL_BATCH_SIZE = 500;

/**
 * One-time backfill for the Current Accounts ledger (see
 * docs/current-accounts.md) — posts CustomerAccountMovement/
 * SupplierAccountMovement rows for SalesDocuments and PurchaseReceipts
 * that were confirmed (or confirmed-then-cancelled) outside the live
 * SalesService/PurchaseReceiptsService code path — either genuinely
 * historical data from before this feature existed, or (as used by
 * seed.ts) demo fixtures inserted directly via `prisma.*.create` rather
 * than through the real service transactions.
 *
 * Idempotent by construction, not by a manual "did I already run this"
 * check: every insert uses `createMany({ skipDuplicates: true })` against
 * the SAME `@@unique([companyId, sourceType, sourceId, movementType])`
 * constraint the live confirm()/cancel() paths rely on — see
 * CustomerAccountService/SupplierAccountService. Calling this twice, or
 * after new sales/receipts have since been confirmed through the normal
 * live code path (which posts its own movements), inserts zero duplicate
 * rows the second time.
 *
 * Historical semantics (see docs/current-accounts.md):
 *  - SalesDocument CONFIRMED: SALE_CHARGE(+total) once; + TENDER_SETTLEMENT
 *    (-total) once if it has a SalesTender. DRAFT/CANCELLED sales: nothing
 *    (a cancelled sale never confirmed, so it never charged anything).
 *  - PurchaseReceipt CONFIRMED (current status): PURCHASE_RECEIPT_ACCRUAL
 *    once. CANCELLED but WAS confirmed before (confirmedAt is set):
 *    accrual + PURCHASE_RECEIPT_REVERSAL, both exactly once. CANCELLED
 *    and never confirmed (confirmedAt null, a direct DRAFT->CANCELLED):
 *    nothing. DRAFT: nothing.
 */
export async function backfillCurrentAccounts(
  prisma: BackfillClient,
  options: { batchSize?: number } = {},
): Promise<BackfillCurrentAccountsResult> {
  const batchSize = options.batchSize ?? BACKFILL_BATCH_SIZE;
  const salesResult = await backfillSales(prisma, batchSize);
  const receiptsResult = await backfillPurchaseReceipts(prisma, batchSize);
  return {
    salesCharges: salesResult.charges,
    salesSettlements: salesResult.settlements,
    receiptAccruals: receiptsResult.accruals,
    receiptReversals: receiptsResult.reversals,
  };
}

export function isBackfillResultEmpty(
  r: BackfillCurrentAccountsResult,
): boolean {
  return (
    r.salesCharges === 0 &&
    r.salesSettlements === 0 &&
    r.receiptAccruals === 0 &&
    r.receiptReversals === 0
  );
}

/**
 * Cheap "is there anything to post?" probe, so a normal boot costs one
 * query and loads nothing.
 *
 * It has to be an EXISTS against the movement rows, not a count comparison:
 * a sale that was confirmed and later cancelled keeps its `SALE_CHARGE`
 * (the ledger is immutable — a cancellation posts a reversal rather than
 * removing history), so the number of movements can equal or exceed the
 * number of currently-CONFIRMED sales while rows are still missing for
 * other documents.
 *
 * `sourceType`/`sourceId` is a plain string pointer rather than a foreign
 * key (see the section header in schema.prisma), so Prisma cannot express
 * this as a relation filter — hence raw SQL.
 */
export async function hasPendingCurrentAccountsBackfill(
  prisma: BackfillClient,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ pending: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (
        SELECT 1
        FROM sales_documents s
        WHERE s.status = 'CONFIRMED'
          AND NOT EXISTS (
            SELECT 1 FROM customer_account_movements m
            WHERE m."companyId" = s."companyId"
              AND m."sourceType" = 'SalesDocument'
              AND m."sourceId" = s.id
              AND m."movementType" = 'SALE_CHARGE'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM sales_documents s
        JOIN sales_tenders t ON t."salesDocumentId" = s.id
        WHERE s.status = 'CONFIRMED'
          AND NOT EXISTS (
            SELECT 1 FROM customer_account_movements m
            WHERE m."companyId" = s."companyId"
              AND m."sourceType" = 'SalesDocument'
              AND m."sourceId" = s.id
              AND m."movementType" = 'TENDER_SETTLEMENT'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM purchase_receipts r
        WHERE (r.status = 'CONFIRMED'
               OR (r.status = 'CANCELLED' AND r."confirmedAt" IS NOT NULL))
          AND NOT EXISTS (
            SELECT 1 FROM supplier_account_movements m
            WHERE m."companyId" = r."companyId"
              AND m."sourceType" = 'PurchaseReceipt'
              AND m."sourceId" = r.id
              AND m."movementType" = 'PURCHASE_RECEIPT_ACCRUAL'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM purchase_receipts r
        WHERE r.status = 'CANCELLED' AND r."confirmedAt" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM supplier_account_movements m
            WHERE m."companyId" = r."companyId"
              AND m."sourceType" = 'PurchaseReceipt'
              AND m."sourceId" = r.id
              AND m."movementType" = 'PURCHASE_RECEIPT_REVERSAL'
          )
      )
    ) AS pending
  `);
  return rows[0]?.pending === true;
}

async function backfillSales(
  prisma: BackfillClient,
  batchSize: number,
): Promise<{ charges: number; settlements: number }> {
  let charges = 0;
  let settlements = 0;
  let cursor: string | undefined;

  for (;;) {
    const sales = await prisma.salesDocument.findMany({
      where: { status: 'CONFIRMED' },
      include: { tender: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (sales.length === 0) break;
    cursor = sales[sales.length - 1].id;

    const batch = await backfillSalesBatch(prisma, sales);
    charges += batch.charges;
    settlements += batch.settlements;

    if (sales.length < batchSize) break;
  }

  return { charges, settlements };
}

type ConfirmedSale = Prisma.SalesDocumentGetPayload<{
  include: { tender: true };
}>;

async function backfillSalesBatch(
  prisma: BackfillClient,
  sales: ConfirmedSale[],
): Promise<{ charges: number; settlements: number }> {
  const chargeRows = sales.map((sale) => ({
    tenantId: sale.tenantId,
    companyId: sale.companyId,
    customerId: sale.customerId,
    currencyId: sale.currencyId,
    movementType: 'SALE_CHARGE' as const,
    amount: sale.total,
    occurredAt: sale.occurredAt,
    sourceType: 'SalesDocument',
    sourceId: sale.id,
    description: `Venta ${sale.number}`,
    createdBy: sale.createdBy,
  }));
  const charges = await prisma.customerAccountMovement.createMany({
    data: chargeRows,
    skipDuplicates: true,
  });

  const settlementRows = sales
    .filter((sale) => sale.tender)
    .map((sale) => ({
      tenantId: sale.tenantId,
      companyId: sale.companyId,
      customerId: sale.customerId,
      currencyId: sale.currencyId,
      movementType: 'TENDER_SETTLEMENT' as const,
      amount: new Prisma.Decimal(sale.total).neg(),
      occurredAt: sale.occurredAt,
      sourceType: 'SalesDocument',
      sourceId: sale.id,
      description: `Pago al momento — Venta ${sale.number}`,
      createdBy: sale.createdBy,
    }));
  const settlements = await prisma.customerAccountMovement.createMany({
    data: settlementRows,
    skipDuplicates: true,
  });

  return { charges: charges.count, settlements: settlements.count };
}

async function backfillPurchaseReceipts(
  prisma: BackfillClient,
  batchSize: number,
): Promise<{ accruals: number; reversals: number }> {
  let accruals = 0;
  let reversals = 0;
  let cursor: string | undefined;

  for (;;) {
    const receipts = await prisma.purchaseReceipt.findMany({
      where: {
        OR: [
          { status: 'CONFIRMED' },
          { status: 'CANCELLED', confirmedAt: { not: null } },
        ],
      },
      include: { lines: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (receipts.length === 0) break;
    cursor = receipts[receipts.length - 1].id;

    const batch = await backfillPurchaseReceiptsBatch(prisma, receipts);
    accruals += batch.accruals;
    reversals += batch.reversals;

    if (receipts.length < batchSize) break;
  }

  return { accruals, reversals };
}

type BackfillableReceipt = Prisma.PurchaseReceiptGetPayload<{
  include: { lines: true };
}>;

async function backfillPurchaseReceiptsBatch(
  prisma: BackfillClient,
  receipts: BackfillableReceipt[],
): Promise<{ accruals: number; reversals: number }> {
  const accrualRows = receipts.map((receipt) => {
    const total = receipt.lines.reduce(
      (sum, line) =>
        sum.add(new Prisma.Decimal(line.quantity).mul(line.unitCostSnapshot)),
      new Prisma.Decimal(0),
    );
    return {
      tenantId: receipt.tenantId,
      companyId: receipt.companyId,
      supplierId: receipt.supplierId,
      currencyId: receipt.currencyId,
      movementType: 'PURCHASE_RECEIPT_ACCRUAL' as const,
      amount: total,
      occurredAt: receipt.receiptDate,
      sourceType: 'PurchaseReceipt',
      sourceId: receipt.id,
      description: `Recepción ${receipt.number}`,
      createdBy: receipt.createdBy,
    };
  });
  const accruals = await prisma.supplierAccountMovement.createMany({
    data: accrualRows,
    skipDuplicates: true,
  });

  const cancelledAfterConfirm = receipts.filter(
    (r) => r.status === 'CANCELLED',
  );
  if (cancelledAfterConfirm.length === 0)
    return { accruals: accruals.count, reversals: 0 };

  // Reload the (possibly just-inserted) accrual rows so each reversal's
  // `reversalOfId` points at a real movement — never fabricated.
  const originals = await prisma.supplierAccountMovement.findMany({
    where: {
      sourceType: 'PurchaseReceipt',
      sourceId: { in: cancelledAfterConfirm.map((r) => r.id) },
      movementType: 'PURCHASE_RECEIPT_ACCRUAL',
    },
  });
  const originalByReceiptId = new Map(originals.map((o) => [o.sourceId, o]));

  const reversalRows = cancelledAfterConfirm
    .map((receipt) => {
      const original = originalByReceiptId.get(receipt.id);
      if (!original) return null;
      return {
        tenantId: receipt.tenantId,
        companyId: receipt.companyId,
        supplierId: receipt.supplierId,
        currencyId: receipt.currencyId,
        movementType: 'PURCHASE_RECEIPT_REVERSAL' as const,
        amount: new Prisma.Decimal(original.amount).neg(),
        occurredAt: receipt.cancelledAt ?? new Date(),
        sourceType: 'PurchaseReceipt',
        sourceId: receipt.id,
        reversalOfId: original.id,
        description: `Anulación recepción ${receipt.number}`,
        createdBy: receipt.cancelledBy,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const reversals = await prisma.supplierAccountMovement.createMany({
    data: reversalRows,
    skipDuplicates: true,
  });

  return { accruals: accruals.count, reversals: reversals.count };
}
