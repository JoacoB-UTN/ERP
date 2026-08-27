import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordSchema, PERMISSION_CATALOG } from '@erp/shared';
import { PrismaClient, Prisma } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEV_ONLY_DEFAULT_PASSWORD = 'ChangeMe1234';

const ALL_PERMISSION_CODES = PERMISSION_CATALOG.map((p) => p.code);

/**
 * The 8 system roles created for every seeded company (see
 * docs/authorization.md and CLAUDE.md's RBAC rules). `permissionCodes:
 * 'ALL'` means "every code currently in the catalog" — ADMIN always gets
 * full access rather than a hardcoded `role === 'ADMIN'` check anywhere
 * in the authorization machinery itself.
 */
const SYSTEM_ROLES: {
  name: string;
  description: string;
  permissionCodes: 'ALL' | string[];
}[] = [
  {
    name: 'Administrador',
    description: 'Acceso completo a la administración de la empresa.',
    permissionCodes: 'ALL',
  },
  {
    name: 'Gerente',
    description:
      'Visión amplia de la operación, sin administración de seguridad.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'administration.company.read',
      'administration.branches.read',
      'customers.read',
      'customers.create',
      'customers.update',
      'customers.deactivate',
      'products.read',
      'products.create',
      'products.update',
      'products.deactivate',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'inventory.adjustments.read',
      'inventory.adjustments.create',
      'inventory.adjustments.confirm',
      'pricing.lists.read',
      'pricing.lists.create',
      'pricing.lists.update',
      'pricing.lists.deactivate',
      'pricing.prices.read',
      'pricing.prices.update',
      'pricing.prices.bulk_update',
      'sales.orders.read',
      'sales.invoices.read',
      'sales.documents.read',
      'sales.documents.create',
      'sales.documents.update',
      'sales.documents.confirm',
      'sales.documents.cancel',
      'purchases.suppliers.read',
      'purchases.orders.read',
      'purchases.goods-receipts.read',
      'treasury.read',
      'accounting.read',
      'reports.read',
    ],
  },
  {
    name: 'Ventas',
    description: 'Vende y factura en Facturación.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'customers.read',
      'customers.create',
      'customers.update',
      'products.read',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'sales.orders.read',
      'sales.orders.create',
      'sales.orders.update',
      'sales.invoices.read',
      'sales.invoices.create',
      'sales.documents.read',
      'sales.documents.create',
      'sales.documents.update',
      'sales.documents.confirm',
    ],
  },
  {
    name: 'Depósito',
    description: 'Gestiona stock e inventario.',
    permissionCodes: [
      'apps.gestion.access',
      'products.read',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'inventory.adjustments.read',
      'inventory.adjustments.create',
      'inventory.transfers.create',
      'sales.documents.read',
    ],
  },
  {
    name: 'Compras',
    description: 'Gestiona proveedores, órdenes de compra y recepciones.',
    permissionCodes: [
      'apps.gestion.access',
      'products.read',
      'products.create',
      'products.update',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'purchases.suppliers.read',
      'purchases.suppliers.create',
      'purchases.suppliers.update',
      'purchases.suppliers.deactivate',
      'purchases.orders.read',
      'purchases.orders.create',
      'purchases.orders.update',
      'purchases.orders.approve',
      'purchases.orders.cancel',
      'purchases.goods-receipts.read',
      'purchases.goods-receipts.create',
      'purchases.goods-receipts.confirm',
      'purchases.goods-receipts.cancel',
    ],
  },
  {
    name: 'Tesorería',
    description: 'Gestiona cobros y pagos.',
    permissionCodes: [
      'apps.gestion.access',
      'apps.facturacion.access',
      'customers.read',
      'treasury.read',
      'treasury.receipts.create',
      'treasury.payments.create',
    ],
  },
  {
    name: 'Contabilidad',
    description: 'Gestiona asientos contables.',
    permissionCodes: [
      'apps.gestion.access',
      'customers.read',
      'products.read',
      'pricing.prices.read',
      'accounting.read',
      'accounting.entries.create',
      'accounting.entries.post',
      'reports.read',
    ],
  },
  {
    name: 'Solo lectura',
    description: 'Acceso de solo lectura a la operación.',
    permissionCodes: [
      'apps.gestion.access',
      'administration.company.read',
      'administration.branches.read',
      'customers.read',
      'products.read',
      'inventory.stock.read',
      'inventory.movements.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'sales.orders.read',
      'sales.invoices.read',
      'sales.documents.read',
      'purchases.suppliers.read',
      'purchases.orders.read',
      'purchases.goods-receipts.read',
      'treasury.read',
      'accounting.read',
      'reports.read',
    ],
  },
];

/**
 * Upserts every system role for one company and replaces its permission
 * set to exactly match SYSTEM_ROLES (so editing this list and re-seeding
 * keeps roles in sync — deterministic, no duplication on repeated runs).
 */
async function seedSystemRoles(
  tenantId: string,
  companyId: string,
  permissionIdByCode: Map<string, string>,
) {
  const roleByName = new Map<string, string>();

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
    roleByName.set(definition.name, role.id);

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
      });
    }
  }

  return roleByName;
}

/**
 * A realistic customer roster for the demo company (Distribuidora
 * Horizonte S.R.L.) — see docs/customers.md and docs/demo-guide.md. ~16
 * customers: Consumidor Final (required by POS/Facturación, kept at code
 * 000001), a mix of companies/individuals/small businesses, varied tax
 * conditions and categories, and one INACTIVE record for data-quality
 * variety (never used in the rehearsed demo flow). All names/CUITs/DNIs
 * are fictional. Idempotent: customers upsert by companyId+code;
 * addresses/contacts have no natural unique key, so they're created only
 * if not already present.
 */
