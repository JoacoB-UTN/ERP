import { randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Development seed: one demo tenant/company/branch and a placeholder user.
 *
 * The placeholder user has a randomly generated (and discarded) password
 * hash — there is no login flow yet, so this account cannot authenticate
 * with anything. It only exists so future auth/authorization work has a
 * realistic row to attach to. Idempotent: safe to run repeatedly.
 */
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-organization' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-organization',
      status: 'ACTIVE',
    },
  });

  const company = await prisma.company.upsert({
    where: { tenantId_taxId: { tenantId: tenant.id, taxId: '00-00000000-0' } },
    update: {},
    create: {
      tenantId: tenant.id,
      legalName: 'Demo Company',
      tradeName: 'Demo Company',
      taxId: '00-00000000-0',
      countryCode: 'AR',
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'ACTIVE',
    },
  });

  const branch = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: {},
    create: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'MAIN',
      name: 'Main Branch',
      status: 'ACTIVE',
    },
  });

  const inertPasswordHash = await argon2.hash(randomBytes(32).toString('hex'));
  const user = await prisma.user.upsert({
    where: { email: 'admin@example.local' },
    update: {},
    create: {
      firstName: 'Admin',
      lastName: 'Placeholder',
      email: 'admin@example.local',
      passwordHash: inertPasswordHash,
      status: 'PENDING',
    },
  });

  await prisma.userCompany.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: {},
    create: {
      userId: user.id,
      tenantId: tenant.id,
      companyId: company.id,
      active: true,
    },
  });

  console.log('Seed complete:');
  console.log(`  Tenant:  ${tenant.name} (${tenant.slug})`);
  console.log(`  Company: ${company.legalName}`);
  console.log(`  Branch:  ${branch.name} (${branch.code})`);
  console.log(
    `  User:    ${user.email} (no usable password — auth not implemented yet)`,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
