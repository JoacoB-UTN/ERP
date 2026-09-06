// `prisma db seed` (seed.ts) is invoked by the Prisma CLI, which already
// loads `.env` itself — this script is run standalone via `tsx`, so it
// needs its own dotenv load to pick up DATABASE_URL the same way.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { backfillCurrentAccounts } from './current-accounts-backfill';

/**
 * CLI entry point for the Current Accounts backfill — see
 * current-accounts-backfill.ts for the actual (idempotent) logic, also
 * reused by seed.ts for its own demo sales/receipts.
 *
 * Run via `npm run db:backfill-current-accounts --workspace=apps/api`.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

backfillCurrentAccounts(prisma)
  .then((result) => {
    console.log('Current accounts backfill complete:', result);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