async function seedDemoCustomers(tenantId: string, companyId: string) {
  const categoryByName = new Map<string, string>();
  for (const name of ['Mayorista', 'Minorista', 'VIP']) {
    const category = await prisma.customerCategory.upsert({
      where: { companyId_name: { companyId, name } },
      update: {},
      create: { tenantId, companyId, name },
    });
    categoryByName.set(name, category.id);
  }

  async function upsertCustomer(params: {
    code: string;
    customerType: 'COMPANY' | 'INDIVIDUAL' | 'FINAL_CONSUMER';
    legalName: string;
    tradeName?: string;
    documentType?: 'CUIT' | 'DNI';
    taxId?: string;
    taxCondition:
      | 'CONSUMIDOR_FINAL'
      | 'RESPONSABLE_INSCRIPTO'
      | 'MONOTRIBUTO'
      | 'EXENTO';
    email?: string;
    phone?: string;
    categoryNames?: string[];
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const customer = await prisma.customer.upsert({
      where: { companyId_code: { companyId, code: params.code } },
      update: {
        legalName: params.legalName,
        tradeName: params.tradeName,
        documentType: params.documentType,
        taxId: params.taxId,
        taxCondition: params.taxCondition,
        status: params.status ?? 'ACTIVE',
      },
      create: {
        tenantId,
        companyId,
        code: params.code,
        customerType: params.customerType,
        legalName: params.legalName,
        tradeName: params.tradeName,
        documentType: params.documentType,
        taxId: params.taxId,
        taxCondition: params.taxCondition,
        email: params.email,
        phone: params.phone,
        status: params.status ?? 'ACTIVE',
      },
    });
    for (const name of params.categoryNames ?? []) {
      const categoryId = categoryByName.get(name);
      if (!categoryId) continue;
      const existingAssignment =
        await prisma.customerCategoryAssignment.findUnique({
          where: {
            customerId_categoryId: { customerId: customer.id, categoryId },
          },
        });
      if (!existingAssignment) {
        await prisma.customerCategoryAssignment.create({
          data: { customerId: customer.id, categoryId },
        });
      }
    }
    return customer;
  }

  async function ensureAddress(
    customerId: string,
    type: 'FISCAL',
    data: {
      street: string;
      number?: string;
      city: string;
      province: string;
      postalCode: string;
      isDefault?: boolean;
    },
  ) {
    const existing = await prisma.customerAddress.findFirst({
      where: { customerId, type },
    });
    if (existing) return existing;
    return prisma.customerAddress.create({
      data: { customerId, type, countryCode: 'AR', ...data },
    });
  }

  async function ensureContact(
    customerId: string,
    name: string,
    data: {
      role?: string;
      email?: string;
      phone?: string;
      isPrimary?: boolean;
    },
  ) {
    const existing = await prisma.customerContact.findFirst({
      where: { customerId, name },
    });
    if (existing) return existing;
    return prisma.customerContact.create({
      data: { customerId, name, ...data },
    });
  }

  // 000001 — required by POS/Facturación's default "no customer picked
  // yet" fast path and by docs/pos.md's own examples. Never renumbered.
  await upsertCustomer({
    code: '000001',
    customerType: 'FINAL_CONSUMER',
    legalName: 'Consumidor Final',
    taxCondition: 'CONSUMIDOR_FINAL',
  });

  // The flagship, easy-to-search demo customer (see docs/demo-guide.md's
  // rehearsed script) — a believable local hardware store.
  const ferreteria = await upsertCustomer({
    code: '000002',
    customerType: 'COMPANY',
    legalName: 'Ferretería El Puente S.R.L.',
    tradeName: 'Ferretería El Puente',
    documentType: 'CUIT',
    taxId: '30712345671',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'ventas@ferreteriaelpuente.example',
    phone: '011-4555-0100',
    categoryNames: ['Minorista'],
  });
  await ensureAddress(ferreteria.id, 'FISCAL', {
    street: 'Av. Corrientes',
    number: '1234',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1043AAZ',
    isDefault: true,
  });
  await ensureContact(ferreteria.id, 'María López', {
    role: 'Compras',
    email: 'maria.lopez@ferreteriaelpuente.example',
    phone: '011-4555-0101',
    isPrimary: true,
  });

  const kiosco = await upsertCustomer({
    code: '000003',
    customerType: 'INDIVIDUAL',
    legalName: 'Alberto Ezequiel Suárez',
    tradeName: 'Kiosco Don Alberto',
    documentType: 'DNI',
    taxId: '25987654',
    taxCondition: 'MONOTRIBUTO',
    phone: '011-4555-0210',
    categoryNames: ['Minorista'],
  });
  await ensureAddress(kiosco.id, 'FISCAL', {
    street: 'Av. Rivadavia',
    number: '4820',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1424',
    isDefault: true,
  });

  const cafeteria = await upsertCustomer({
    code: '000004',
    customerType: 'COMPANY',
    legalName: 'Aroma Cafetería S.H.',
    tradeName: 'Cafetería Aroma',
    documentType: 'CUIT',
    taxId: '30712398767',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    phone: '011-4555-0330',
    categoryNames: ['Minorista'],
  });
  await ensureAddress(cafeteria.id, 'FISCAL', {
    street: 'Gorriti',
    number: '3312',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1414',
    isDefault: true,
  });

  const estudio = await upsertCustomer({
    code: '000005',
    customerType: 'COMPANY',
    legalName: 'Fernández & Asociados Estudio Contable S.R.L.',
    tradeName: 'Estudio Fernández & Asociados',
    documentType: 'CUIT',
    taxId: '30711122334',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'administracion@fernandezasociados.example',
    phone: '011-4555-0440',
    categoryNames: ['VIP'],
  });
  await ensureAddress(estudio.id, 'FISCAL', {
    street: 'Av. Callao',
    number: '987',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1023',
    isDefault: true,
  });

  const distribuidora = await upsertCustomer({
    code: '000006',
    customerType: 'COMPANY',
    legalName: 'Distribuidora Sur Insumos S.A.',
    tradeName: 'Distribuidora Sur Insumos',
    documentType: 'CUIT',
    taxId: '30713344555',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'compras@surinsumos.example',
    phone: '0291-456-7890',
    categoryNames: ['Mayorista'],
  });
  await ensureAddress(distribuidora.id, 'FISCAL', {
    street: 'San Martín',
    number: '567',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
    postalCode: 'B8000',
    isDefault: true,
  });
  await ensureContact(distribuidora.id, 'Carlos Díaz', {
    role: 'Compras',
    phone: '0291-456-7891',
    isPrimary: true,
  });

  await upsertCustomer({
    code: '000007',
    customerType: 'INDIVIDUAL',
    legalName: 'Rosa Beatriz Giménez',
    tradeName: 'Almacén La Esquina',
    documentType: 'DNI',
    taxId: '22456789',
    taxCondition: 'MONOTRIBUTO',
    phone: '011-4555-0550',
    categoryNames: ['Minorista'],
  });

  await upsertCustomer({
    code: '000008',
    customerType: 'COMPANY',
    legalName: 'Panadería San Roque S.H.',
    tradeName: 'Panadería San Roque',
    documentType: 'CUIT',
    taxId: '30712233458',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    phone: '011-4555-0660',
    categoryNames: ['Minorista'],
  });

  const libreria = await upsertCustomer({
    code: '000009',
    customerType: 'COMPANY',
    legalName: 'Librería Central S.A.',
    tradeName: 'Librería Central',
    documentType: 'CUIT',
    taxId: '30714455660',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'pedidos@libreriacentral.example',
    phone: '011-4555-0770',
    categoryNames: ['Mayorista'],
  });
  await ensureAddress(libreria.id, 'FISCAL', {
    street: 'Florida',
    number: '250',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1005',
    isDefault: true,
  });

  await upsertCustomer({
    code: '000010',
    customerType: 'INDIVIDUAL',
    legalName: 'Juan Carlos Pereyra',
    documentType: 'DNI',
    taxId: '30456789',
    taxCondition: 'CONSUMIDOR_FINAL',
    phone: '011-4555-0880',
  });

  await upsertCustomer({
    code: '000011',
    customerType: 'INDIVIDUAL',
    legalName: 'María Eugenia Torres',
    documentType: 'DNI',
    taxId: '28123456',
    taxCondition: 'CONSUMIDOR_FINAL',
    email: 'meugenia.torres@example.com',
  });

  const hotel = await upsertCustomer({
    code: '000012',
    customerType: 'COMPANY',
    legalName: 'Hotel Las Acacias S.A.',
    tradeName: 'Hotel Las Acacias',
    documentType: 'CUIT',
    taxId: '30715566776',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'compras@hotellasacacias.example',
    phone: '0291-456-9900',
    categoryNames: ['VIP'],
  });
  await ensureAddress(hotel.id, 'FISCAL', {
    street: 'Av. Alem',
    number: '1450',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
    postalCode: 'B8000',
    isDefault: true,
  });

  await upsertCustomer({
    code: '000013',
    customerType: 'INDIVIDUAL',
    legalName: 'Roberto Gómez',
    tradeName: 'Taller Mecánico Gómez',
    documentType: 'DNI',
    taxId: '24678912',
    taxCondition: 'MONOTRIBUTO',
    phone: '0291-456-1020',
    categoryNames: ['Minorista'],
  });

  const sur = await upsertCustomer({
    code: '000014',
    customerType: 'COMPANY',
    legalName: 'Comercial del Sur S.R.L.',
    tradeName: 'Comercial del Sur',
    documentType: 'CUIT',
    taxId: '30334455668',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    phone: '0291-456-7890',
    categoryNames: ['Minorista'],
  });
  await ensureAddress(sur.id, 'FISCAL', {
    street: 'Alsina',
    number: '780',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
    postalCode: 'B8000',
    isDefault: true,
  });

  await upsertCustomer({
    code: '000015',
    customerType: 'COMPANY',
    legalName: 'Zapatería Andina S.R.L.',
    tradeName: 'Zapatería Andina',
    documentType: 'CUIT',
    taxId: '30716677881',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    phone: '011-4555-1130',
    categoryNames: ['Minorista'],
  });

  // Deliberately INACTIVE — a closed/discontinued account, for data-
  // quality variety (docs/demo-guide.md never selects this one; an
  // inactive customer cannot be picked in a new sale, see docs/sales.md).
  await upsertCustomer({
    code: '000016',
    customerType: 'COMPANY',
    legalName: 'Comercio Los Andes S.R.L. (cerrado)',
    tradeName: 'Comercio Los Andes',
    documentType: 'CUIT',
    taxId: '30717788997',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    status: 'INACTIVE',
  });

  // The customers above use manual codes (000001–000016), bypassing
  // CustomerCodeSequence — advance the counter past them so the first
  // customer created through the UI/API doesn't collide with a seeded
  // code (see docs/customers.md). Only raises the counter, never lowers
  // it, so this stays safe to re-run after real customers already exist
  // with a higher sequence value.
  const SEEDED_CUSTOMER_COUNT = 16;
  const currentSequence = await prisma.customerCodeSequence.findUnique({
    where: { companyId },
  });
  if (!currentSequence) {
    await prisma.customerCodeSequence.create({
      data: { companyId, lastValue: SEEDED_CUSTOMER_COUNT },
    });
  } else if (currentSequence.lastValue < SEEDED_CUSTOMER_COUNT) {
    await prisma.customerCodeSequence.update({
      where: { companyId },
      data: { lastValue: SEEDED_CUSTOMER_COUNT },
    });
  }
}

const PRODUCT_UNIT_SEEDS: {
  code: string;
  name: string;
  symbol: string;
  decimalPlaces: number;
}[] = [
  { code: 'UN', name: 'Unidad', symbol: 'u', decimalPlaces: 0 },
  { code: 'KG', name: 'Kilogramo', symbol: 'kg', decimalPlaces: 3 },
  { code: 'G', name: 'Gramo', symbol: 'g', decimalPlaces: 0 },
  { code: 'L', name: 'Litro', symbol: 'l', decimalPlaces: 3 },
  { code: 'ML', name: 'Mililitro', symbol: 'ml', decimalPlaces: 0 },
  { code: 'M', name: 'Metro', symbol: 'm', decimalPlaces: 2 },
  { code: 'M2', name: 'Metro cuadrado', symbol: 'm²', decimalPlaces: 2 },
  { code: 'M3', name: 'Metro cúbico', symbol: 'm³', decimalPlaces: 3 },
];

/**
 * Standard unit-of-measure set, seeded identically for every company (see
 * docs/products.md — units are always company-scoped, no global/null-
 * company rows). Deterministic upsert by companyId+code.
 */
async function seedProductUnits(
  tenantId: string,
  companyId: string,
): Promise<Map<string, string>> {
  const unitIdByCode = new Map<string, string>();
  for (const u of PRODUCT_UNIT_SEEDS) {
    const unit = await prisma.unitOfMeasure.upsert({
      where: { companyId_code: { companyId, code: u.code } },
      update: {
        name: u.name,
        symbol: u.symbol,
        decimalPlaces: u.decimalPlaces,
      },
      create: {
        tenantId,
        companyId,
        code: u.code,
        name: u.name,
        symbol: u.symbol,
        decimalPlaces: u.decimalPlaces,
      },
    });
    unitIdByCode.set(u.code, unit.id);
  }
  return unitIdByCode;
}

/**
 * A handful of illustrative products for Demo Company (see docs/products.md
 * and CLAUDE.md's anti-over-seeding guidance) — not a bulk catalog.
 * Deliberately distinct from the products created in the mandatory manual
 * verification walkthrough ("Agua mineral 500 ml", "Remera clásica" with
 * SKUs REM-NEG-*, "Servicio de instalación") so a fresh manual test never
 * collides with seed data on name, SKU, or barcode.
 */
async function seedDemoProducts(tenantId: string, companyId: string) {
  const unitIdByCode = await seedProductUnits(tenantId, companyId);
  const unUnitIdOrUndefined = unitIdByCode.get('UN');
  if (!unUnitIdOrUndefined)
    throw new Error('UN unit not seeded — cannot seed demo products.');
  const unUnitId: string = unUnitIdOrUndefined;

  async function ensureCategory(name: string): Promise<string> {
    const existing = await prisma.productCategory.findFirst({
      where: { companyId, name, parentId: null },
    });
    if (existing) return existing.id;
    const created = await prisma.productCategory.create({
      data: { tenantId, companyId, name },
    });
    return created.id;
  }
  async function ensureBrand(name: string): Promise<string> {
    const normalizedName = name.trim().toLowerCase();
    const brand = await prisma.brand.upsert({
      where: { companyId_normalizedName: { companyId, normalizedName } },
      update: {},
      create: { tenantId, companyId, name, normalizedName },
    });
    return brand.id;
  }
  async function upsertProduct(params: {
    code: string;
    name: string;
    productType: 'PRODUCT' | 'SERVICE';
    categoryId?: string;
    brandId?: string;
    trackInventory: boolean;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return prisma.product.upsert({
      where: { companyId_code: { companyId, code: params.code } },
      update: { status: params.status ?? 'ACTIVE' },
      create: {
        tenantId,
        companyId,
        code: params.code,
        name: params.name,
        productType: params.productType,
        categoryId: params.categoryId,
        brandId: params.brandId,
        baseUnitId: unUnitId,
        trackInventory: params.trackInventory,
        status: params.status ?? 'ACTIVE',
      },
    });
  }
  async function ensureVariant(
    productId: string,
    name: string | null,
    sku: string | null,
    attributes?: Record<string, string>,
  ) {
    const existing = await prisma.productVariant.findFirst({
      where: { productId, name },
    });
    if (existing) return existing;
    return prisma.productVariant.create({
      data: { productId, name, sku, attributes },
    });
  }
  async function ensureCode(
    productVariantId: string,
    type: 'BARCODE',
    code: string,
  ) {
    const existing = await prisma.productCode.findFirst({
      where: { productVariantId, type, code },
    });
    if (existing) return existing;
    return prisma.productCode.create({
      data: { companyId, productVariantId, type, code },
    });
  }

  const bebidasId = await ensureCategory('Bebidas');
  const alimentosId = await ensureCategory('Alimentos');
  const serviciosId = await ensureCategory('Servicios');
  const libreriaId = await ensureCategory('Librería');
  const tecnologiaId = await ensureCategory('Tecnología');
  const indumentariaId = await ensureCategory('Indumentaria');
  const marcaPropiaId = await ensureBrand('Marca Propia');

  // ---------- Bebidas / Alimentos ----------
  const gaseosa = await upsertProduct({
    code: '000001',
    name: 'Gaseosa cola 500 ml',
    productType: 'PRODUCT',
    categoryId: bebidasId,
    trackInventory: true,
  });
  const gaseosaVariant = await ensureVariant(gaseosa.id, null, null);
  await ensureCode(gaseosaVariant.id, 'BARCODE', '7790001000019');

  const agua = await upsertProduct({
    code: '000002',
    name: 'Agua mineral 500 ml',
    productType: 'PRODUCT',
    categoryId: bebidasId,
    trackInventory: true,
  });
  const aguaVariant = await ensureVariant(agua.id, null, null);
  await ensureCode(aguaVariant.id, 'BARCODE', '7790001000026');

  const cafe = await upsertProduct({
    code: '000003',
    name: 'Café 1 kg',
    productType: 'PRODUCT',
    categoryId: alimentosId,
    brandId: marcaPropiaId,
    trackInventory: true,
  });
  await ensureVariant(cafe.id, null, 'CAFE-1KG');

  const yerba = await upsertProduct({
    code: '000004',
    name: 'Yerba mate 1 kg',
    productType: 'PRODUCT',
    categoryId: alimentosId,
    brandId: marcaPropiaId,
    trackInventory: true,
  });
  await ensureVariant(yerba.id, null, 'YERBA-1KG');

  // ---------- Librería / oficina ----------
  const resma = await upsertProduct({
    code: '000005',
    name: 'Resma A4',
    productType: 'PRODUCT',
    categoryId: libreriaId,
    trackInventory: true,
  });
  await ensureVariant(resma.id, null, 'RESMA-A4');

  const cuaderno = await upsertProduct({
    code: '000006',
    name: 'Cuaderno',
    productType: 'PRODUCT',
    categoryId: libreriaId,
    trackInventory: true,
  });
  await ensureVariant(cuaderno.id, null, 'CUAD-TAPA-BL');

  const boligrafo = await upsertProduct({
    code: '000007',
    name: 'Bolígrafo',
    productType: 'PRODUCT',
    categoryId: libreriaId,
    trackInventory: true,
  });
  await ensureVariant(boligrafo.id, 'Azul', 'BOLI-AZUL', { color: 'Azul' });
  await ensureVariant(boligrafo.id, 'Negro', 'BOLI-NEGRO', { color: 'Negro' });

  // Deliberately INACTIVE — a discontinued line, for data-quality variety
  // (docs/demo-guide.md never uses this one in the rehearsed flow).
  const cinta = await upsertProduct({
    code: '000008',
    name: 'Cinta adhesiva',
    productType: 'PRODUCT',
    categoryId: libreriaId,
    trackInventory: true,
    status: 'INACTIVE',
  });
  await ensureVariant(cinta.id, null, 'CINTA-ADH');

  const marcador = await upsertProduct({
    code: '000009',
    name: 'Marcador permanente',
    productType: 'PRODUCT',
    categoryId: libreriaId,
    trackInventory: true,
  });
  await ensureVariant(marcador.id, null, 'MARC-PERM');

  // ---------- Indumentaria ----------
  const buzo = await upsertProduct({
    code: '000010',
    name: 'Buzo con capucha',
    productType: 'PRODUCT',
    categoryId: indumentariaId,
    trackInventory: true,
  });
  await ensureVariant(buzo.id, 'Negro / S', 'BUZO-NEGRO-S', {
    color: 'Negro',
    talle: 'S',
  });
  await ensureVariant(buzo.id, 'Negro / M', 'BUZO-NEGRO-M', {
    color: 'Negro',
    talle: 'M',
  });
  await ensureVariant(buzo.id, 'Negro / L', 'BUZO-NEGRO-L', {
    color: 'Negro',
    talle: 'L',
  });
  await ensureVariant(buzo.id, 'Gris / M', 'BUZO-GRIS-M', {
    color: 'Gris',
    talle: 'M',
  });

  // ---------- Tecnología / accesorios ----------
  const cable = await upsertProduct({
    code: '000011',
    name: 'Cable USB-C',
    productType: 'PRODUCT',
    categoryId: tecnologiaId,
    trackInventory: true,
  });
  await ensureVariant(cable.id, null, 'CABLE-USBC');

  const mouse = await upsertProduct({
    code: '000012',
    name: 'Mouse inalámbrico',
    productType: 'PRODUCT',
    categoryId: tecnologiaId,
    trackInventory: true,
  });
  await ensureVariant(mouse.id, null, 'MOUSE-INAL');

  const teclado = await upsertProduct({
    code: '000013',
    name: 'Teclado',
    productType: 'PRODUCT',
    categoryId: tecnologiaId,
    trackInventory: true,
  });
  await ensureVariant(teclado.id, null, 'TECLADO-STD');

  // Deliberately never given an initial balance (see seedWarehousesAndStock
  // below) — a real, honest zero-stock example: priced and cataloged, but
  // with zero StockMovement history anywhere, exactly what a newly-added
  // catalog item looks like before its first receipt. Never used in the
  // rehearsed demo flow (docs/demo-guide.md).
  const cargador = await upsertProduct({
    code: '000014',
    name: 'Cargador USB-C',
    productType: 'PRODUCT',
    categoryId: tecnologiaId,
    trackInventory: true,
  });
  await ensureVariant(cargador.id, null, 'CARGADOR-USBC');

  // ---------- Servicios (no inventory effect — see docs/sales.md) ----------
  const flete = await upsertProduct({
    code: '000015',
    name: 'Servicio de flete',
    productType: 'SERVICE',
    categoryId: serviciosId,
    trackInventory: false,
  });
  await ensureVariant(flete.id, null, null);

  const instalacion = await upsertProduct({
    code: '000016',
    name: 'Servicio de instalación',
    productType: 'SERVICE',
    categoryId: serviciosId,
    trackInventory: false,
  });
  await ensureVariant(instalacion.id, null, null);

  const envio = await upsertProduct({
    code: '000017',
    name: 'Envío local',
    productType: 'SERVICE',
    categoryId: serviciosId,
    trackInventory: false,
  });
  await ensureVariant(envio.id, null, null);

  // Same collision-prevention fix as CustomerCodeSequence (see
  // seedDemoCustomers above and docs/products.md) — these products use
  // manual codes, bypassing ProductCodeSequence, so the counter must be
  // advanced past them before the first UI/API-created product. Only
  // raises the counter, never lowers it.
  const SEEDED_PRODUCT_COUNT = 17;
  const currentSequence = await prisma.productCodeSequence.findUnique({
    where: { companyId },
  });
  if (!currentSequence) {
    await prisma.productCodeSequence.create({
      data: { companyId, lastValue: SEEDED_PRODUCT_COUNT },
    });
  } else if (currentSequence.lastValue < SEEDED_PRODUCT_COUNT) {
    await prisma.productCodeSequence.update({
      where: { companyId },
      data: { lastValue: SEEDED_PRODUCT_COUNT },
    });
  }
}

/**
 * Applies one signed StockMovement and atomically updates
 * InventoryBalance.onHand in the same transaction — the exact pattern
 * InventoryService.applyMovement uses (see docs/inventory.md). Seed.ts is
 * a standalone script outside Nest's DI container (like every other
 * seed function here — see seedDemoCustomers/seedDemoProducts, which
 * also don't invoke the real CustomersService/ProductsService), so this
 * mirrors the service's logic directly with Prisma rather than
 * bootstrapping a partial Nest application just to reach it. Idempotent:
 * skips silently if the (warehouse, variant) pair already has movement
 * history, exactly like InventoryService.createInitialBalance's
 * INITIAL_BALANCE_ALREADY_ESTABLISHED rule — see docs/inventory.md.
 */
async function ensureInitialBalance(
  tenantId: string,
  companyId: string,
  warehouseId: string,
  productVariantId: string,
  quantity: string,
) {
  const existing = await prisma.stockMovement.findFirst({
    where: { companyId, warehouseId, productVariantId },
  });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.create({
      data: {
        tenantId,
        companyId,
        warehouseId,
        productVariantId,
        movementType: 'INITIAL_BALANCE',
        quantity,
        reason: 'Saldo inicial',
        occurredAt: new Date(),
      },
    });
    await tx.inventoryBalance.upsert({
      where: {
        companyId_warehouseId_productVariantId: {
          companyId,
          warehouseId,
          productVariantId,
        },
      },
      create: {
        companyId,
        warehouseId,
        productVariantId,
        onHand: quantity,
        reserved: 0,
        incoming: 0,
      },
      update: { onHand: { increment: quantity } },
    });
  });
}

