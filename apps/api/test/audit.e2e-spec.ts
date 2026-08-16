import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { TokenService } from '../src/auth/token.service';

interface ErrorEnvelope {
  error: { code: string; message: string };
}
interface AuditListItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  user: { id: string; name: string | null } | null;
}
interface AuditListBody {
  items: AuditListItem[];
  pagination: { page: number; pageSize: number; total: number };
}
interface AuditDetailBody {
  auditLog: AuditListItem & {
    companyId: string | null;
    userEmail: string | null;
    beforeData: unknown;
    afterData: unknown;
    metadata: unknown;
    requestId: string | null;
  };
}
interface RoleDetailBody {
  role: { id: string; name: string; description: string | null };
}

/**
 * Mandatory audit-trail coverage per CLAUDE.md/docs/audit-architecture.md
 * (Prompt #5, sections 65-72). Self-contained fixtures — not the dev
 * seed — same pattern as authorization.e2e-spec.ts.
 */
describe('Audit trail (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let auditService: AuditService;
  let tokenService: TokenService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let userAdminId: string; // company A "acting admin": audit.read + full roles.* + assign
  let userNoAuditId: string; // company A member, roles.* but NOT audit.read
  let userTargetId: string; // company A member, no roles of their own — assignment target
  let userBAuditId: string; // company B member with audit.read there (isolation test)
  let userSecretsId: string; // standalone user for the password/token safety tests

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
    auditService = app.get(AuditService);
    tokenService = app.get(TokenService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Audit Tenant ${suffix}`,
        slug: `e2e-audit-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Audit Company A',
        taxId: `e2e-audit-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Audit Company B',
        taxId: `e2e-audit-b-${suffix}`,
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
          module: code.split('.')[0],
          resource: code.split('.')[1],
          action: code.split('.')[2],
        },
      });
    }
    const permAuditRead = await makePermission('administration.audit.read');
    const permRolesRead = await makePermission('administration.roles.read');
    const permRolesCreate = await makePermission('administration.roles.create');
    const permRolesUpdate = await makePermission('administration.roles.update');
    const permRolesDelete = await makePermission('administration.roles.delete');
    const permRolesAssign = await makePermission('administration.roles.assign');

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

    const roleAdminLike = await makeRole(companyAId, 'Audit E2E Admin-like', [
      permAuditRead.id,
      permRolesRead.id,
      permRolesCreate.id,
      permRolesUpdate.id,
      permRolesDelete.id,
      permRolesAssign.id,
    ]);
    const roleNoAudit = await makeRole(companyAId, 'Audit E2E No-Audit', [
      permRolesRead.id,
      permRolesCreate.id,
      permRolesUpdate.id,
    ]);
    const roleBAudit = await makeRole(companyBId, 'Audit E2E B Audit', [
      permAuditRead.id,
    ]);

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-audit-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userAdmin = await makeUser('Admin');
    const userNoAudit = await makeUser('NoAudit');
    const userTarget = await makeUser('Target');
    const userBAuditUser = await makeUser('BAudit');
    const userSecrets = await makeUser('Secrets');

    userAdminId = userAdmin.id;
    userNoAuditId = userNoAudit.id;
    userTargetId = userTarget.id;
    userBAuditId = userBAuditUser.id;
    userSecretsId = userSecrets.id;

    async function membership(userId: string, companyId: string) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await membership(userAdminId, companyAId);
    await membership(userNoAuditId, companyAId);
    await membership(userTargetId, companyAId);
    await membership(userBAuditId, companyBId);

    async function assignRole(
      userId: string,
      roleId: string,
      companyId: string,
    ) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userAdminId, roleAdminLike.id, companyAId);
    await assignRole(userNoAuditId, roleNoAudit.id, companyAId);
    await assignRole(userBAuditId, roleBAudit.id, companyBId);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({
      where: { userId: { in: userIds } },
    });
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

  // Section 65 — mandatory: permission-gated audit access.
  it('403s a user without administration.audit.read', async () => {
    const agent = await loginAs(userNoAuditId);
    const res = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
  });

  it('200s a user with administration.audit.read, company-scoped and paginated', async () => {
    const agent = await loginAs(userAdminId);
    const res = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(200);
    const body = res.body as AuditListBody;
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.pagination).toEqual(
      expect.objectContaining({ page: 1, pageSize: 25 }),
    );
  });

  // Section 66 — mandatory: company isolation, including direct-ID access.
  it("never exposes another company's audit record by id, or in its list", async () => {
    const injected = await prisma.auditLog.create({
      data: {
        tenantId,
        companyId: companyAId,
        userId: userAdminId,
        action: 'CREATE',
        entityType: 'Role',
        entityId: '00000000-0000-0000-0000-000000000001',
      },
    });

    const bAgent = await loginAs(userBAuditId);

    const byId = await bAgent
      .get(`/api/v1/administration/audit/${injected.id}`)
      .set(COMPANY_ID_HEADER, companyBId);
    expect(byId.status).toBe(404);
    expect((byId.body as ErrorEnvelope).error.code).toBe('AUDIT_LOG_NOT_FOUND');

    const list = await bAgent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyBId);
    expect(list.status).toBe(200);
    expect((list.body as AuditListBody).items.map((i) => i.id)).not.toContain(
      injected.id,
    );
  });

  // Section 67 — mandatory: a role mutation writes a matching, complete audit record.
  it('writes a complete AuditLog row when a role is updated', async () => {
    const agent = await loginAs(userAdminId);
    const createRes = await agent
      .post('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ name: `Audited Role ${suffix}`, description: 'Vendedor' });
    expect(createRes.status).toBe(201);
    const roleId = (createRes.body as RoleDetailBody).role.id;

    const updateRes = await agent
      .patch(`/api/v1/administration/roles/${roleId}`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ description: 'Vendedor Senior' });
    expect(updateRes.status).toBe(200);

    const listRes = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ entityType: 'Role', entityId: roleId, action: 'UPDATE' });
    expect(listRes.status).toBe(200);
    const items = (listRes.body as AuditListBody).items;
    expect(items).toHaveLength(1);

    const detailRes = await agent
      .get(`/api/v1/administration/audit/${items[0].id}`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(detailRes.status).toBe(200);
    const auditLog = (detailRes.body as AuditDetailBody).auditLog;
    expect(auditLog.action).toBe('UPDATE');
    expect(auditLog.entityType).toBe('Role');
    expect(auditLog.entityId).toBe(roleId);
    expect(auditLog.companyId).toBe(companyAId);
    expect(auditLog.user?.id).toBe(userAdminId);
    expect(auditLog.beforeData).toEqual(
      expect.objectContaining({ description: 'Vendedor' }),
    );
    expect(auditLog.afterData).toEqual(
      expect.objectContaining({ description: 'Vendedor Senior' }),
    );
  });

  // Section 68 — mandatory: critical mutation + audit record commit/rollback atomically.
  it('rolls back the business mutation together with a failed audit write', async () => {
    const role = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: `Rollback Role ${suffix}`,
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.role.update({
          where: { id: role.id },
          data: { name: 'Should Not Persist' },
        });
        // Forces the audit INSERT itself to fail (FK violation on a
        // non-existent tenantId) — the point is to prove the *audit*
        // write's failure rolls back the paired business mutation too,
        // not just that Postgres transactions work in general.
        await auditService.record(
          {
            tenantId: '00000000-0000-0000-0000-000000000000',
            companyId: companyAId,
            userId: userAdminId,
            action: 'UPDATE',
            entityType: 'Role',
            entityId: role.id,
          },
          tx,
        );
      }),
    ).rejects.toThrow();

    const reloaded = await prisma.role.findUniqueOrThrow({
      where: { id: role.id },
    });
    expect(reloaded.name).toBe(`Rollback Role ${suffix}`);

    const auditRows = await prisma.auditLog.findMany({
      where: { entityId: role.id },
    });
    expect(auditRows).toHaveLength(0);

    await prisma.role.delete({ where: { id: role.id } });
  });

  // Section 69 — mandatory: permission-change diff (added/removed), one record per save.
  it('records permissionsAdded/permissionsRemoved for a role permission replacement', async () => {
    const agent = await loginAs(userAdminId);

    async function makePermission(code: string) {
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: {
          code,
          module: code.split('.')[0],
          resource: code.split('.')[1],
          action: code.split('.')[2],
        },
      });
    }
    const permA = await makePermission(`audit.e2e.a.${suffix}`);
    const permB = await makePermission(`audit.e2e.b.${suffix}`);
    const permC = await makePermission(`audit.e2e.c.${suffix}`);
    const permD = await makePermission(`audit.e2e.d.${suffix}`);

    const role = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: `Perm Diff Role ${suffix}`,
      },
    });
    await prisma.rolePermission.createMany({
      data: [permA, permB, permC].map((p) => ({
        roleId: role.id,
        permissionId: p.id,
      })),
    });

    const res = await agent
      .put(`/api/v1/administration/roles/${role.id}/permissions`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ permissionCodes: [permA.code, permC.code, permD.code] });
    expect(res.status).toBe(200);

    const listRes = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({
        entityType: 'Role',
        entityId: role.id,
        action: 'PERMISSIONS_CHANGE',
      });
    const items = (listRes.body as AuditListBody).items;
    expect(items).toHaveLength(1);

    const detailRes = await agent
      .get(`/api/v1/administration/audit/${items[0].id}`)
      .set(COMPANY_ID_HEADER, companyAId);
    const metadata = (detailRes.body as AuditDetailBody).auditLog.metadata as {
      permissionsAdded: string[];
      permissionsRemoved: string[];
    };
    expect(metadata.permissionsAdded).toEqual([permD.code]);
    expect(metadata.permissionsRemoved).toEqual([permB.code]);
  });

  // Section 70 — mandatory: role assignment/removal each produce exactly one clear audit record.
  it('records ASSIGN then UNASSIGN for role assignment/removal', async () => {
    const agent = await loginAs(userAdminId);
    const role = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: `Assign Audit Role ${suffix}`,
      },
    });

    const assignRes = await agent
      .post(`/api/v1/administration/users/${userTargetId}/roles`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ roleId: role.id });
    expect(assignRes.status).toBe(201);

    const assignList = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ entityType: 'UserRole', action: 'ASSIGN' });
    const assignItems = (assignList.body as AuditListBody).items;
    expect(assignItems.length).toBeGreaterThanOrEqual(1);
    const assignDetail = await agent
      .get(`/api/v1/administration/audit/${assignItems[0].id}`)
      .set(COMPANY_ID_HEADER, companyAId);
    const assignMetadata = (assignDetail.body as AuditDetailBody).auditLog
      .metadata as {
      targetUserId: string;
      roleId: string;
      roleName: string;
    };
    expect(assignMetadata.targetUserId).toBe(userTargetId);
    expect(assignMetadata.roleId).toBe(role.id);
    expect(assignMetadata.roleName).toBe(role.name);

    const removeRes = await agent
      .delete(`/api/v1/administration/users/${userTargetId}/roles/${role.id}`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(removeRes.status).toBe(200);

    const unassignList = await agent
      .get('/api/v1/administration/audit')
      .set(COMPANY_ID_HEADER, companyAId)
      .query({ entityType: 'UserRole', action: 'UNASSIGN' });
    expect(
      (unassignList.body as AuditListBody).items.length,
    ).toBeGreaterThanOrEqual(1);
  });

  // Section 71 — mandatory: password-change audit safety.
  it('never includes the old/new password or hash in a PASSWORD_CHANGE audit record', async () => {
    const agent = await loginAs(userSecretsId);
    const newPassword = 'brand-new-e2e-password-5678';
    const res = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: password, newPassword });
    expect(res.status).toBe(200);

    const rows = await prisma.auditLog.findMany({
      where: { userId: userSecretsId, action: 'PASSWORD_CHANGE' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(newPassword);
    expect(serialized.toLowerCase()).not.toContain('passwordhash');

    // Restore the original password so later logins in this file (there are none for this user, but kept for hygiene) stay valid.
    await prisma.user.update({
      where: { id: userSecretsId },
      data: {
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
  });

  // Section 72 — mandatory: no token/authorization/cookie material anywhere in AuditLog.
  it('never includes tokens, authorization headers, or cookies in login/logout/reset audit records', async () => {
    const rawResetToken = tokenService.generateOpaqueToken();
    const tokenHash = tokenService.hashOpaqueToken(rawResetToken);
    await prisma.passwordResetToken.create({
      data: {
        userId: userSecretsId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const resetRes = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({
        token: rawResetToken,
        newPassword: 'yet-another-e2e-password-9012',
      });
    expect(resetRes.status).toBe(200);

    // Restore password + re-login so LOGOUT below works with the known password.
    await prisma.user.update({
      where: { id: userSecretsId },
      data: {
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      },
    });
    agentByUser.delete(userSecretsId);
    const agent = await loginAs(userSecretsId);
    await agent.post('/api/v1/auth/logout');

    const rows = await prisma.auditLog.findMany({
      where: { userId: userSecretsId },
    });
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(rawResetToken);
    expect(serialized).not.toContain(tokenHash);
    expect(serialized.toLowerCase()).not.toContain('bearer ');
    expect(serialized.toLowerCase()).not.toContain('refresh_token=');
  });
});
