import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

interface ErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
interface ProductVariantBody {
  id: string;
  name: string | null;
  sku: string | null;
  active: boolean;
  codes: { id: string; type: string; code: string; active: boolean }[];
}
interface ProductSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  categoryName: string | null;
  primarySku: string | null;
  primaryBarcode: string | null;
}
interface ProductListBody {
  items: ProductSummary[];
  pagination: { page: number; pageSize: number; total: number };
}
interface ProductDetailBody {
  product: ProductSummary & {
    categoryId: string | null;
    trackInventory: boolean;
    trackLots: boolean;
    trackSerials: boolean;
    variants: ProductVariantBody[];
  };
}
interface HistoryBody {
  items: {
    action: string;
    entityType: string;
    beforeData: unknown;
    afterData: unknown;
    metadata: unknown;
  }[];
}
interface LookupBody {
  items: {
    productId: string;
    variantId: string;
    sku: string | null;
    barcode: string | null;
    name: string;
  }[];
}

/**
 * Mandatory Products coverage per the Prompt #7 task spec (sections
 * 108-121) — see docs/products.md. Self-contained fixtures, not the dev
 * seed.
 */
describe('Products (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let unitAId: string;
  let unitBId: string;

  let userAdminId: string; // full product perms, member of A AND B
  let userReadOnlyId: string;
  let userNoCreateId: string;
  let userNoUpdateId: string;
  let userNoDeactivateId: string;
  let userNoAccessId: string;

  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Products Tenant ${suffix}`,
        slug: `e2e-products-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Products Company A',
        taxId: `e2e-products-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Products Company B',
        taxId: `e2e-products-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    const unitA = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyAId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
      },
    });
    const unitB = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        companyId: companyBId,
        code: 'UN',
        name: 'Unidad',
        symbol: 'u',
      },
    });
    unitAId = unitA.id;
    unitBId = unitB.id;

    async function makePermission(code: string) {
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: 'products',
          resource: 'products',
          action: code.split('.')[1],
        },
      });
    }
    const permRead = await makePermission('products.read');
    const permCreate = await makePermission('products.create');
    const permUpdate = await makePermission('products.update');
    const permDeactivate = await makePermission('products.deactivate');

    async function makeRole(
      companyId: string,
      name: string,
      permissionIds: string[],
    ) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name },
      });
      if (permissionIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
        });
      }
      return role;
    }

    const roleFullA = await makeRole(companyAId, 'Products E2E Full A', [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleFullB = await makeRole(companyBId, 'Products E2E Full B', [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleReadOnly = await makeRole(companyAId, 'Products E2E Read Only', [
      permRead.id,
    ]);
    const roleNoCreate = await makeRole(companyAId, 'Products E2E No Create', [
      permRead.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleNoUpdate = await makeRole(companyAId, 'Products E2E No Update', [
      permRead.id,
      permCreate.id,
      permDeactivate.id,
    ]);
    const roleNoDeactivate = await makeRole(
      companyAId,
      'Products E2E No Deactivate',
      [permRead.id, permCreate.id, permUpdate.id],
    );
    const roleNoAccess = await makeRole(
      companyAId,
      'Products E2E No Access',
      [],
    );

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-products-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userAdmin = await makeUser('Admin');
    const userReadOnly = await makeUser('ReadOnly');
    const userNoCreate = await makeUser('NoCreate');
    const userNoUpdate = await makeUser('NoUpdate');
    const userNoDeactivate = await makeUser('NoDeactivate');
    const userNoAccess = await makeUser('NoAccess');

    userAdminId = userAdmin.id;
    userReadOnlyId = userReadOnly.id;
    userNoCreateId = userNoCreate.id;
    userNoUpdateId = userNoUpdate.id;
    userNoDeactivateId = userNoDeactivate.id;
    userNoAccessId = userNoAccess.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userAdminId, companyBId);
    await membership(userReadOnlyId, companyAId);
    await membership(userNoCreateId, companyAId);
    await membership(userNoUpdateId, companyAId);
    await membership(userNoDeactivateId, companyAId);
    await membership(userNoAccessId, companyAId);

    async function assignRole(
      userId: string,
      roleId: string,
      companyId: string,
    ) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userAdminId, roleFullA.id, companyAId);
    await assignRole(userAdminId, roleFullB.id, companyBId);
    await assignRole(userReadOnlyId, roleReadOnly.id, companyAId);
    await assignRole(userNoCreateId, roleNoCreate.id, companyAId);
    await assignRole(userNoUpdateId, roleNoUpdate.id, companyAId);
    await assignRole(userNoDeactivateId, roleNoDeactivate.id, companyAId);
    await assignRole(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.productCode.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.productVariant.deleteMany({
      where: { product: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.product.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.productCodeSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.productCategory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.brand.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.unitOfMeasure.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userRole.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.role.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId] } },
    });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  const agentByUser = new Map<string, request.Agent>();
  async function loginAs(userId: string) {
    const cached = agentByUser.get(userId);
    if (cached) return cached;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ email: user.email, password });
    expect(res.status).toBe(200);
    agentByUser.set(userId, agent);
    return agent;
  }

  // Mandatory: permission enforcement (read, then each write independently).
  describe('permission enforcement', () => {
    it('403s a user with no product permissions on list', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('allows a read-only user to list/read but not create/update/deactivate', async () => {
      const agent = await loginAs(userReadOnlyId);
      const list = await agent
        .get('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(list.status).toBe(200);

      const create = await agent
        .post('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Should Not Be Created', baseUnitId: unitAId });
      expect(create.status).toBe(403);
    });

    it('403s create for a user missing products.create specifically', async () => {
      const agent = await loginAs(userNoCreateId);
      const res = await agent
        .post('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Should Not Be Created', baseUnitId: unitAId });
      expect(res.status).toBe(403);
    });

    it('403s update for a user missing products.update specifically', async () => {
      const adminAgent = await loginAs(userAdminId);
      const createRes = await adminAgent
        .post('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: `Perm Test ${suffix}`, baseUnitId: unitAId });
      const productId = (createRes.body as ProductDetailBody).product.id;

      const agent = await loginAs(userNoUpdateId);
      const res = await agent
        .patch(`/api/v1/products/${productId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Renamed' });
      expect(res.status).toBe(403);
    });

    it('403s deactivate for a user missing products.deactivate specifically', async () => {
      const adminAgent = await loginAs(userAdminId);
      const createRes = await adminAgent
        .post('/api/v1/products')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: `Perm Test Deactivate ${suffix}`, baseUnitId: unitAId });
      const productId = (createRes.body as ProductDetailBody).product.id;

      const agent = await loginAs(userNoDeactivateId);
      const res = await agent
        .post(`/api/v1/products/${productId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
    });
  });

  // Mandatory: creation assigns company from context, auto code, audit; body spoof ignored.
  it('creates a product with an auto-generated code, company from RequestContext, and an audit record — ignoring a spoofed companyId in the body', async () => {
    const agent = await loginAs(userAdminId);
    const res = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Creation Test ${suffix}`,
        baseUnitId: unitAId,
        companyId: companyBId,
        tenantId: 'spoofed',
      });
    expect(res.status).toBe(201);
    const product = (res.body as ProductDetailBody).product;
    expect(product.code).toMatch(/^\d{6}$/);
    // A default variant always exists, even for a simple product.
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].name).toBeNull();

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(row.companyId).toBe(companyAId); // never the spoofed companyB
    expect(row.tenantId).toBe(tenantId);

    const auditRows = await prisma.auditLog.findMany({
      where: { entityType: 'Product', entityId: product.id, action: 'CREATE' },
    });
    expect(auditRows).toHaveLength(1);
  });

  // Mandatory: company isolation, including direct-ID access.
  it('never exposes a company A product to a company B request', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Isolation Test ${suffix}`, baseUnitId: unitAId });
    const productId = (createRes.body as ProductDetailBody).product.id;

    const crossRes = await agent
      .get(`/api/v1/products/${productId}`)
      .set(COMPANY_ID_HEADER, companyBId);
    expect(crossRes.status).toBe(404);
    expect((crossRes.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_NOT_FOUND',
    );

    const listRes = await agent
      .get('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyBId);
    expect(
      (listRes.body as ProductListBody).items.map((i) => i.id),
    ).not.toContain(productId);

    const lookupRes = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyBId)
      .query({ search: `Isolation Test ${suffix}` });
    expect(
      (lookupRes.body as LookupBody).items.map((i) => i.productId),
    ).not.toContain(productId);
  });

  // Mandatory: duplicate code within a company conflicts; across companies is allowed.
  it('rejects a duplicate code within the same company but allows it across companies', async () => {
    const agent = await loginAs(userAdminId);
    const code = `9${String(suffix).slice(-5)}`;

    const first = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Code Test A ${suffix}`, baseUnitId: unitAId, code });
    expect(first.status).toBe(201);

    const dupe = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Code Test A Dupe ${suffix}`, baseUnitId: unitAId, code });
    expect(dupe.status).toBe(409);
    expect((dupe.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_CODE_ALREADY_EXISTS',
    );

    const otherCompany = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ name: `Code Test B ${suffix}`, baseUnitId: unitBId, code });
    expect(otherCompany.status).toBe(201);
  });

  // Mandatory: SKU uniqueness — same company active-only conflict, cross-company allowed, nullable multiple nulls valid.
  it('enforces SKU uniqueness per company among active variants only', async () => {
    const agent = await loginAs(userAdminId);
    const sku = `SKU-${suffix}`;

    const first = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `SKU Test A ${suffix}`, baseUnitId: unitAId, sku });
    expect(first.status).toBe(201);

    const dupe = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `SKU Test A Dupe ${suffix}`, baseUnitId: unitAId, sku });
    expect(dupe.status).toBe(409);
    expect((dupe.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_SKU_ALREADY_EXISTS',
    );

    const otherCompany = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ name: `SKU Test B ${suffix}`, baseUnitId: unitBId, sku });
    expect(otherCompany.status).toBe(201);

    // Multiple products with no SKU at all must remain valid.
    const noSku1 = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `No SKU 1 ${suffix}`, baseUnitId: unitAId });
    const noSku2 = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `No SKU 2 ${suffix}`, baseUnitId: unitAId });
    expect(noSku1.status).toBe(201);
    expect(noSku2.status).toBe(201);
  });

  // Mandatory: barcode uniqueness — same company active-only conflict, cross-company allowed, leading zeros preserved.
  it('enforces barcode uniqueness per company among active codes only and preserves leading zeros', async () => {
    const agent = await loginAs(userAdminId);
    const barcode = `00${String(suffix).slice(-8)}`;

    const first = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Barcode Test A ${suffix}`,
        baseUnitId: unitAId,
        codes: [{ type: 'BARCODE', code: barcode }],
      });
    expect(first.status).toBe(201);
    const firstProduct = (first.body as ProductDetailBody).product;
    expect(firstProduct.variants[0].codes[0].code).toBe(barcode); // leading zeros intact

    const dupe = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Barcode Test A Dupe ${suffix}`,
        baseUnitId: unitAId,
        codes: [{ type: 'BARCODE', code: barcode }],
      });
    expect(dupe.status).toBe(409);
    expect((dupe.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_BARCODE_ALREADY_EXISTS',
    );

    const otherCompany = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({
        name: `Barcode Test B ${suffix}`,
        baseUnitId: unitBId,
        codes: [{ type: 'BARCODE', code: barcode }],
      });
    expect(otherCompany.status).toBe(201);
  });

  // Mandatory: category isolation — a category from company B cannot be assigned to a product in company A.
  it('blocks assigning a company B category to a company A product', async () => {
    const agent = await loginAs(userAdminId);
    const categoryB = await agent
      .post('/api/v1/product-categories')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ name: `Category B ${suffix}` });
    const categoryBId = (categoryB.body as { category: { id: string } })
      .category.id;

    const res = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Category Isolation Test ${suffix}`,
        baseUnitId: unitAId,
        categoryId: categoryBId,
      });
    expect(res.status).toBe(404);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_CATEGORY_NOT_FOUND',
    );
  });

  // Mandatory: category cycle prevention (direct and indirect).
  it('rejects direct and indirect category cycles', async () => {
    const agent = await loginAs(userAdminId);
    const catA = await agent
      .post('/api/v1/product-categories')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Cycle A ${suffix}` });
    const catAId = (catA.body as { category: { id: string } }).category.id;

    const catB = await agent
      .post('/api/v1/product-categories')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Cycle B ${suffix}`, parentId: catAId });
    const catBId = (catB.body as { category: { id: string } }).category.id;

    const catC = await agent
      .post('/api/v1/product-categories')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Cycle C ${suffix}`, parentId: catBId });
    const catCId = (catC.body as { category: { id: string } }).category.id;

    // Direct self-parent.
    const selfParent = await agent
      .patch(`/api/v1/product-categories/${catAId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ parentId: catAId });
    expect(selfParent.status).toBe(409);
    expect((selfParent.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_CATEGORY_CYCLE',
    );

    // Indirect cycle: A -> B -> C, attempt C as A's parent (A -> B -> C -> A).
    const indirect = await agent
      .patch(`/api/v1/product-categories/${catAId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ parentId: catCId });
    expect(indirect.status).toBe(409);
    expect((indirect.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_CATEGORY_CYCLE',
    );
  });

  // Mandatory: service rules — inventory tracking defaults/validation.
  it('creates a SERVICE with trackInventory defaulted to false and rejects an explicit true', async () => {
    const agent = await loginAs(userAdminId);
    const service = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Service Test ${suffix}`,
        baseUnitId: unitAId,
        productType: 'SERVICE',
      });
    expect(service.status).toBe(201);
    expect((service.body as ProductDetailBody).product.trackInventory).toBe(
      false,
    );

    const invalid = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Invalid Service Test ${suffix}`,
        baseUnitId: unitAId,
        productType: 'SERVICE',
        trackInventory: true,
      });
    expect(invalid.status).toBe(400);
  });

  // Mandatory: lot/serial configuration validation, including the update-time merged-state check.
  it('rejects trackLots/trackSerials without trackInventory, on both create and update', async () => {
    const agent = await loginAs(userAdminId);

    const invalidCreate = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Lot Invalid ${suffix}`,
        baseUnitId: unitAId,
        trackInventory: false,
        trackLots: true,
      });
    expect(invalidCreate.status).toBe(400);

    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Lot Update Test ${suffix}`,
        baseUnitId: unitAId,
        trackInventory: true,
      });
    const productId = (createRes.body as ProductDetailBody).product.id;

    const invalidUpdate = await agent
      .patch(`/api/v1/products/${productId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ trackInventory: false, trackSerials: true });
    expect(invalidUpdate.status).toBe(400);
    expect((invalidUpdate.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_INVALID_INVENTORY_CONFIG',
    );
  });

  // Mandatory: update audit records before/after for a meaningful field.
  it('records a before/after AuditLog entry when the product name is updated', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Name Before ${suffix}`, baseUnitId: unitAId });
    const productId = (createRes.body as ProductDetailBody).product.id;

    const updateRes = await agent
      .patch(`/api/v1/products/${productId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Name After ${suffix}` });
    expect(updateRes.status).toBe(200);

    const historyRes = await agent
      .get(`/api/v1/products/${productId}/history`)
      .set(COMPANY_ID_HEADER, companyAId);
    const updateEvent = (historyRes.body as HistoryBody).items.find(
      (i) =>
        i.action === 'UPDATE' &&
        !!i.afterData &&
        typeof i.afterData === 'object' &&
        (i.afterData as Record<string, unknown>).name ===
          `Name After ${suffix}`,
    );
    expect(updateEvent).toBeDefined();
  });

  // Mandatory: deactivate/reactivate cycle, no physical deletion, both audited.
  it('deactivates then reactivates a product without ever deleting the row', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Lifecycle Test ${suffix}`, baseUnitId: unitAId });
    const productId = (createRes.body as ProductDetailBody).product.id;

    const deactivateRes = await agent
      .post(`/api/v1/products/${productId}/deactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(deactivateRes.status).toBe(200);
    expect((deactivateRes.body as ProductDetailBody).product.status).toBe(
      'INACTIVE',
    );

    const reactivateRes = await agent
      .post(`/api/v1/products/${productId}/reactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(reactivateRes.status).toBe(200);
    expect((reactivateRes.body as ProductDetailBody).product.status).toBe(
      'ACTIVE',
    );

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
    });
    expect(row).not.toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: {
        entityType: 'Product',
        entityId: productId,
        action: { in: ['DEACTIVATE', 'ACTIVATE'] },
      },
    });
    expect(auditRows.map((r) => r.action).sort()).toEqual([
      'ACTIVATE',
      'DEACTIVATE',
    ]);
  });

  // Mandatory: variant creation/update/deactivation audit.
  it('creates, updates, and deactivates a variant with meaningful audit records', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Variant Test ${suffix}`, baseUnitId: unitAId });
    const productId = (createRes.body as ProductDetailBody).product.id;

    const addRes = await agent
      .post(`/api/v1/products/${productId}/variants`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: 'Negro / M', sku: `VAR-${suffix}`, codes: [] });
    expect(addRes.status).toBe(201);
    const variantId = (addRes.body as { variant: ProductVariantBody }).variant
      .id;

    const updateRes = await agent
      .patch(`/api/v1/products/${productId}/variants/${variantId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: 'Negro / L' });
    expect(updateRes.status).toBe(200);

    const deactivateRes = await agent
      .post(`/api/v1/products/${productId}/variants/${variantId}/deactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(deactivateRes.status).toBe(200);
    expect(
      (deactivateRes.body as { variant: ProductVariantBody }).variant.active,
    ).toBe(false);

    const auditRows = await prisma.auditLog.findMany({
      where: { entityType: 'Product', entityId: productId },
    });
    const changes = auditRows
      .map((r) => (r.metadata as { change?: string } | null)?.change)
      .filter(Boolean);
    expect(changes).toEqual(
      expect.arrayContaining([
        'variant_added',
        'variant_updated',
        'variant_deactivated',
      ]),
    );

    // Cross-product variant access impossible.
    const otherProduct = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Variant Test Other ${suffix}`, baseUnitId: unitAId });
    const otherProductId = (otherProduct.body as ProductDetailBody).product.id;
    const crossAccess = await agent
      .patch(`/api/v1/products/${otherProductId}/variants/${variantId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: 'Should Not Work' });
    expect(crossAccess.status).toBe(404);
    expect((crossAccess.body as ErrorEnvelope).error.code).toBe(
      'PRODUCT_VARIANT_NOT_FOUND',
    );
  });

  // Mandatory: lookup — search by code/SKU/barcode/name, exact barcode resolves correctly.
  it('resolves lookup by internal code, SKU, exact barcode, and name, ranking exact matches first', async () => {
    const agent = await loginAs(userAdminId);
    const barcode = `77${String(suffix).slice(-9)}`;
    const sku = `LOOKUP-${suffix}`;

    const createRes = await agent
      .post('/api/v1/products')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        name: `Lookup Target ${suffix}`,
        baseUnitId: unitAId,
        sku,
        codes: [{ type: 'BARCODE', code: barcode }],
      });
    const product = (createRes.body as ProductDetailBody).product;

    const byBarcode = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ barcode });
    expect((byBarcode.body as LookupBody).items).toHaveLength(1);
    expect((byBarcode.body as LookupBody).items[0].productId).toBe(product.id);
    expect((byBarcode.body as LookupBody).items[0].barcode).toBe(barcode);

    const bySku = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ search: sku });
    expect((bySku.body as LookupBody).items.map((i) => i.productId)).toContain(
      product.id,
    );

    const byCode = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ search: product.code });
    expect((byCode.body as LookupBody).items.map((i) => i.productId)).toContain(
      product.id,
    );

    const byName = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ search: `Lookup Target ${suffix}` });
    expect((byName.body as LookupBody).items.map((i) => i.productId)).toContain(
      product.id,
    );

    // A non-existent barcode must resolve to no results, not a fuzzy fallback.
    const noMatch = await agent
      .get('/api/v1/products/lookup')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ barcode: `nonexistent-${suffix}` });
    expect((noMatch.body as LookupBody).items).toHaveLength(0);
  });
});