/**
 * Three demo warehouses (see docs/inventory.md) plus illustrative initial
 * stock for the demo company's seeded products, exercised through real
 * StockMovement rows (see ensureInitialBalance) rather than a direct
 * InventoryBalance insert — per docs/inventory.md's requirement that
 * seed stock come from real ledger behavior. "Salón de Ventas" is a
 * sales-floor warehouse (allowsSales, not allowsPurchases) sharing Casa
 * Central's branch, giving the Facturación/POS warehouse picker something
 * real to choose between (docs/demo-guide.md). One product ("Cargador
 * USB-C", code 000014) is deliberately never given a balance anywhere —
 * a genuine zero-stock example, not a fabricated one.
 */
async function seedWarehousesAndStock(
  tenantId: string,
  companyId: string,
  branchMainId: string,
  branchSecondaryId: string,
) {
  const central = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'CENTRAL' } },
    update: { name: 'Depósito Central' },
    create: {
      tenantId,
      companyId,
      branchId: branchMainId,
      code: 'CENTRAL',
      name: 'Depósito Central',
      allowsSales: true,
      allowsPurchases: true,
    },
  });
  const salon = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'SALON' } },
    update: { name: 'Salón de Ventas' },
    create: {
      tenantId,
      companyId,
      branchId: branchMainId,
      code: 'SALON',
      name: 'Salón de Ventas',
      allowsSales: true,
      allowsPurchases: false,
    },
  });
  const sucursalNorte = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'SUC2' } },
    update: { name: 'Depósito Sucursal Norte' },
    create: {
      tenantId,
      companyId,
      branchId: branchSecondaryId,
      code: 'SUC2',
      name: 'Depósito Sucursal Norte',
      allowsSales: true,
      allowsPurchases: true,
    },
  });

  async function firstVariantId(productCode: string): Promise<string | null> {
    const product = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: productCode } },
    });
    if (!product) return null;
    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, name: null },
    });
    return variant?.id ?? null;
  }
  async function namedVariantId(
    productCode: string,
    variantName: string,
  ): Promise<string | null> {
    const product = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: productCode } },
    });
    if (!product) return null;
    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, name: variantName },
    });
    return variant?.id ?? null;
  }

  const gaseosaId = await firstVariantId('000001'); // Gaseosa cola 500 ml
  const aguaId = await firstVariantId('000002'); // Agua mineral 500 ml
  const cafeId = await firstVariantId('000003'); // Café 1 kg
  const yerbaId = await firstVariantId('000004'); // Yerba mate 1 kg
  const resmaId = await firstVariantId('000005'); // Resma A4
  const cuadernoId = await firstVariantId('000006'); // Cuaderno
  const boliAzulId = await namedVariantId('000007', 'Azul'); // Bolígrafo
  const boliNegroId = await namedVariantId('000007', 'Negro');
  const cintaId = await firstVariantId('000008'); // Cinta adhesiva (INACTIVE product)
  const marcadorId = await firstVariantId('000009'); // Marcador permanente
  const buzoNegroS = await namedVariantId('000010', 'Negro / S'); // Buzo con capucha
  const buzoNegroM = await namedVariantId('000010', 'Negro / M');
  const buzoNegroL = await namedVariantId('000010', 'Negro / L');
  const buzoGrisM = await namedVariantId('000010', 'Gris / M');
  const cableId = await firstVariantId('000011'); // Cable USB-C
  const mouseId = await firstVariantId('000012'); // Mouse inalámbrico
  const tecladoId = await firstVariantId('000013'); // Teclado
  // 000014 Cargador USB-C intentionally has no initial balance anywhere.

  // ---------- Depósito Central — the full catalog ----------
  const centralStock: [string | null, string][] = [
    [gaseosaId, '120'],
    [aguaId, '150'],
    [cafeId, '90'],
    [yerbaId, '60'],
    [resmaId, '70'],
    [cuadernoId, '55'],
    [boliAzulId, '90'],
    [boliNegroId, '90'],
    [cintaId, '40'],
    [marcadorId, '48'],
    [buzoNegroS, '10'],
    [buzoNegroM, '22'],
    [buzoNegroL, '18'],
    [buzoGrisM, '14'],
    [cableId, '35'],
    [mouseId, '20'],
    [tecladoId, '16'],
  ];
  for (const [variantId, quantity] of centralStock) {
    if (variantId)
      await ensureInitialBalance(
        tenantId,
        companyId,
        central.id,
        variantId,
        quantity,
      );
  }

  // ---------- Salón de Ventas — a small front-counter subset ----------
  const salonStock: [string | null, string][] = [
    [gaseosaId, '30'],
    [cafeId, '15'],
  ];
  for (const [variantId, quantity] of salonStock) {
    if (variantId)
      await ensureInitialBalance(
        tenantId,
        companyId,
        salon.id,
        variantId,
        quantity,
      );
  }

  // ---------- Depósito Sucursal Norte — its own independent stock ----------
  const sucursalNorteStock: [string | null, string][] = [
    [gaseosaId, '45'],
    [cafeId, '20'],
    [yerbaId, '25'],
  ];
  for (const [variantId, quantity] of sucursalNorteStock) {
    if (variantId)
      await ensureInitialBalance(
        tenantId,
        companyId,
        sucursalNorte.id,
        variantId,
        quantity,
      );
  }

  return { central, salon, sucursalNorte };
}

