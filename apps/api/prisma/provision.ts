import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordSchema, PERMISSION_CATALOG } from '@erp/shared';
import { PrismaClient } from '../src/generated/prisma/client';
import { ALL_PERMISSION_CODES, SYSTEM_ROLES } from './system-roles';

/**
 * Provisions a REAL, empty ERP installation.
 *
 * This is what the ERP Server installer runs on a customer's PC, and it is
 * deliberately not `seed.ts`. The seed exists to make the product
 * demonstrable: it creates "Distribuidora Horizonte", eight demo customers,
 * seventeen products and ten fabricated sales. Shipping that to a paying
 * customer would mean their first login shows somebody else's invented
 * business, and every one of those rows would then have to be deleted by hand
 * from a live system.
 *
 * What a real installation needs is only the platform scaffolding:
 *
 *   - the permission catalog (platform-defined, not business data)
 *   - the currencies the pricing module requires to function
 *   - one tenant and one company, named by the operator
 *   - the 8 system roles for that company, shared with the seed via
 *     ./system-roles so the two can never drift
 *   - one administrator account
 *
 * No customers, no products, no stock, no prices, no sales. The business
 * enters its own.
 *
 * Idempotent: re-running against an already-provisioned database updates the
 * roles to match the current catalog and leaves business data untouched. That
 * matters for upgrades, where a new release adds permission codes that
 * existing roles must pick up.
 *
 * Required environment:
 *   DATABASE_URL, ERP_COMPANY_NAME, ERP_COMPANY_TAX_ID,
 *   ERP_ADMIN_EMAIL, ERP_ADMIN_PASSWORD
 * Optional:
 *   ERP_COMPANY_COUNTRY (default AR), ERP_COMPANY_TIMEZONE
 *   (default America/Argentina/Buenos_Aires)
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to provision an ERP installation.`);
  }
  return value;
}

/** Slug for the tenant record, derived from the company name. */
function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      // Strip combining diacritics so "Ferretería" and "Ferreteria" slug alike.
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'erp'
  );
}

async function provisionPermissions(): Promise<Map<string, string>> {
  const permissionIdByCode = new Map<string, string>();

  for (const definition of PERMISSION_CATALOG) {
    const permission = await prisma.permission.upsert({
      where: { code: definition.code },
      update: {
        module: definition.module,
        resource: definition.resource,
        action: definition.action,
        description: definition.description,
      },
      create: definition,
    });
    permissionIdByCode.set(permission.code, permission.id);
  }

  return permissionIdByCode;
}

/**
 * Same role-sync semantics as the seed's: the permission set is REPLACED to
 * exactly match the definition, so an upgrade that adds a code grants it to
 * the roles that should have it rather than leaving them silently stale.
 */
async function provisionSystemRoles(
  tenantId: string,
  companyId: string,
  permissionIdByCode: Map<string, string>,
): Promise<void> {
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_name: { companyId, name: definition.name } },
      update: {
        description: definition.description,
        isSystem: true,
        active: true,
      },
      create: {
        tenantId,
        companyId,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        active: true,
      },
    });

    const codes =
      definition.permissionCodes === 'ALL'
        ? ALL_PERMISSION_CODES
        : definition.permissionCodes;
    const permissionIds = codes
      .map((code) => permissionIdByCode.get(code))
      .filter((id): id is string => Boolean(id));

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({
          roleId: role.id,
          permissionId,
        })),
        skipDuplicates: true,
      });
    }
  }
}

/**
 * Currencies are platform reference data, not business data: PricingService
 * cannot resolve a price without one, so an installation with no currency row
 * is broken out of the box.
 */
async function provisionCurrencies(): Promise<void> {
  const currencies = [
    { code: 'ARS', name: 'Peso argentino', symbol: '$', decimalPlaces: 2 },
    { code: 'USD', name: 'Dólar estadounidense', symbol: 'US$', decimalPlaces: 2 },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { name: currency.name, symbol: currency.symbol },
      create: currency,
    });
  }
}

async function main(): Promise<void> {
  const companyName = required('ERP_COMPANY_NAME');
  const taxId = required('ERP_COMPANY_TAX_ID');
  const adminEmail = required('ERP_ADMIN_EMAIL').toLowerCase();
  const adminPassword = required('ERP_ADMIN_PASSWORD');
  const countryCode = process.env.ERP_COMPANY_COUNTRY?.trim() || 'AR';
  const timezone =
    process.env.ERP_COMPANY_TIMEZONE?.trim() || 'America/Argentina/Buenos_Aires';

  // The installer collects this from the operator; refusing a weak one here
  // means the very first account on a real system cannot be the weak link.
  const policyCheck = passwordSchema.safeParse(adminPassword);
  if (!policyCheck.success) {
    throw new Error(
      `ERP_ADMIN_PASSWORD does not meet the password policy: ${policyCheck.error.issues[0].message}`,
    );
  }

  console.log(`Provisioning "${companyName}"…`);

  const permissionIdByCode = await provisionPermissions();
  await provisionCurrencies();

  const tenant = await prisma.tenant.upsert({
    where: { slug: slugify(companyName) },
    update: { name: companyName },
    create: { name: companyName, slug: slugify(companyName) },
  });

  const existingCompany = await prisma.company.findFirst({
    where: { tenantId: tenant.id, taxId },
  });

  const company = existingCompany
    ? await prisma.company.update({
        where: { id: existingCompany.id },
        data: { legalName: companyName, countryCode, timezone },
      })
    : await prisma.company.create({
        data: {
          tenantId: tenant.id,
          legalName: companyName,
          taxId,
          countryCode,
          timezone,
        },
      });

  await provisionSystemRoles(tenant.id, company.id, permissionIdByCode);

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
  const [firstName, ...restOfName] = 'Administrador'.split(' ');

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    // Re-running provisioning rotates the administrator's password — the
    // documented recovery path when it is lost, and the reason this script
    // stays idempotent.
    update: { passwordHash, status: 'ACTIVE' },
    create: {
      firstName,
      lastName: restOfName.join(' ') || 'del sistema',
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
    },
  });

  const membership = await prisma.userCompany.findFirst({
    where: { userId: user.id, companyId: company.id },
  });
  if (!membership) {
    await prisma.userCompany.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        companyId: company.id,
        active: true,
      },
    });
  }

  const adminRole = await prisma.role.findFirstOrThrow({
    where: { companyId: company.id, name: 'Administrador' },
  });
  const assignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: adminRole.id, companyId: company.id },
  });
  if (!assignment) {
    await prisma.userRole.create({
      data: { userId: user.id, roleId: adminRole.id, companyId: company.id },
    });
  }

  console.log('');
  console.log('ERP provisioned:');
  console.log(`  Empresa:  ${company.legalName} (${company.taxId})`);
  console.log(`  Permisos: ${PERMISSION_CATALOG.length}`);
  console.log(`  Roles:    ${SYSTEM_ROLES.length} roles de sistema`);
  console.log(`  Admin:    ${user.email}`);
  console.log('  Sin datos de demostración — la empresa arranca vacía.');
}

main()
  .catch((error: unknown) => {
    console.error('Provisioning failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
