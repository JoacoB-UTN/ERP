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
interface CustomerSummary {
  id: string;
  code: string;
  legalName: string;
  taxId: string | null;
  status: string;
}
interface CustomerListBody {
  items: CustomerSummary[];
  pagination: { page: number; pageSize: number; total: number };
}
interface CustomerDetailBody {
  customer: CustomerSummary & {
    creditLimit: string | null;
    addresses: { id: string; type: string; isDefault: boolean; city: string }[];
    contacts: { id: string; name: string; isPrimary: boolean }[];
    categories: { id: string; name: string }[];
  };
}
interface HistoryBody {
  items: {
    action: string;
    entityType: string;
    beforeData: unknown;
    afterData: unknown;
  }[];
}

/**
 * Mandatory Customers coverage per Prompt #6 (sections 92-104) — see
 * docs/customers.md. Self-contained fixtures, not the dev seed.
 */
describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let userAdminId: string; // full customer perms, member of A AND B
  let userReadOnlyId: string; // read only, company A
  let userNoCreateId: string; // read+update+deactivate, company A
  let userNoUpdateId: string; // read+create+deactivate, company A
  let userNoDeactivateId: string; // read+create+update, company A
  let userNoAccessId: string; // no customer permissions, company A

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
        name: `E2E Customers Tenant ${suffix}`,
        slug: `e2e-customers-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Customers Company A',
        taxId: `e2e-customers-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Customers Company B',
        taxId: `e2e-customers-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    async function makePermission(code: string) {
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: 'customers',
          resource: 'customers',
          action: code.split('.')[1],
        },
      });
    }
    const permRead = await makePermission('customers.read');
    const permCreate = await makePermission('customers.create');
    const permUpdate = await makePermission('customers.update');
    const permDeactivate = await makePermission('customers.deactivate');

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

    const roleFullA = await makeRole(companyAId, 'Customers E2E Full A', [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleFullB = await makeRole(companyBId, 'Customers E2E Full B', [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleReadOnly = await makeRole(companyAId, 'Customers E2E Read Only', [
      permRead.id,
    ]);
    const roleNoCreate = await makeRole(companyAId, 'Customers E2E No Create', [
      permRead.id,
      permUpdate.id,
      permDeactivate.id,
    ]);
    const roleNoUpdate = await makeRole(companyAId, 'Customers E2E No Update', [
      permRead.id,
      permCreate.id,
      permDeactivate.id,
    ]);
    const roleNoDeactivate = await makeRole(
      companyAId,
      'Customers E2E No Deactivate',
      [permRead.id, permCreate.id, permUpdate.id],
    );
    const roleNoAccess = await makeRole(
      companyAId,
      'Customers E2E No Access',
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
          email: `e2e-customers-${label.toLowerCase()}-${suffix}@example.com`,
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
    await prisma.customerCategoryAssignment.deleteMany({
      where: { category: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.customerCategory.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.customerContact.deleteMany({
      where: { customer: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.customerAddress.deleteMany({
      where: { customer: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.customer.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.customerCodeSequence.deleteMany({
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

  // Section 93 — mandatory: permission enforcement (read, then each write independently).
  describe('permission enforcement', () => {
    it('403s a user with no customer permissions on list', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
      expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
    });

    it('allows a read-only user to list/read but not create/update/deactivate', async () => {
      const agent = await loginAs(userReadOnlyId);
      const list = await agent
        .get('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(list.status).toBe(200);

      const create = await agent
        .post('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Should Not Be Created' });
      expect(create.status).toBe(403);
    });

    it('403s create for a user missing customers.create specifically', async () => {
      const agent = await loginAs(userNoCreateId);
      const res = await agent
        .post('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Should Not Be Created' });
      expect(res.status).toBe(403);
    });

    it('403s update for a user missing customers.update specifically', async () => {
      const adminAgent = await loginAs(userAdminId);
      const createRes = await adminAgent
        .post('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: `Perm Test ${suffix}` });
      const customerId = (createRes.body as CustomerDetailBody).customer.id;

      const agent = await loginAs(userNoUpdateId);
      const res = await agent
        .patch(`/api/v1/customers/${customerId}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: 'Renamed' });
      expect(res.status).toBe(403);
    });

    it('403s deactivate for a user missing customers.deactivate specifically', async () => {
      const adminAgent = await loginAs(userAdminId);
      const createRes = await adminAgent
        .post('/api/v1/customers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ legalName: `Perm Test Deactivate ${suffix}` });
      const customerId = (createRes.body as CustomerDetailBody).customer.id;

      const agent = await loginAs(userNoDeactivateId);
      const res = await agent
        .post(`/api/v1/customers/${customerId}/deactivate`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
    });
  });

  // Section 94/95 — mandatory: creation assigns company from context, auto code, audit; body spoof ignored.
  it('creates a customer with an auto-generated code, company from RequestContext, and an audit record — ignoring a spoofed companyId in the body', async () => {
    const agent = await loginAs(userAdminId);
    const res = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: `Creation Test ${suffix}`,
        companyId: companyBId,
        tenantId: 'spoofed',
      });
    expect(res.status).toBe(201);
    const customer = (res.body as CustomerDetailBody).customer;
    expect(customer.code).toMatch(/^\d{6}$/);

    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    expect(row.companyId).toBe(companyAId); // never the spoofed companyB
    expect(row.tenantId).toBe(tenantId);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        entityType: 'Customer',
        entityId: customer.id,
        action: 'CREATE',
      },
    });
    expect(auditRows).toHaveLength(1);
  });

  // Section 92 — mandatory: company isolation, including direct-ID access.
  it('never exposes a company A customer to a company B request', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Isolation Test ${suffix}` });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const crossRes = await agent
      .get(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyBId);
    expect(crossRes.status).toBe(404);
    expect((crossRes.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_NOT_FOUND',
    );

    const listRes = await agent
      .get('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyBId);
    expect(
      (listRes.body as CustomerListBody).items.map((i) => i.id),
    ).not.toContain(customerId);
  });

  // Section 96 — mandatory: duplicate code within a company conflicts; across companies is allowed.
  it('rejects a duplicate code within the same company but allows it across companies', async () => {
    const agent = await loginAs(userAdminId);
    const code = `9${String(suffix).slice(-5)}`;

    const first = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Code Test A ${suffix}`, code });
    expect(first.status).toBe(201);

    const dupe = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Code Test A Dupe ${suffix}`, code });
    expect(dupe.status).toBe(409);
    expect((dupe.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_CODE_ALREADY_EXISTS',
    );

    const otherCompany = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ legalName: `Code Test B ${suffix}`, code });
    expect(otherCompany.status).toBe(201);
  });

  // Section 97/98/99 — mandatory: duplicate active tax id, normalization, checksum validation.
  it('enforces tax-id uniqueness per company (active only), normalizes input, and validates the CUIT checksum', async () => {
    const agent = await loginAs(userAdminId);

    const badChecksum = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: 'Bad CUIT',
        documentType: 'CUIT',
        taxId: '30712345670',
      });
    expect(badChecksum.status).toBe(400);
    expect(
      (badChecksum.body as ErrorEnvelope).error.details?.fieldErrors,
    ).toHaveProperty('taxId');

    // Same checksum-invalid value is fine for a non-CUIT document type.
    const dniOk = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: `DNI OK ${suffix}`,
        documentType: 'DNI',
        taxId: '30712345670',
      });
    expect(dniOk.status).toBe(201);

    const dashed = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: `Dashed CUIT ${suffix}`,
        documentType: 'CUIT',
        taxId: '30-71234567-1',
      });
    expect(dashed.status).toBe(201);
    const dashedCustomer = (dashed.body as CustomerDetailBody).customer;
    expect(dashedCustomer.taxId).toBe('30712345671');

    // Search using plain digits must find the customer created with the dashed form.
    const searchRes = await agent
      .get('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ search: '30712345671' });
    expect(
      (searchRes.body as CustomerListBody).items.map((i) => i.id),
    ).toContain(dashedCustomer.id);

    const dupeTaxId = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: 'Dupe CUIT',
        documentType: 'CUIT',
        taxId: '30712345671',
      });
    expect(dupeTaxId.status).toBe(409);
    expect((dupeTaxId.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_TAX_ID_ALREADY_EXISTS',
    );

    // Same tax id in a different company is allowed.
    const otherCompanySameTaxId = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({
        legalName: 'Same CUIT Other Company',
        documentType: 'CUIT',
        taxId: '30712345671',
      });
    expect(otherCompanySameTaxId.status).toBe(201);
  });

  // Section 100 — mandatory: update audit records before/after for a commercial-sensitive field.
  it('records a before/after AuditLog entry when creditLimit is updated', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        legalName: `Credit Limit Test ${suffix}`,
        creditLimit: '100000',
      });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const updateRes = await agent
      .patch(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ creditLimit: '250000' });
    expect(updateRes.status).toBe(200);
    expect((updateRes.body as CustomerDetailBody).customer.creditLimit).toBe(
      '250000',
    );

    const historyRes = await agent
      .get(`/api/v1/customers/${customerId}/history`)
      .set(COMPANY_ID_HEADER, companyAId);
    const updateEvent = (historyRes.body as HistoryBody).items.find(
      (i) =>
        i.action === 'UPDATE' && isCreditLimitDiff(i.beforeData, i.afterData),
    );
    expect(updateEvent).toBeDefined();

    function isCreditLimitDiff(before: unknown, after: unknown): boolean {
      return (
        !!before &&
        !!after &&
        typeof before === 'object' &&
        typeof after === 'object' &&
        'creditLimit' in before &&
        (before as Record<string, unknown>).creditLimit === '100000' &&
        (after as Record<string, unknown>).creditLimit === '250000'
      );
    }
  });

  // Section 101 — mandatory: deactivate/reactivate cycle, no physical deletion, both audited.
  it('deactivates then reactivates a customer without ever deleting the row', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Lifecycle Test ${suffix}` });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const deactivateRes = await agent
      .post(`/api/v1/customers/${customerId}/deactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(deactivateRes.status).toBe(200);
    expect((deactivateRes.body as CustomerDetailBody).customer.status).toBe(
      'INACTIVE',
    );

    const reactivateRes = await agent
      .post(`/api/v1/customers/${customerId}/reactivate`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(reactivateRes.status).toBe(200);
    expect((reactivateRes.body as CustomerDetailBody).customer.status).toBe(
      'ACTIVE',
    );

    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });
    expect(row).not.toBeNull();

    const auditRows = await prisma.auditLog.findMany({
      where: {
        entityType: 'Customer',
        entityId: customerId,
        action: { in: ['DEACTIVATE', 'ACTIVATE'] },
      },
    });
    expect(auditRows.map((r) => r.action).sort()).toEqual([
      'ACTIVATE',
      'DEACTIVATE',
    ]);
  });

  // Section 102 — mandatory: multiple addresses, default handling, cross-customer access impossible.
  it('supports multiple addresses with transaction-safe per-type defaults and no cross-customer access', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Address Test ${suffix}` });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const fiscal1 = await agent
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        type: 'FISCAL',
        street: 'Calle 1',
        city: 'CABA',
        province: 'CABA',
        postalCode: '1000',
        isDefault: true,
      });
    expect(fiscal1.status).toBe(201);
    const fiscal1Id = (fiscal1.body as { address: { id: string } }).address.id;

    const shipping = await agent
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        type: 'SHIPPING',
        street: 'Calle 2',
        city: 'CABA',
        province: 'CABA',
        postalCode: '1000',
        isDefault: true,
      });
    expect(shipping.status).toBe(201);

    const fiscal2 = await agent
      .post(`/api/v1/customers/${customerId}/addresses`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        type: 'FISCAL',
        street: 'Calle 3',
        city: 'CABA',
        province: 'CABA',
        postalCode: '1000',
        isDefault: true,
      });
    expect(fiscal2.status).toBe(201);

    const detail = await agent
      .get(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId);
    const addresses = (detail.body as CustomerDetailBody).customer.addresses;
    expect(addresses).toHaveLength(3);
    const oldFiscal = addresses.find((a) => a.id === fiscal1Id);
    expect(oldFiscal?.isDefault).toBe(false); // superseded by fiscal2, same type
    const shippingAddress = addresses.find((a) => a.type === 'SHIPPING');
    expect(shippingAddress?.isDefault).toBe(true); // untouched — different type

    // Cross-customer access impossible.
    const otherCustomer = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Address Test Other ${suffix}` });
    const otherCustomerId = (otherCustomer.body as CustomerDetailBody).customer
      .id;
    const crossAccess = await agent
      .patch(`/api/v1/customers/${otherCustomerId}/addresses/${fiscal1Id}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ city: 'Should Not Work' });
    expect(crossAccess.status).toBe(404);
    expect((crossAccess.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_ADDRESS_NOT_FOUND',
    );
  });

  // Section 103 — mandatory: multiple contacts, primary behavior, cross-customer access impossible.
  it('supports multiple contacts with a single transaction-safe primary and no cross-customer access', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Contact Test ${suffix}` });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const first = await agent
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: 'Juan Pérez', isPrimary: true });
    const firstId = (first.body as { contact: { id: string } }).contact.id;

    const second = await agent
      .post(`/api/v1/customers/${customerId}/contacts`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: 'María López', isPrimary: true });
    expect(second.status).toBe(201);

    const detail = await agent
      .get(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId);
    const contacts = (detail.body as CustomerDetailBody).customer.contacts;
    expect(contacts).toHaveLength(2);
    expect(contacts.find((c) => c.id === firstId)?.isPrimary).toBe(false);
    expect(contacts.find((c) => c.name === 'María López')?.isPrimary).toBe(
      true,
    );

    const otherCustomer = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Contact Test Other ${suffix}` });
    const otherCustomerId = (otherCustomer.body as CustomerDetailBody).customer
      .id;
    const crossAccess = await agent
      .delete(`/api/v1/customers/${otherCustomerId}/contacts/${firstId}`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(crossAccess.status).toBe(404);
    expect((crossAccess.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_CONTACT_NOT_FOUND',
    );
  });

  // Section 104 — mandatory: assign/remove category, cross-company category assignment blocked.
  it('assigns and removes categories, blocking a category from a different company', async () => {
    const agent = await loginAs(userAdminId);

    const categoryA = await agent
      .post('/api/v1/customer-categories')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Mayorista E2E ${suffix}` });
    expect(categoryA.status).toBe(201);
    const categoryAId = (categoryA.body as { category: { id: string } })
      .category.id;

    const categoryB = await agent
      .post('/api/v1/customer-categories')
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ name: `Minorista E2E ${suffix}` });
    const categoryBId = (categoryB.body as { category: { id: string } })
      .category.id;

    const createRes = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: `Category Test ${suffix}` });
    const customerId = (createRes.body as CustomerDetailBody).customer.id;

    const assign = await agent
      .patch(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ categoryIds: [categoryAId] });
    expect(assign.status).toBe(200);
    expect(
      (assign.body as CustomerDetailBody).customer.categories.map((c) => c.id),
    ).toEqual([categoryAId]);

    const crossCompany = await agent
      .patch(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ categoryIds: [categoryBId] });
    expect(crossCompany.status).toBe(404);
    expect((crossCompany.body as ErrorEnvelope).error.code).toBe(
      'CUSTOMER_CATEGORY_NOT_FOUND',
    );

    const remove = await agent
      .patch(`/api/v1/customers/${customerId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ categoryIds: [] });
    expect(remove.status).toBe(200);
    expect(
      (remove.body as CustomerDetailBody).customer.categories,
    ).toHaveLength(0);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        entityType: 'Customer',
        entityId: customerId,
        metadata: { path: ['change'], equals: 'categories_changed' },
      },
    });
    expect(auditRows).toHaveLength(2); // one for assign, one for remove
  });
});