/**
 * Global currency reference data (see docs/pricing.md) — not tenant/company
 * scoped, so a single upsert-by-code covers every seeded company at once.
 */
async function seedCurrencies() {
  const currencies = [
    { code: 'ARS', name: 'Peso argentino', symbol: '$', decimalPlaces: 2 },
    {
      code: 'USD',
      name: 'Dólar estadounidense',
      symbol: 'US$',
      decimalPlaces: 2,
    },
    { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
  }
}

/**
 * Sets a variant's very first price for a price list through the same
 * real ledger mechanics PricingService.setPrice uses (PriceListItem +
 * matching PriceHistory row, in one transaction) — see
 * ensureInitialBalance's identical rationale above and docs/pricing.md.
 * Idempotent: does nothing if the variant already has any price in this
 * list, so re-running the seed never creates duplicate history.
 */
async function ensureInitialPrice(
  tenantId: string,
  companyId: string,
  priceListId: string,
  productVariantId: string,
  price: string,
) {
  const existing = await prisma.priceListItem.findFirst({
    where: { companyId, priceListId, productVariantId },
  });
  if (existing) return;

  const effectiveFrom = new Date();
  effectiveFrom.setUTCHours(0, 0, 0, 0);

  await prisma.$transaction(async (tx) => {
    await tx.priceListItem.create({
      data: {
        tenantId,
        companyId,
        priceListId,
        productVariantId,
        price,
        effectiveFrom,
        effectiveUntil: null,
      },
    });
    await tx.priceHistory.create({
      data: {
        tenantId,
        companyId,
        priceListId,
        productVariantId,
        oldPrice: null,
        newPrice: price,
        effectiveFrom,
        changeType: 'INITIAL',
        reason: 'Carga inicial de precios (seed)',
      },
    });
  });
}

/**
 * Three illustrative price lists for Demo Company (see docs/pricing.md):
 * Minorista (FIXED, the company default) with real prices for the same
 * products seeded with stock above, plus Mayorista/Distribuidor (DERIVED
 * from Minorista at -10%/-15%) — deliberately never given their own
 * PriceListItem rows, since a derived list's prices are computed at read
 * time, never materialized.
 */
async function seedDemoPricing(tenantId: string, companyId: string) {
  const ars = await prisma.currency.findUniqueOrThrow({
    where: { code: 'ARS' },
  });

  const minorista = await prisma.priceList.upsert({
    where: { companyId_code: { companyId, code: 'MIN' } },
    update: {},
    create: {
      tenantId,
      companyId,
      code: 'MIN',
      name: 'Minorista',
      currencyId: ars.id,
      includesTax: true,
      pricingMode: 'FIXED',
      isDefault: true,
    },
  });
  await prisma.priceList.upsert({
    where: { companyId_code: { companyId, code: 'MAY' } },
    update: {},
    create: {
      tenantId,
      companyId,
      code: 'MAY',
      name: 'Mayorista',
      currencyId: ars.id,
      includesTax: true,
      pricingMode: 'DERIVED',
      basePriceListId: minorista.id,
      adjustmentType: 'PERCENTAGE_DECREASE',
      adjustmentValue: '10',
    },
  });
  await prisma.priceList.upsert({
    where: { companyId_code: { companyId, code: 'DIST' } },
    update: {},
    create: {
      tenantId,
      companyId,
      code: 'DIST',
      name: 'Distribuidor',
      currencyId: ars.id,
      includesTax: true,
      pricingMode: 'DERIVED',
      basePriceListId: minorista.id,
      adjustmentType: 'PERCENTAGE_DECREASE',
      adjustmentValue: '15',
    },
  });

  async function firstVariantId(productCode: string): Promise<string | null> {
    const product = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: productCode } },
    });
    if (!product) return null;
    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, name: null },
    });
    return variant?.id ?? null;
  }
  async function namedVariantId(
    productCode: string,
    variantName: string,
  ): Promise<string | null> {
    const product = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: productCode } },
    });
    if (!product) return null;
    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, name: variantName },
    });
    return variant?.id ?? null;
  }

  const gaseosaId = await firstVariantId('000001'); // Gaseosa cola 500 ml
  const aguaId = await firstVariantId('000002'); // Agua mineral 500 ml
  const cafeId = await firstVariantId('000003'); // Café 1 kg
  const yerbaId = await firstVariantId('000004'); // Yerba mate 1 kg
  const resmaId = await firstVariantId('000005'); // Resma A4
  const cuadernoId = await firstVariantId('000006'); // Cuaderno
  const boliAzulId = await namedVariantId('000007', 'Azul'); // Bolígrafo
  const boliNegroId = await namedVariantId('000007', 'Negro');
  const cintaId = await firstVariantId('000008'); // Cinta adhesiva (INACTIVE)
  const marcadorId = await firstVariantId('000009'); // Marcador permanente
  const buzoNegroS = await namedVariantId('000010', 'Negro / S'); // Buzo con capucha
  const buzoNegroM = await namedVariantId('000010', 'Negro / M');
  const buzoNegroL = await namedVariantId('000010', 'Negro / L');
  const buzoGrisM = await namedVariantId('000010', 'Gris / M');
  const cableId = await firstVariantId('000011'); // Cable USB-C
  const mouseId = await firstVariantId('000012'); // Mouse inalámbrico
  const tecladoId = await firstVariantId('000013'); // Teclado
  const cargadorId = await firstVariantId('000014'); // Cargador USB-C (zero-stock demo item)
  const fleteId = await firstVariantId('000015'); // Servicio de flete
  const instalacionId = await firstVariantId('000016'); // Servicio de instalación
  const envioId = await firstVariantId('000017'); // Envío local

  // Café 1 kg is deliberately priced at a clean, memorable ARS 22.000 —
  // see docs/demo-guide.md, whose rehearsed CASH example (received
  // 25.000, change 3.000) depends on this exact figure.
  const prices: [string | null, string][] = [
    [gaseosaId, '1200'],
    [aguaId, '900'],
    [cafeId, '22000'],
    [yerbaId, '8500'],
    [resmaId, '6500'],
    [cuadernoId, '2500'],
    [boliAzulId, '900'],
    [boliNegroId, '900'],
    [cintaId, '1500'],
    [marcadorId, '1100'],
    [buzoNegroS, '25000'],
    [buzoNegroM, '25000'],
    [buzoNegroL, '25000'],
    [buzoGrisM, '25000'],
    [cableId, '3500'],
    [mouseId, '12000'],
    [tecladoId, '18000'],
    [cargadorId, '4500'],
    [fleteId, '15000'],
    [instalacionId, '20000'],
    [envioId, '3500'],
  ];
  for (const [variantId, price] of prices) {
    if (variantId)
      await ensureInitialPrice(tenantId, companyId, minorista.id, variantId, price);
  }
}

// ---------------------------------------------------------------------
// Historical + demo sales
// ---------------------------------------------------------------------
//
// seedDemoSales below replicates SalesService.create()+confirm()'s core
// transaction logic directly with Prisma — the same "mirror the service,
// don't call it" approach ensureInitialBalance/ensureInitialPrice already
// use above, for the same reason: seed.ts is a standalone script outside
// Nest's DI container, and SalesService depends on InventoryService/
// PricingService/AuditService via constructor injection. Bootstrapping a
// full Nest application context (NestFactory.createApplicationContext)
// just to reach one service would also pull in RedisModule and its own
// connection/shutdown lifecycle — a new failure mode for a script whose
// whole job is fast, reliable demo data, and out of proportion to what's
// needed here (see docs/demo-guide.md's "Determinism" section).
//
// This mirror is deliberately simpler than the real two-phase draft-then-
// confirm API flow: each seeded sale is built directly in its final state
// (DRAFT, or CONFIRMED with stock already decremented and a tender
// attached) inside one transaction, rather than simulating a create call
// followed by a separate confirm call — seed data doesn't need to
// reproduce that UX round trip, only its *effects*. Every invariant the
// real service enforces is still respected by construction: Decimal-safe
// line/document totals (computeLineTotals/computeDocumentTotals, copied
// verbatim from apps/api/src/sales/sales.service.ts — keep both in sync
// if that file's rounding rules ever change), the same
// SalesDocumentSequence atomic-increment numbering, a real negative
// StockMovement (SALE) + atomic InventoryBalance decrement per
// inventory-tracked line (never a fabricated balance), and a SalesTender
// row shaped exactly like SalesService.confirm's.
//
// Idempotent via a stable marker in SalesDocument.notes (e.g.
// "DEMO-SEED-03") checked before creating — re-running the seed against
// an already-seeded database skips every sale that's already there,
// so stock is never decremented twice. Dates are computed relative to
// `new Date()` at seed-run time (never hardcoded), so a sale seeded
// "today" is always genuinely within the company's current calendar day
// (see docs/dashboard.md's confirmedAt-based "Ventas confirmadas hoy"
// metric) — but that also means the "today"/"N days ago" spread only
// stays accurate for a *fresh* seed run; re-running without first
// resetting the database leaves already-seeded sales' original dates
// untouched (idempotent skip), same as every other seed function here.
// See docs/demo-guide.md's documented reset-before-demo workflow.

