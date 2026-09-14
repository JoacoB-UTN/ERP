import type { PrismaService } from '../../src/database/prisma.service';

/**
 * Deletes every current-accounts row belonging to the given companies.
 *
 * Call this at the TOP of a suite's teardown, before it deletes customers,
 * suppliers, sales documents or purchase receipts.
 *
 * It exists because the current-accounts tables reference four entities that
 * older suites already tear down, and those suites cannot know about tables
 * that did not exist when they were written. When the ledger arrived, four
 * unrelated suites — purchases, sales, dashboard and sale-integration —
 * started failing on `prisma.supplier.deleteMany()` and
 * `prisma.customer.deleteMany()` with a foreign-key violation. Nothing was
 * wrong with those suites or with the ledger; the cleanup was simply
 * incomplete, and each suite failed in `afterAll`, which reads as "the whole
 * suite failed" and hides which test it was.
 *
 * One shared helper rather than the same eight lines pasted into each suite:
 * the next table added to this module has one place to be registered, and a
 * suite that forgets to call it fails loudly on its own teardown rather than
 * leaving rows behind for the next run.
 *
 * Order matters and is the reverse of the dependency direction: applications
 * point at their collection/payment and at the document they settle, so they
 * go first; the movements and the documents follow; the per-company sequences
 * last, since nothing points at them.
 */
export async function deleteCurrentAccountsData(
  prisma: PrismaService,
  companyIds: string[],
): Promise<void> {
  const where = { companyId: { in: companyIds } };

  // The two application tables carry no companyId of their own — they are
  // scoped through their parent, so they are matched by relation.
  await prisma.customerCollectionApplication.deleteMany({
    where: { customerCollection: where },
  });
  await prisma.supplierPaymentApplication.deleteMany({
    where: { supplierPayment: where },
  });

  await prisma.customerCollection.deleteMany({ where });
  await prisma.supplierPayment.deleteMany({ where });

  await prisma.customerAccountMovement.deleteMany({ where });
  await prisma.supplierAccountMovement.deleteMany({ where });

  await prisma.customerCollectionSequence.deleteMany({
    where: { companyId: { in: companyIds } },
  });
  await prisma.supplierPaymentSequence.deleteMany({
    where: { companyId: { in: companyIds } },
  });
}
