import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordSchema, PERMISSION_CATALOG } from '@erp/shared';
import { PrismaClient } from '../src/generated/prisma/client';

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
      'purchases.orders.read',
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
    description: 'Gestiona órdenes de compra.',
    permissionCodes: [
      'apps.gestion.access',
      'products.read',
      'products.create',
      'products.update',
      'inventory.warehouses.read',
      'inventory.stock.read',
      'pricing.lists.read',
      'pricing.prices.read',
      'purchases.orders.read',
      'purchases.orders.create',
      'purchases.orders.approve',
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
      'purchases.orders.read',
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
 * A handful of illustrative customers for Demo Company — different types,
 * tax conditions, addresses, contacts and categories, not a bulk dataset
 * (see docs/customers.md and CLAUDE.md's anti-over-seeding guidance).
 * Idempotent: customers upsert by companyId+code; addresses/contacts have
 * no natural unique key, so they're created only if not already present.
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
    customerType: 'COMPANY' | 'FINAL_CONSUMER';
    legalName: string;
    tradeName?: string;
    documentType?: 'CUIT';
    taxId?: string;
    taxCondition: 'CONSUMIDOR_FINAL' | 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO';
    email?: string;
    phone?: string;
    categoryNames?: string[];
  }) {
    const customer = await prisma.customer.upsert({
      where: { companyId_code: { companyId, code: params.code } },
      update: {},
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

  await upsertCustomer({
    code: '000001',
    customerType: 'FINAL_CONSUMER',
    legalName: 'Consumidor Final',
    taxCondition: 'CONSUMIDOR_FINAL',
  });

  const demo = await upsertCustomer({
    code: '000002',
    customerType: 'COMPANY',
    legalName: 'Cliente Demo S.A.',
    tradeName: 'Demo Comercial',
    documentType: 'CUIT',
    taxId: '30712345671',
    taxCondition: 'RESPONSABLE_INSCRIPTO',
    email: 'contacto@democomercial.example',
    phone: '011-4555-0100',
    categoryNames: ['Mayorista'],
  });
  await ensureAddress(demo.id, 'FISCAL', {
    street: 'Av. Corrientes',
    number: '1234',
    city: 'Ciudad Autónoma de Buenos Aires',
    province: 'Ciudad Autónoma de Buenos Aires',
    postalCode: 'C1043AAZ',
    isDefault: true,
  });
  await ensureContact(demo.id, 'María López', {
    role: 'Administración',
    email: 'maria.lopez@democomercial.example',
    phone: '011-4555-0101',
    isPrimary: true,
  });

  const sur = await upsertCustomer({
    code: '000003',
    customerType: 'COMPANY',
    legalName: 'Comercial del Sur S.R.L.',
    tradeName: 'Comercial del Sur',
    documentType: 'CUIT',
    taxId: '30334455668',
    taxCondition: 'MONOTRIBUTO',
    phone: '0291-456-7890',
    categoryNames: ['Minorista'],
  });
  await ensureAddress(sur.id, 'FISCAL', {
    street: 'San Martín',
    number: '567',
    city: 'Bahía Blanca',
    province: 'Buenos Aires',
    postalCode: 'B8000',
    isDefault: true,
  });
  await ensureContact(sur.id, 'Carlos Díaz', {
    role: 'Compras',
    phone: '0291-456-7891',
    isPrimary: true,
  });

  // The customers above use manual codes (000001-000003), bypassing
  // CustomerCodeSequence — advance the counter past them so the first
  // customer created through the UI/API doesn't collide with a seeded
  // code (see docs/customers.md). Only raises the counter, never lowers
  // it, so this stays safe to re-run after real customers already exist
  // with a higher sequence value.
  const currentSequence = await prisma.customerCodeSequence.findUnique({
    where: { companyId },
  });
  if (!currentSequence) {
    await prisma.customerCodeSequence.create({
      data: { companyId, lastValue: 3 },
    });
  } else if (currentSequence.lastValue < 3) {
    await prisma.customerCodeSequence.update({
      where: { companyId },
      data: { lastValue: 3 },
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
  }) {
    return prisma.product.upsert({
      where: { companyId_code: { companyId, code: params.code } },
      update: {},
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
  const marcaPropiaId = await ensureBrand('Marca Propia');

  const gaseosa = await upsertProduct({
    code: '000001',
    name: 'Gaseosa cola 500 ml',
    productType: 'PRODUCT',
    categoryId: bebidasId,
    trackInventory: true,
  });
  const gaseosaVariant = await ensureVariant(gaseosa.id, null, null);
  await ensureCode(gaseosaVariant.id, 'BARCODE', '7790001000012');

  const cafe = await upsertProduct({
    code: '000002',
    name: 'Café 1 kg',
    productType: 'PRODUCT',
    categoryId: alimentosId,
    brandId: marcaPropiaId,
    trackInventory: true,
  });
  await ensureVariant(cafe.id, null, 'CAFE-1KG');

  const buzo = await upsertProduct({
    code: '000003',
    name: 'Buzo con capucha',
    productType: 'PRODUCT',
    trackInventory: true,
  });
  await ensureVariant(buzo.id, 'Gris / M', 'BUZO-GRIS-M', {
    color: 'Gris',
    talle: 'M',
  });
  await ensureVariant(buzo.id, 'Gris / L', 'BUZO-GRIS-L', {
    color: 'Gris',
    talle: 'L',
  });

  const flete = await upsertProduct({
    code: '000004',
    name: 'Servicio de flete',
    productType: 'SERVICE',
    categoryId: serviciosId,
    trackInventory: false,
  });
  await ensureVariant(flete.id, null, null);

  // Same collision-prevention fix as CustomerCodeSequence (see
  // seedDemoCustomers above and docs/products.md) — these products use
  // manual codes, bypassing ProductCodeSequence, so the counter must be
  // advanced past them before the first UI/API-created product. Only
  // raises the counter, never lowers it.
  const currentSequence = await prisma.productCodeSequence.findUnique({
    where: { companyId },
  });
  if (!currentSequence) {
    await prisma.productCodeSequence.create({
      data: { companyId, lastValue: 4 },
    });
  } else if (currentSequence.lastValue < 4) {
    await prisma.productCodeSequence.update({
      where: { companyId },
      data: { lastValue: 4 },
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
 * Two demo warehouses (see docs/inventory.md) plus illustrative initial
 * stock for Demo Company's seeded products, exercised through real
 * StockMovement rows (see ensureInitialBalance) rather than a direct
 * InventoryBalance insert — per the task spec's explicit requirement
 * that seed stock come from real ledger behavior.
 */
async function seedWarehousesAndStock(
  tenantId: string,
  companyId: string,
  branchMainId: string,
  branchSecondaryId: string,
) {
  const central = await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'CENTRAL' } },
    update: {},
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
  await prisma.warehouse.upsert({
    where: { companyId_code: { companyId, code: 'SUC2' } },
    update: {},
    create: {
      tenantId,
      companyId,
      branchId: branchSecondaryId,
      code: 'SUC2',
      name: 'Depósito Sucursal 2',
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
  const cafeId = await firstVariantId('000002'); // Café 1 kg
  const buzoGrisM = await namedVariantId('000003', 'Gris / M'); // Buzo con capucha
  const buzoGrisL = await namedVariantId('000003', 'Gris / L');

  if (gaseosaId)
    await ensureInitialBalance(
      tenantId,
      companyId,
      central.id,
      gaseosaId,
      '100',
    );
  if (cafeId)
    await ensureInitialBalance(tenantId, companyId, central.id, cafeId, '40');
  if (buzoGrisM)
    await ensureInitialBalance(
      tenantId,
      companyId,
      central.id,
      buzoGrisM,
      '15',
    );
  if (buzoGrisL)
    await ensureInitialBalance(
      tenantId,
      companyId,
      central.id,
      buzoGrisL,
      '12',
    );
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
  const cafeId = await firstVariantId('000002'); // Café 1 kg
  const buzoGrisM = await namedVariantId('000003', 'Gris / M'); // Buzo con capucha
  const buzoGrisL = await namedVariantId('000003', 'Gris / L');
  const fleteId = await firstVariantId('000004'); // Servicio de flete

  if (gaseosaId)
    await ensureInitialPrice(
      tenantId,
      companyId,
      minorista.id,
      gaseosaId,
      '1200',
    );
  if (cafeId)
    await ensureInitialPrice(
      tenantId,
      companyId,
      minorista.id,
      cafeId,
      '18500',
    );
  if (buzoGrisM)
    await ensureInitialPrice(
      tenantId,
      companyId,
      minorista.id,
      buzoGrisM,
      '25000',
    );
  if (buzoGrisL)
    await ensureInitialPrice(
      tenantId,
      companyId,
      minorista.id,
      buzoGrisL,
      '25000',
    );
  if (fleteId)
    await ensureInitialPrice(
      tenantId,
      companyId,
      minorista.id,
      fleteId,
      '30000',
    );
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
    update: {},
    create: {
      tenantId: tenant.id,
      companyId: company.id,
      code: 'SUC2',
      name: 'Sucursal 2',
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

  // Standard units for every seeded company (see docs/products.md);
  // illustrative products for Demo Company only.
  await seedProductUnits(tenant.id, secondCompany.id);
  await seedProductUnits(otherTenant.id, otherCompany.id);
  await seedDemoProducts(tenant.id, company.id);

  // Warehouses + illustrative initial stock for Demo Company only — see docs/inventory.md.
  await seedWarehousesAndStock(
    tenant.id,
    company.id,
    branchMain.id,
    branchSecondary.id,
  );

  // Global currency catalog + illustrative price lists/prices for Demo
  // Company only — see docs/pricing.md.
  await seedCurrencies();
  await seedDemoPricing(tenant.id, company.id);

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
    '  Customers:   3 demo customers (Consumidor Final, Cliente Demo S.A., Comercial del Sur S.R.L.) + 3 categories in Demo Company',
  );
  console.log(
    '  Products:    8 units of measure per company; 4 demo products (Gaseosa cola 500 ml, Café 1 kg, Buzo con capucha [2 variants], Servicio de flete) + 3 categories + 1 brand in Demo Company',
  );
  console.log(
    '  Inventory:   2 warehouses (Depósito Central, Depósito Sucursal 2) + initial stock via real StockMovement rows in Demo Company',
  );
  console.log(
    '  Pricing:     3 currencies (ARS, USD, EUR) + 3 price lists (Minorista fija/predeterminada, Mayorista -10%, Distribuidor -15%) + initial prices via real PriceListItem rows in Demo Company',
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