/** Copied verbatim from SalesService's private computeLineTotals — see the block comment above for why. */
function seedComputeLineTotals(
  quantity: string,
  unitPrice: string,
  discountPercentage: string,
): {
  discountPercentage: string;
  discountAmount: string;
  netAmount: string;
  taxAmount: string;
  totalAmount: string;
} {
  const qty = new Prisma.Decimal(quantity);
  const price = new Prisma.Decimal(unitPrice);
  const discountPct = new Prisma.Decimal(discountPercentage).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  const gross = qty.mul(price);
  const discountAmount = gross
    .mul(discountPct)
    .div(100)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const netAmount = gross
    .sub(discountAmount)
    .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  return {
    discountPercentage: discountPct.toString(),
    discountAmount: discountAmount.toString(),
    netAmount: netAmount.toString(),
    taxAmount: '0',
    totalAmount: netAmount.toString(),
  };
}

/** Copied verbatim from SalesService's private computeDocumentTotals — see the block comment above. */
function seedComputeDocumentTotals(
  lines: ReturnType<typeof seedComputeLineTotals>[],
): {
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
} {
  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  for (const line of lines) {
    subtotal = subtotal.add(line.netAmount);
    discountTotal = discountTotal.add(line.discountAmount);
  }
  return {
    subtotal: subtotal.toString(),
    discountTotal: discountTotal.toString(),
    taxTotal: '0',
    total: subtotal.toString(),
  };
}

/**
 * The same DERIVED-list formula PricingService.resolveRecursive applies
 * (see docs/pricing.md) — base price minus a percentage, clamped to >= 0,
 * rounded to the currency's decimalPlaces (2 for ARS) with ROUND_HALF_UP.
 * Only used for the one seeded sale that prices against Mayorista.
 */
function seedResolvePercentageDecrease(
  basePrice: string,
  percentage: string,
  currencyDecimalPlaces: number,
): string {
  const base = new Prisma.Decimal(basePrice);
  const pct = new Prisma.Decimal(percentage);
  // Same formula as PricingService's applyAdjustment (PERCENTAGE_DECREASE
  // case) — base * (1 - pct/100) — see apps/api/src/pricing/pricing.service.ts.
  const adjusted = base.mul(new Prisma.Decimal(1).sub(pct.div(100)));
  return Prisma.Decimal.max(adjusted, 0)
    .toDecimalPlaces(currencyDecimalPlaces, Prisma.Decimal.ROUND_HALF_UP)
    .toString();
}

/**
 * Mirrors InventoryService.applySaleLine's core (docs/sales.md,
 * docs/inventory.md): a no-op for a non-inventory-tracked (SERVICE) line;
 * otherwise a real negative StockMovement (movementType SALE,
 * referenceType 'SalesDocument') plus an atomic upsert-increment of
 * InventoryBalance.onHand, inside the caller's transaction. Throws if the
 * result would go negative — defensive only, since every seeded sale's
 * quantities are chosen to stay well within the initial balances seeded
 * above.
 */
async function seedApplySaleStockOut(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  branchId: string | null,
  warehouseId: string,
  productVariantId: string,
  trackInventory: boolean,
  quantity: string,
  salesDocumentId: string,
  occurredAt: Date,
) {
  if (!trackInventory) return;
  const negativeQuantity = new Prisma.Decimal(quantity).neg().toString();
  await tx.stockMovement.create({
    data: {
      tenantId,
      companyId,
      branchId,
      warehouseId,
      productVariantId,
      movementType: 'SALE',
      quantity: negativeQuantity,
      referenceType: 'SalesDocument',
      referenceId: salesDocumentId,
      occurredAt,
    },
  });
  const balance = await tx.inventoryBalance.upsert({
    where: {
      companyId_warehouseId_productVariantId: {
        companyId,
        warehouseId,
        productVariantId,
      },
    },
    create: {
      companyId,
      warehouseId,
      productVariantId,
      onHand: negativeQuantity,
      reserved: 0,
      incoming: 0,
    },
    update: { onHand: { increment: negativeQuantity } },
  });
  if (new Prisma.Decimal(balance.onHand).isNegative()) {
    throw new Error(
      `Seed would drive onHand negative for variant ${productVariantId} in warehouse ${warehouseId} — adjust seedDemoSales quantities or initial balances.`,
    );
  }
}

/** Mirrors SalesService's private nextNumber — see the block comment above. */
async function seedNextSalesNumber(
  tx: Prisma.TransactionClient,
  companyId: string,
): Promise<string> {
  const seq = await tx.salesDocumentSequence.upsert({
    where: { companyId },
    create: { companyId, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  return `VTA-${String(seq.lastValue).padStart(6, '0')}`;
}

interface SeedSaleLineInput {
  productCode: string;
  variantName?: string | null;
  quantity: string;
}

interface SeedSaleTenderInput {
  method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
  amountReceived?: string;
}

/**
 * Creates one historical/demo SalesDocument — DRAFT (no `confirm` block)
 * or CONFIRMED (with real stock-out + optional tender) depending on
 * whether `confirm` is provided. `marker` is the idempotency key stored
 * in `notes` — see the block comment above. `daysAgo` is resolved against
 * `new Date()` at call time, never a fixed date. Returns `null` (and
 * creates nothing) if the marker sale already exists, or if any line's
 * product/variant/price can't be resolved — logged, never thrown, so one
 * missing fixture never aborts the whole seed run.
 */
async function seedHistoricalSale(params: {
  tenantId: string;
  companyId: string;
  marker: string;
  customerCode: string;
  warehouseId: string;
  branchId: string | null;
  priceListId: string;
  priceListCode: 'MIN' | 'MAY';
  currencyId: string;
  currencyDecimalPlaces: number;
  daysAgo: number;
  lines: SeedSaleLineInput[];
  confirm?: SeedSaleTenderInput;
}): Promise<{ number: string; total: string } | null> {
  const {
    tenantId,
    companyId,
    marker,
    customerCode,
    warehouseId,
    branchId,
    priceListId,
    priceListCode,
    currencyId,
    currencyDecimalPlaces,
    daysAgo,
    lines,
    confirm,
  } = params;

  const existing = await prisma.salesDocument.findFirst({
    where: { companyId, notes: marker },
  });
  if (existing)
    return { number: existing.number, total: existing.total.toString() };

  const customer = await prisma.customer.findUnique({
    where: { companyId_code: { companyId, code: customerCode } },
  });
  if (!customer) {
    console.warn(`  [seedDemoSales] skipping ${marker} — customer ${customerCode} not found.`);
    return null;
  }

  const builtLines: (ReturnType<typeof seedComputeLineTotals> & {
    productVariantId: string;
    description: string;
    quantity: string;
    unitPrice: string;
    trackInventory: boolean;
  })[] = [];

  for (const line of lines) {
    const product = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: line.productCode } },
    });
    if (!product) {
      console.warn(`  [seedDemoSales] skipping ${marker} — product ${line.productCode} not found.`);
      return null;
    }
    const variant = await prisma.productVariant.findFirst({
      where: { productId: product.id, name: line.variantName ?? null },
    });
    if (!variant) {
      console.warn(`  [seedDemoSales] skipping ${marker} — variant ${line.variantName ?? '(default)'} of ${line.productCode} not found.`);
      return null;
    }
    const minoristaItem = await prisma.priceListItem.findFirst({
      where: {
        companyId,
        productVariantId: variant.id,
        priceList: { code: 'MIN' },
      },
    });
    if (!minoristaItem) {
      console.warn(`  [seedDemoSales] skipping ${marker} — no Minorista price for ${line.productCode}.`);
      return null;
    }
    const unitPrice =
      priceListCode === 'MIN'
        ? minoristaItem.price.toString()
        : seedResolvePercentageDecrease(
            minoristaItem.price.toString(),
            '10', // Mayorista's adjustmentValue — see seedDemoPricing.
            currencyDecimalPlaces,
          );
    const totals = seedComputeLineTotals(line.quantity, unitPrice, '0');
    builtLines.push({
      productVariantId: variant.id,
      description: product.name,
      quantity: line.quantity,
      unitPrice,
      trackInventory: product.trackInventory,
      ...totals,
    });
  }

  const documentTotals = seedComputeDocumentTotals(builtLines);
  const occurredAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

  const result = await prisma.$transaction(async (tx) => {
    const number = await seedNextSalesNumber(tx, companyId);
    const sale = await tx.salesDocument.create({
      data: {
        tenantId,
        companyId,
        branchId,
        number,
        warehouseId,
        customerId: customer.id,
        priceListId,
        currencyId,
        occurredAt,
        notes: marker,
        subtotal: documentTotals.subtotal,
        discountTotal: documentTotals.discountTotal,
        taxTotal: documentTotals.taxTotal,
        total: documentTotals.total,
        status: confirm ? 'CONFIRMED' : 'DRAFT',
        confirmedAt: confirm ? occurredAt : null,
        lines: {
          create: builtLines.map((l) => ({
            productVariantId: l.productVariantId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercentage: l.discountPercentage,
            discountAmount: l.discountAmount,
            netAmount: l.netAmount,
            taxAmount: l.taxAmount,
            totalAmount: l.totalAmount,
          })),
        },
      },
    });

    if (confirm) {
      for (const line of builtLines) {
        await seedApplySaleStockOut(
          tx,
          tenantId,
          companyId,
          branchId,
          warehouseId,
          line.productVariantId,
          line.trackInventory,
          line.quantity,
          sale.id,
          occurredAt,
        );
      }
      await tx.salesTender.create({
        data: {
          salesDocumentId: sale.id,
          method: confirm.method,
          amountApplied: documentTotals.total,
          amountReceived:
            confirm.method === 'CASH'
              ? (confirm.amountReceived ?? documentTotals.total)
              : null,
        },
      });
    }

    return sale;
  });

  return { number: result.number, total: result.total.toString() };
}

/**
 * 10 CONFIRMED sales spread across 8 distinct days within the last 9 days
 * (today included) plus 1 DRAFT — see the block comment above and
 * docs/demo-guide.md. Every tender method (CASH/CARD/TRANSFER/OTHER)
 * appears at least once; one sale prices against Mayorista instead of
 * Minorista, to exercise DERIVED pricing in real sale history too.
 * Quantities are chosen to stay well within the initial balances
 * seedWarehousesAndStock establishes.
 */
