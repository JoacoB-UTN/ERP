import type { PrismaService } from '../../src/database/prisma.service';

/**
 * Current-accounts teardown, in two phases, because the order matters in
 * both directions.
 *
 * The tables reference four entities that older suites already tear down,
 * and those suites cannot know about tables that did not exist when they
 * were written. When the ledger arrived, four unrelated suites — purchases,
 * sales, dashboard and sale-integration — started failing on
 * `prisma.supplier.deleteMany()` and `prisma.customer.deleteMany()` with a
 * foreign-key violation. One shared helper rather than the same eight lines
 * pasted into each suite: the next table added to this module has one place
 * to be registered.
 *
 * **Why two phases and not one call.** The API now runs the historical
 * backfill on startup (see docs/current-accounts.md), so any suite booting
 * `AppModule` re-posts movements for every confirmed sale or receipt that
 * has none — across the whole shared test database, not just its own
 * company. A single call that deleted movements *before* the suite deleted
 * its sales left a window: another suite's boot could re-create the
 * movements from the still-present sales, and the `customer.deleteMany()`
 * further down this teardown then failed on
 * `customer_account_movements_customerId_fkey`. That is exactly the failure
 * CI caught.
 *
 * Deleting the source documents first closes it for good: once the sales
 * and receipts are gone there is nothing left to back-fill from, so the
 * movements stay deleted no matter what boots concurrently.
 *
 * Usage in a suite's `afterAll`:
 *
 * ```ts
 * await deleteCurrentAccountsDocuments(prisma, companyIds); // phase 1
 * // ... the suite deletes its sales documents and purchase receipts ...
 * await deleteCurrentAccountsMovements(prisma, companyIds); // phase 2
 * // ... the suite deletes customers, suppliers, ...
 * ```
 */

/**
 * Phase 1 — collections, supplier payments and their applications.
 *
 * Must run **before** the suite deletes sales documents and purchase
 * receipts: an application carries a real foreign key to the document it
 * settles. The applications carry no `companyId` of their own — they are
 * scoped through their parent — so they are matched by relation.
 */
export async function deleteCurrentAccountsDocuments(
  prisma: PrismaService,
  companyIds: string[],
): Promise<void> {
  const where = { companyId: { in: companyIds } };

  await prisma.customerCollectionApplication.deleteMany({
    where: { customerCollection: where },
  });
  await prisma.supplierPaymentApplication.deleteMany({
    where: { supplierPayment: where },
  });

  await prisma.customerCollection.deleteMany({ where });
  await prisma.supplierPayment.deleteMany({ where });

  await prisma.customerCollectionSequence.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.supplierPaymentSequence.deleteMany({
    where: { companyId: { in: companyIds } },
  });
}

/**
 * Phase 2 — the two immutable ledgers.
 *
 * Must run **after** the suite has deleted its sales documents and purchase
 * receipts, so the startup backfill cannot re-create these rows from
 * documents that are still there. Movements point at their source with a
 * plain string `sourceType`/`sourceId` rather than a foreign key, so
 * deleting the documents first is allowed and is what makes this ordering
 * possible.
 */
export async function deleteCurrentAccountsMovements(
  prisma: PrismaService,
  companyIds: string[],
): Promise<void> {
  const where = { companyId: { in: companyIds } };

  await prisma.customerAccountMovement.deleteMany({ where });
  await prisma.supplierAccountMovement.deleteMany({ where });
}
