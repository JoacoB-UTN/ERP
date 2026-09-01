import type { PrismaClient } from '../src/generated/prisma/client';
import { Prisma } from '../src/generated/prisma/client';

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
export async function backfillCurrentAccounts(prisma: PrismaClient): Promise<{
  salesCharges: number;
  salesSettlements: number;
  receiptAccruals: number;
  receiptReversals: number;
}> {
  const salesResult = await backfillSales(prisma);
  const receiptsResult = await backfillPurchaseReceipts(prisma);
  return {
    salesCharges: salesResult.charges,
    salesSettlements: salesResult.settlements,
    receiptAccruals: receiptsResult.accruals,
    receiptReversals: receiptsResult.reversals,
  };
}

async function backfillSales(prisma: PrismaClient): Promise<{ charges: number; settlements: number }> {
  const sales = await prisma.salesDocument.findMany({
    where: { status: 'CONFIRMED' },
    include: { tender: true },
  });

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

async function backfillPurchaseReceipts(prisma: PrismaClient): Promise<{ accruals: number; reversals: number }> {
  const receipts = await prisma.purchaseReceipt.findMany({
    where: {
      OR: [{ status: 'CONFIRMED' }, { status: 'CANCELLED', confirmedAt: { not: null } }],
    },
    include: { lines: true },
  });

  const accrualRows = receipts.map((receipt) => {
    const total = receipt.lines.reduce(
      (sum, line) => sum.add(new Prisma.Decimal(line.quantity).mul(line.unitCostSnapshot)),
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

  const cancelledAfterConfirm = receipts.filter((r) => r.status === 'CANCELLED');
  if (cancelledAfterConfirm.length === 0) return { accruals: accruals.count, reversals: 0 };

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