async function seedDemoSales(
  tenantId: string,
  companyId: string,
  branchMainId: string,
  branchSecondaryId: string,
  warehouses: {
    central: { id: string };
    salon: { id: string };
    sucursalNorte: { id: string };
  },
): Promise<{
  confirmedCount: number;
  draftCount: number;
  distinctDays: number;
  tenderCounts: string;
}> {
  const minorista = await prisma.priceList.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MIN' } },
  });
  const mayorista = await prisma.priceList.findUniqueOrThrow({
    where: { companyId_code: { companyId, code: 'MAY' } },
  });
  const ars = await prisma.currency.findUniqueOrThrow({
    where: { code: 'ARS' },
  });

  type SaleSpec = Parameters<typeof seedHistoricalSale>[0];
  const common = {
    tenantId,
    companyId,
    currencyId: ars.id,
    currencyDecimalPlaces: ars.decimalPlaces,
  };
  const specs: SaleSpec[] = [
    {
      ...common,
      marker: 'DEMO-SEED-01',
      customerCode: '000002', // Ferretería El Puente
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 0,
      lines: [
        { productCode: '000004', quantity: '2' }, // Yerba mate 1 kg
        { productCode: '000005', quantity: '1' }, // Resma A4
      ],
      confirm: { method: 'CASH' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-02',
      customerCode: '000001', // Consumidor Final
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 0,
      lines: [
        { productCode: '000001', quantity: '3' }, // Gaseosa cola 500 ml
        { productCode: '000007', variantName: 'Azul', quantity: '2' }, // Bolígrafo
      ],
      confirm: { method: 'CARD' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-03',
      customerCode: '000003', // Kiosco Don Alberto
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 1,
      lines: [
        { productCode: '000003', quantity: '1' }, // Café 1 kg
        { productCode: '000002', quantity: '4' }, // Agua mineral 500 ml
      ],
      confirm: { method: 'CASH' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-04',
      customerCode: '000004', // Cafetería Aroma
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 1,
      lines: [{ productCode: '000004', quantity: '3' }], // Yerba mate 1 kg
      confirm: { method: 'TRANSFER' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-05',
      customerCode: '000006', // Distribuidora Sur Insumos
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: mayorista.id,
      priceListCode: 'MAY',
      daysAgo: 2,
      lines: [
        { productCode: '000010', variantName: 'Negro / M', quantity: '5' }, // Buzo con capucha
        { productCode: '000010', variantName: 'Negro / L', quantity: '3' },
      ],
      confirm: { method: 'TRANSFER' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-06',
      customerCode: '000008', // Panadería San Roque
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 3,
      lines: [
        { productCode: '000005', quantity: '2' }, // Resma A4
        { productCode: '000006', quantity: '3' }, // Cuaderno
      ],
      confirm: { method: 'CASH' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-07',
      customerCode: '000010', // Juan Carlos Pereyra
      warehouseId: warehouses.salon.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 4,
      lines: [
        { productCode: '000003', quantity: '1' }, // Café 1 kg
        { productCode: '000001', quantity: '2' }, // Gaseosa cola 500 ml
      ],
      confirm: { method: 'CARD' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-08',
      customerCode: '000009', // Librería Central
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 6,
      lines: [
        { productCode: '000006', quantity: '10' }, // Cuaderno
        { productCode: '000007', variantName: 'Negro', quantity: '10' }, // Bolígrafo
      ],
      confirm: { method: 'OTHER' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-09',
      customerCode: '000005', // Estudio Fernández & Asociados
      warehouseId: warehouses.central.id,
      branchId: branchMainId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 8,
      lines: [
        { productCode: '000016', quantity: '1' }, // Servicio de instalación
        { productCode: '000013', quantity: '1' }, // Teclado
      ],
      confirm: { method: 'TRANSFER' },
    },
    {
      ...common,
      marker: 'DEMO-SEED-10',
      customerCode: '000012', // Hotel Las Acacias
      warehouseId: warehouses.sucursalNorte.id,
      branchId: branchSecondaryId,
      priceListId: minorista.id,
      priceListCode: 'MIN',
      daysAgo: 9,
      lines: [
        { productCode: '000003', quantity: '4' }, // Café 1 kg
        { productCode: '000004', quantity: '2' }, // Yerba mate 1 kg
      ],
      confirm: { method: 'CASH', amountReceived: undefined },
    },
  ];

  const daysUsed = new Set<number>();
  const tenderTally: Record<string, number> = {
    CASH: 0,
    CARD: 0,
    TRANSFER: 0,
    OTHER: 0,
  };
  let confirmedCount = 0;
  for (const spec of specs) {
    const created = await seedHistoricalSale(spec);
    if (created && spec.confirm) {
      confirmedCount += 1;
      daysUsed.add(spec.daysAgo);
      tenderTally[spec.confirm.method] += 1;
    }
  }

  // One DRAFT — left unconfirmed on purpose, see docs/demo-guide.md.
  let draftCount = 0;
  const draft = await seedHistoricalSale({
    ...common,
    marker: 'DEMO-SEED-DRAFT',
    customerCode: '000015', // Zapatería Andina
    warehouseId: warehouses.central.id,
    branchId: branchMainId,
    priceListId: minorista.id,
    priceListCode: 'MIN',
    daysAgo: 0,
    lines: [{ productCode: '000005', quantity: '1' }], // Resma A4
  });
  if (draft) draftCount = 1;

  return {
    confirmedCount,
    draftCount,
    distinctDays: daysUsed.size,
    tenderCounts: Object.entries(tenderTally)
      .filter(([, count]) => count > 0)
      .map(([method, count]) => `${count} ${method}`)
      .join(', '),
  };
}

/**
 * A realistic supplier roster for the demo company (see docs/purchases.md)
 * — same upsert-by-companyId+code idempotency as seedDemoCustomers. 4
 * ACTIVE suppliers (a wholesale distributor, an importer, an individual
 * monotributista, an office-supplies vendor) + 1 INACTIVE, for the same
 * data-quality-variety reason as Customer code 000016 above — never used
 * in any seeded purchase order/receipt below.
 */
async function seedDemoSuppliers(
  tenantId: string,
  companyId: string,
): Promise<Map<string, string>> {
  const idByCode = new Map<string, string>();

  async function upsertSupplier(params: {
    code: string;
    legalName: string;
    tradeName?: string;
    documentType?: 'CUIT' | 'DNI';
    taxId?: string;
    taxCondition: 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';
    email?: string;
    phone?: string;
    city?: string;
    province?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const supplier = await prisma.supplier.upsert({
      where: { companyId_code: { companyId, code: params.code } },
      update: {
        legalName: params.legalName,
        tradeName: params.tradeName,
        documentType: params.documentType,
        taxId: params.taxId,
        taxCondition: params.taxCondition,
        status: params.status ?? 'ACTIVE',
      },
      create: {
        tenantId,
        companyId,
        code: params.code,
        legalName: params.legalName,
        tradeName: params.tradeName,
        documentType: params.documentType,
        taxId: params.taxId,
        taxCondition: params.taxCondition,
        email: params.email,
        phone: params.phone,
        city: params.city,
        province: params.province,
        status: params.status ?? 'ACTIVE',
      },
    });
    idByCode.set(params.code, supplier.id);
    return supplier;
  }

  await upsertSupplier({
    code: '000001',
    legalName: 'Distribuidora Mayorista del Plata S.A.',
    tradeName: 'Mayorista del Plata',
    documentType: 'CUIT',
    taxId: '30711223440',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'ventas@mayoristadelplata.example',
    phone: '011-4555-2200',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
  });

  await upsertSupplier({
    code: '000002',
    legalName: 'Importadora Andina S.R.L.',
    tradeName: 'Importadora Andina',
    documentType: 'CUIT',
    taxId: '30713344223',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'compras@importadoraandina.example',
    phone: '011-4555-3300',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
  });

  await upsertSupplier({
    code: '000003',
    legalName: 'Juan Pablo Fernández',
    tradeName: 'Insumos Fernández',
    documentType: 'DNI',
    taxId: '27987654',
    taxCondition: 'MONOTRIBUTO',
    phone: '0291-456-7788',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
  });

  await upsertSupplier({
    code: '000004',
    legalName: 'Papelera del Sur S.A.',
    tradeName: 'Papelera del Sur',
    documentType: 'CUIT',
    taxId: '30714455009',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'pedidos@papeleradelsur.example',
    phone: '0291-456-9911',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
  });

  // Deliberately INACTIVE — a discontinued vendor, for data-quality
  // variety (docs/demo-guide.md never selects this one).
  await upsertSupplier({
    code: '000005',
    legalName: 'Proveedor Discontinuado S.R.L.',
    documentType: 'CUIT',
    taxId: '30715566003',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    status: 'INACTIVE',
  });

  // Same collision-prevention fix as CustomerCodeSequence/ProductCodeSequence
  // above — these suppliers use manual codes, bypassing SupplierCodeSequence,
  // so the counter must be advanced past them. Only raises the counter,
  // never lowers it.
  const SEEDED_SUPPLIER_COUNT = 5;
  const currentSequence = await prisma.supplierCodeSequence.findUnique({
    where: { companyId },
  });
  if (!currentSequence) {
    await prisma.supplierCodeSequence.create({
      data: { companyId, lastValue: SEEDED_SUPPLIER_COUNT },
    });
  } else if (currentSequence.lastValue < SEEDED_SUPPLIER_COUNT) {
    await prisma.supplierCodeSequence.update({
      where: { companyId },
      data: { lastValue: SEEDED_SUPPLIER_COUNT },
    });
  }

  return idByCode;
}

/**
 * Illustrative purchase orders + goods receipts for Demo Company (see
 * docs/purchases.md) — built directly with Prisma rather than through
 * PurchaseOrdersService/PurchaseReceiptsService, for the same reason
 * seedDemoSales mirrors SalesService's transaction logic directly (see
 * that function's own doc comment above): seed.ts runs outside Nest's DI
 * container. Every invariant those services enforce is still respected by
 * construction: atomic per-company sequence numbering (PurchaseOrderSequence/
 * PurchaseReceiptSequence), a real PURCHASE StockMovement + atomic
 * InventoryBalance increment per confirmed receipt line (never a
 * fabricated balance), and receivedQuantity/pendingQuantity that are
 * genuinely derivable from that ledger (never a stored counter).
 *
 * Idempotent: skips entirely if the company already has any PurchaseOrder
 * — this function's whole output is one coherent batch (unlike
 * ensureInitialBalance/ensureInitialPrice's per-row idempotency above,
 * there's no incremental-append use case here).
 *
 * Deliberately demonstrates:
 *  - a CONFIRMED order received across two PARTIAL receipts (Café 1 kg:
 *    100 ordered, 40 then 35 received, 25 still pending) — the exact
 *    numbers used in the Prompt #21 spec's own partial-receipt example;
 *  - the same order's second line (Yerba mate) partially received by a
 *    DIFFERENT amount (80 ordered, 50 then 20 received, 10 pending);
 *  - a CONFIRMED order fully received in a single receipt (Resma A4 +
 *    Cuaderno);
 *  - a DRAFT order priced in USD, with zero stock effect;
 *  - a DRAFT -> CANCELLED order;
 *  - a direct receipt with no purchaseOrderId at all (Cable USB-C, into
 *    Depósito Sucursal Norte).
 */
async function seedDemoPurchases(
  tenantId: string,
  companyId: string,
  branchMainId: string,
  branchSecondaryId: string,
  warehouses: { central: { id: string }; sucursalNorte: { id: string } },
  supplierIdByCode: Map<string, string>,
): Promise<{ orderCount: number; receiptCount: number }> {
  const alreadySeeded = await prisma.purchaseOrder.count({ where: { companyId } });
  if (alreadySeeded > 0) {
    const [orderCount, receiptCount] = await Promise.all([
      prisma.purchaseOrder.count({ where: { companyId } }),
      prisma.purchaseReceipt.count({ where: { companyId } }),
    ]);
    return { orderCount, receiptCount };
  }

  const ars = await prisma.currency.findUniqueOrThrow({ where: { code: 'ARS' } });
  const usd = await prisma.currency.findUniqueOrThrow({ where: { code: 'USD' } });

  async function firstVariantId(productCode: string): Promise<string> {
    const product = await prisma.product.findUniqueOrThrow({
      where: { companyId_code: { companyId, code: productCode } },
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id, name: null },
    });
    return variant.id;
  }

  const cafeId = await firstVariantId('000003'); // Café 1 kg
  const yerbaId = await firstVariantId('000004'); // Yerba mate 1 kg
  const resmaId = await firstVariantId('000005'); // Resma A4
  const cuadernoId = await firstVariantId('000006'); // Cuaderno
  const cableId = await firstVariantId('000011'); // Cable USB-C
  const mouseId = await firstVariantId('000012'); // Mouse inalámbrico
  const tecladoId = await firstVariantId('000013'); // Teclado

  async function nextPoNumber(): Promise<string> {
    const seq = await prisma.purchaseOrderSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return `OC-${String(seq.lastValue).padStart(6, '0')}`;
  }

  function lineTotal(quantity: string, unitCost: string): string {
    return new Prisma.Decimal(quantity)
      .mul(unitCost)
      .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)
      .toString();
  }
  function sumLineTotals(
    lines: { quantity: string; unitCost: string }[],
  ): string {
    return lines
      .reduce(
        (sum, l) => sum.add(lineTotal(l.quantity, l.unitCost)),
        new Prisma.Decimal(0),
      )
      .toString();
  }

  /** Mirrors PurchaseReceiptsService.confirm's core transaction: one PurchaseReceipt (created straight into CONFIRMED) + one real PURCHASE StockMovement + atomic InventoryBalance increment per line. */
  async function confirmedReceipt(params: {
    supplierId: string;
    warehouseId: string;
    branchId: string;
    purchaseOrderId?: string;
    currencyId: string;
    receiptDate: Date;
    notes?: string;
    lines: {
      productVariantId: string;
      quantity: string;
      unitCostSnapshot: string;
      purchaseOrderLineId?: string;
    }[];
  }) {
    return prisma.$transaction(async (tx) => {
      const seq = await tx.purchaseReceiptSequence.upsert({
        where: { companyId },
        create: { companyId, lastValue: 1 },
        update: { lastValue: { increment: 1 } },
      });
      const number = `RC-${String(seq.lastValue).padStart(6, '0')}`;
      const created = await tx.purchaseReceipt.create({
        data: {
          tenantId,
          companyId,
          branchId: params.branchId,
          number,
          supplierId: params.supplierId,
          warehouseId: params.warehouseId,
          purchaseOrderId: params.purchaseOrderId ?? null,
          receiptDate: params.receiptDate,
          currencyId: params.currencyId,
          status: 'CONFIRMED',
          confirmedAt: params.receiptDate,
          notes: params.notes ?? null,
          lines: {
            create: params.lines.map((l) => ({
              productVariantId: l.productVariantId,
              quantity: l.quantity,
              unitCostSnapshot: l.unitCostSnapshot,
              purchaseOrderLineId: l.purchaseOrderLineId ?? null,
            })),
          },
        },
      });
      for (const line of params.lines) {
        await tx.stockMovement.create({
          data: {
            tenantId,
            companyId,
            warehouseId: params.warehouseId,
            productVariantId: line.productVariantId,
            movementType: 'PURCHASE',
            quantity: line.quantity,
            unitCost: line.unitCostSnapshot,
            currencyId: params.currencyId,
            referenceType: 'PurchaseReceipt',
            referenceId: created.id,
            occurredAt: params.receiptDate,
          },
        });
        await tx.inventoryBalance.upsert({
          where: {
            companyId_warehouseId_productVariantId: {
              companyId,
              warehouseId: params.warehouseId,
              productVariantId: line.productVariantId,
            },
          },
          create: {
            companyId,
            warehouseId: params.warehouseId,
            productVariantId: line.productVariantId,
            onHand: line.quantity,
            reserved: 0,
            incoming: 0,
          },
          update: { onHand: { increment: line.quantity } },
        });
      }
      return created;
    });
  }

  const mayoristaSupplierId = supplierIdByCode.get('000001')!;
  const andinaSupplierId = supplierIdByCode.get('000002')!;
  const fernandezSupplierId = supplierIdByCode.get('000003')!;
  const papeleraSupplierId = supplierIdByCode.get('000004')!;

  const now = new Date();
  function daysAgo(n: number): Date {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - n);
    return d;
  }

  // ---------- PO-1: CONFIRMED, partially received across two receipts ----------
  const po1Lines = [
    { productVariantId: cafeId, quantity: '100', unitCost: '12000' },
    { productVariantId: yerbaId, quantity: '80', unitCost: '5000' },
  ];
  const po1 = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      companyId,
      branchId: branchMainId,
      number: await nextPoNumber(),
      supplierId: mayoristaSupplierId,
      orderDate: daysAgo(10),
      currencyId: ars.id,
      status: 'CONFIRMED',
      confirmedAt: daysAgo(10),
      total: sumLineTotals(po1Lines),
      notes: 'Pedido mensual de café y yerba.',
      lines: {
        create: po1Lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: lineTotal(l.quantity, l.unitCost),
        })),
      },
    },
    include: { lines: true },
  });
  const po1Cafe = po1.lines.find((l) => l.productVariantId === cafeId)!;
  const po1Yerba = po1.lines.find((l) => l.productVariantId === yerbaId)!;

  await confirmedReceipt({
    supplierId: mayoristaSupplierId,
    warehouseId: warehouses.central.id,
    branchId: branchMainId,
    purchaseOrderId: po1.id,
    currencyId: ars.id,
    receiptDate: daysAgo(8),
    notes: 'Recepción parcial 1/2.',
    lines: [
      {
        productVariantId: cafeId,
        quantity: '40',
        unitCostSnapshot: '12000',
        purchaseOrderLineId: po1Cafe.id,
      },
      {
        productVariantId: yerbaId,
        quantity: '50',
        unitCostSnapshot: '5000',
        purchaseOrderLineId: po1Yerba.id,
      },
    ],
  });
  await confirmedReceipt({
    supplierId: mayoristaSupplierId,
    warehouseId: warehouses.central.id,
    branchId: branchMainId,
    purchaseOrderId: po1.id,
    currencyId: ars.id,
    receiptDate: daysAgo(3),
    notes:
      'Recepción parcial 2/2 — quedan pendientes 25 u. de café y 10 u. de yerba.',
    lines: [
      {
        productVariantId: cafeId,
        quantity: '35',
        unitCostSnapshot: '12000',
        purchaseOrderLineId: po1Cafe.id,
      },
      {
        productVariantId: yerbaId,
        quantity: '20',
        unitCostSnapshot: '5000',
        purchaseOrderLineId: po1Yerba.id,
      },
    ],
  });

  // ---------- PO-2: DRAFT, USD, zero stock effect ----------
  const po2Lines = [
    { productVariantId: mouseId, quantity: '15', unitCost: '25' },
    { productVariantId: tecladoId, quantity: '10', unitCost: '40' },
  ];
  await prisma.purchaseOrder.create({
    data: {
      tenantId,
      companyId,
      branchId: branchMainId,
      number: await nextPoNumber(),
      supplierId: andinaSupplierId,
      orderDate: daysAgo(1),
      currencyId: usd.id,
      status: 'DRAFT',
      total: sumLineTotals(po2Lines),
      notes: 'Cotización en dólares — pendiente de confirmar.',
      lines: {
        create: po2Lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: lineTotal(l.quantity, l.unitCost),
        })),
      },
    },
  });

  // ---------- PO-3: CONFIRMED, fully received in one receipt ----------
  const po3Lines = [
    { productVariantId: resmaId, quantity: '50', unitCost: '3000' },
    { productVariantId: cuadernoId, quantity: '40', unitCost: '1200' },
  ];
  const po3 = await prisma.purchaseOrder.create({
    data: {
      tenantId,
      companyId,
      branchId: branchMainId,
      number: await nextPoNumber(),
      supplierId: papeleraSupplierId,
      orderDate: daysAgo(6),
      currencyId: ars.id,
      status: 'CONFIRMED',
      confirmedAt: daysAgo(6),
      total: sumLineTotals(po3Lines),
      notes: 'Insumos de librería — recibido completo.',
      lines: {
        create: po3Lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: lineTotal(l.quantity, l.unitCost),
        })),
      },
    },
    include: { lines: true },
  });
  const po3Resma = po3.lines.find((l) => l.productVariantId === resmaId)!;
  const po3Cuaderno = po3.lines.find(
    (l) => l.productVariantId === cuadernoId,
  )!;
  await confirmedReceipt({
    supplierId: papeleraSupplierId,
    warehouseId: warehouses.central.id,
    branchId: branchMainId,
    purchaseOrderId: po3.id,
    currencyId: ars.id,
    receiptDate: daysAgo(5),
    notes: 'Recepción completa.',
    lines: [
      {
        productVariantId: resmaId,
        quantity: '50',
        unitCostSnapshot: '3000',
        purchaseOrderLineId: po3Resma.id,
      },
      {
        productVariantId: cuadernoId,
        quantity: '40',
        unitCostSnapshot: '1200',
        purchaseOrderLineId: po3Cuaderno.id,
      },
    ],
  });

  // ---------- PO-4: DRAFT -> CANCELLED ----------
  const po4Lines = [
    { productVariantId: cafeId, quantity: '20', unitCost: '12500' },
  ];
  await prisma.purchaseOrder.create({
    data: {
      tenantId,
      companyId,
      branchId: branchMainId,
      number: await nextPoNumber(),
      supplierId: mayoristaSupplierId,
      orderDate: daysAgo(15),
      currencyId: ars.id,
      status: 'CANCELLED',
      cancelledAt: daysAgo(14),
      total: sumLineTotals(po4Lines),
      notes: 'Pedido anulado — proveedor sin stock.',
      lines: {
        create: po4Lines.map((l) => ({
          productVariantId: l.productVariantId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          lineTotal: lineTotal(l.quantity, l.unitCost),
        })),
      },
    },
  });

  // ---------- Direct receipt, no PurchaseOrder ----------
  await confirmedReceipt({
    supplierId: fernandezSupplierId,
    warehouseId: warehouses.sucursalNorte.id,
    branchId: branchSecondaryId,
    currencyId: ars.id,
    receiptDate: daysAgo(2),
    notes: 'Recepción directa sin orden de compra.',
    lines: [
      { productVariantId: cableId, quantity: '20', unitCostSnapshot: '2000' },
    ],
  });

  const [orderCount, receiptCount] = await Promise.all([
    prisma.purchaseOrder.count({ where: { companyId } }),
    prisma.purchaseReceipt.count({ where: { companyId } }),
  ]);
  return { orderCount, receiptCount };
}

/**
 * Development seed: a demo tenant with two companies (so multi-company
 * selection is actually testable locally) and a real, usable admin
 * account with access to both. Also seeds a second tenant/company the
 * admin has NO membership in, for exercising tenant-isolation manually
 * (see apps/api/test/company-context.e2e-spec.ts for the automated
 * version of the same scenario) — it is deliberately never granted to
 * the seeded admin.
 *
 * Credentials come from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD so nothing
 * production-sensitive is hardcoded. In production, SEED_ADMIN_PASSWORD is
 * REQUIRED — this script refuses to silently create a known credential.
 * Locally, an obviously-fake default is used if it's left unset.
 * Idempotent: safe to run repeatedly (re-hashes the password each run, so
 * changing SEED_ADMIN_PASSWORD and re-seeding rotates the credential).
 */
async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.local')
    .trim()
    .toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (isProduction && !adminPassword) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required when NODE_ENV=production — refusing to create an admin account with a known/default password.',
    );
  }
  const resolvedPassword = adminPassword ?? DEV_ONLY_DEFAULT_PASSWORD;
  const policyCheck = passwordSchema.safeParse(resolvedPassword);
  if (!policyCheck.success) {
    throw new Error(
      `SEED_ADMIN_PASSWORD does not meet the password policy: ${policyCheck.error.issues[0].message}`,
    );
  }
  if (!adminPassword) {
    console.warn(
      `SEED_ADMIN_PASSWORD not set — using the local-only default (${DEV_ONLY_DEFAULT_PASSWORD}).`,
    );
  }

  // Central permission catalog — deterministic upsert by unique `code`,
  // safe to re-run (see packages/shared/src/permissions.ts).
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
    permissionIdByCode.set(definition.code, permission.id);
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: 'demo-organization' },
    update: {},
    create: {
      name: 'Demo Organization',
      slug: 'demo-organization',
      status: 'ACTIVE',
    },
  });

  // A believable, clearly fictional Argentine SME — see docs/demo-guide.md.
  // The CUIT/legalName/tradeName are entirely made up; no real company is
  // referenced or implied. Renaming requires a fresh `taxId` (part of the
  // upsert key) — see the reset workflow in docs/demo-guide.md, which
  // always runs `prisma migrate reset` before reseeding, so this never
  // creates a duplicate company row in normal use.
  const company = await prisma.company.upsert({
    where: { tenantId_taxId: { tenantId: tenant.id, taxId: '30-71876543-5' } },
    update: {
      legalName: 'Distribuidora Horizonte S.R.L.',
      tradeName: 'Distribuidora Horizonte',
    },
    create: {
      tenantId: tenant.id,
      legalName: 'Distribuidora Horizonte S.R.L.',
      tradeName: 'Distribuidora Horizonte',
      taxId: '30-71876543-5',
      countryCode: 'AR',
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'ACTIVE',
    },
  });

  const branchMain = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'MAIN' } },
    update: { name: 'Casa Central', status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'MAIN',
      name: 'Casa Central',
      status: 'ACTIVE',
    },
  });

  const branchSecondary = await prisma.branch.upsert({
    where: { companyId_code: { companyId: company.id, code: 'SUC2' } },
    update: { name: 'Sucursal Norte', status: 'ACTIVE' },
    create: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'SUC2',
      name: 'Sucursal Norte',
      status: 'ACTIVE',
    },
  });

  // A second company in the SAME tenant, also granted to the admin, so
  // multi-company selection has something real to select between locally.
  const secondCompany = await prisma.company.upsert({
    where: { tenantId_taxId: { tenantId: tenant.id, taxId: '00-00000001-0' } },
    update: {},
    create: {
      tenantId: tenant.id,
      legalName: 'Second Demo Company S.A.',
      tradeName: 'Second Demo Company',
      taxId: '00-00000001-0',
      countryCode: 'AR',
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'ACTIVE',
    },
  });
  await prisma.branch.upsert({
    where: { companyId_code: { companyId: secondCompany.id, code: 'MAIN' } },
    update: {},
    create: {
      tenantId: tenant.id,
      companyId: secondCompany.id,
      code: 'MAIN',
      name: 'Casa Central',
      status: 'ACTIVE',
    },
  });

  // A wholly separate tenant/company, deliberately NEVER granted to the
  // seeded admin — exists so tenant isolation can be exercised manually
  // (log in as the admin, request this company's id, expect denial).
  const otherTenant = await prisma.tenant.upsert({
    where: { slug: 'other-organization' },
    update: {},
    create: {
      name: 'Other Organization',
      slug: 'other-organization',
      status: 'ACTIVE',
    },
  });
  const otherCompany = await prisma.company.upsert({
    where: {
      tenantId_taxId: { tenantId: otherTenant.id, taxId: '00-00000002-0' },
    },
    update: {},
    create: {
      tenantId: otherTenant.id,
      legalName: 'Other Organization Company S.A.',
      tradeName: 'Other Org Company',
      taxId: '00-00000002-0',
      countryCode: 'AR',
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'ACTIVE',
    },
  });

  // System roles for every seeded company (see docs/authorization.md).
  const companyRoles = await seedSystemRoles(
    tenant.id,
    company.id,
    permissionIdByCode,
  );
  const secondCompanyRoles = await seedSystemRoles(
    tenant.id,
    secondCompany.id,
    permissionIdByCode,
  );
  await seedSystemRoles(otherTenant.id, otherCompany.id, permissionIdByCode);

  // Illustrative customers for Demo Company only — see docs/customers.md.
  await seedDemoCustomers(tenant.id, company.id);

  // Illustrative suppliers for Demo Company only — see docs/purchases.md.
  const supplierIdByCode = await seedDemoSuppliers(tenant.id, company.id);

  // Standard units for every seeded company (see docs/products.md);
  // illustrative products for Demo Company only.
  await seedProductUnits(tenant.id, secondCompany.id);
  await seedProductUnits(otherTenant.id, otherCompany.id);
  await seedDemoProducts(tenant.id, company.id);

  // Warehouses + illustrative initial stock for Demo Company only — see docs/inventory.md.
  const warehouses = await seedWarehousesAndStock(
    tenant.id,
    company.id,
    branchMain.id,
    branchSecondary.id,
  );

  // Global currency catalog + illustrative price lists/prices for Demo
  // Company only — see docs/pricing.md.
  await seedCurrencies();
  await seedDemoPricing(tenant.id, company.id);

  // Historical + demo sales — see docs/sales.md and docs/demo-guide.md.
  // Must run after customers/products/warehouses/pricing above (it reads
  // all of them). See seedDemoSales's own doc comment for why this
  // replicates SalesService's transaction logic directly rather than
  // calling the real service.
  const salesSummary = await seedDemoSales(
    tenant.id,
    company.id,
    branchMain.id,
    branchSecondary.id,
    warehouses,
  );

  // Illustrative purchase orders + goods receipts — see docs/purchases.md.
  // Must run after suppliers/products/warehouses/pricing (currencies)
  // above (it reads all of them).
  const purchasesSummary = await seedDemoPurchases(
    tenant.id,
    company.id,
    branchMain.id,
    branchSecondary.id,
    warehouses,
    supplierIdByCode,
  );

  const passwordHash = await argon2.hash(resolvedPassword, {
    type: argon2.argon2id,
  });
  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash,
      status: 'ACTIVE',
      firstName: 'Admin',
      lastName: 'User',
    },
    create: {
      firstName: 'Admin',
      lastName: 'User',
      email: adminEmail,
      passwordHash,
      status: 'ACTIVE',
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
  await prisma.userCompany.upsert({
    where: {
      userId_companyId: { userId: user.id, companyId: secondCompany.id },
    },
    update: {},
    create: {
      userId: user.id,
      tenantId: tenant.id,
      companyId: secondCompany.id,
      active: true,
    },
  });

  // The seeded admin gets the Administrador (ADMIN) system role in both
  // demo companies, so manual testing works immediately after seeding.
  const adminRoleId = companyRoles.get('Administrador');
  const secondAdminRoleId = secondCompanyRoles.get('Administrador');
  if (adminRoleId) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId_companyId: {
          userId: user.id,
          roleId: adminRoleId,
          companyId: company.id,
        },
      },
      update: {},
      create: { userId: user.id, roleId: adminRoleId, companyId: company.id },
    });
  }
  if (secondAdminRoleId) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId_companyId: {
          userId: user.id,
          roleId: secondAdminRoleId,
          companyId: secondCompany.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: secondAdminRoleId,
        companyId: secondCompany.id,
      },
    });
  }

  console.log('Seed complete:');
  console.log(`  Tenant:      ${tenant.name} (${tenant.slug})`);
  console.log(
    `  Company:     ${company.legalName} — branches: ${branchMain.name}, ${branchSecondary.name}`,
  );
  console.log(`  Company:     ${secondCompany.legalName}`);
  console.log(
    `  Other tenant (not granted to admin): ${otherTenant.name} / ${otherCompany.legalName}`,
  );
  console.log(
    `  Admin:       ${user.email} (password set from SEED_ADMIN_PASSWORD) — access to both Demo companies`,
  );
  console.log(
    `  Roles:       ${PERMISSION_CATALOG.length} permissions, ${SYSTEM_ROLES.length} system roles seeded per company; admin holds "Administrador" in both Demo companies`,
  );
  console.log(
    '  Customers:   16 demo customers (incl. Consumidor Final, Ferretería El Puente, 1 INACTIVE) + 3 categories in Distribuidora Horizonte',
  );
  console.log(
    '  Products:    8 units of measure per company; 17 demo products / 21 sellable variants (incl. Buzo con capucha [4 variants], 3 services, 1 INACTIVE, 1 zero-stock) + 6 categories + 1 brand in Distribuidora Horizonte',
  );
  console.log(
    '  Inventory:   3 warehouses (Depósito Central, Salón de Ventas, Depósito Sucursal Norte) + initial stock via real StockMovement rows in Distribuidora Horizonte',
  );
  console.log(
    '  Pricing:     3 currencies (ARS, USD, EUR) + 3 price lists (Minorista fija/predeterminada, Mayorista -10%, Distribuidor -15%) + initial prices via real PriceListItem rows in Distribuidora Horizonte',
  );
  console.log(
    '  Suppliers:   5 demo suppliers (incl. 1 individual monotributista, 1 INACTIVE) in Distribuidora Horizonte',
  );
  console.log(
    `  Purchases:   ${purchasesSummary.orderCount} purchase orders (DRAFT/CONFIRMED/CANCELLED, incl. 1 partially received across 2 receipts) + ${purchasesSummary.receiptCount} goods receipts (incl. 1 direct receipt with no PO) in Distribuidora Horizonte`,
  );
  console.log(
    `  Sales:       ${salesSummary.confirmedCount} confirmed sales across ${salesSummary.distinctDays} days (${salesSummary.tenderCounts}) + ${salesSummary.draftCount} draft in Distribuidora Horizonte`,
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
