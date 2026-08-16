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
  error: { code: string; message: string };
}
interface PermissionsBody {
  permissions: string[];
}

/**
 * Mandatory RBAC coverage per CLAUDE.md and docs/authorization.md.
 * Fixtures are self-contained (not the dev seed) so this stays correct
 * regardless of prisma/seed.ts contents.
 */
describe('Authorization / RBAC (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;

  let roleAdminLikeId: string; // companyA — broad administration permissions, used as the "acting admin" throughout
  let roleExtraId: string; // companyA — apps.facturacion.access, for the multi-role union test
  let roleInactiveId: string; // companyA — active:false
  let roleGestionOnlyId: string; // companyA — apps.gestion.access only
  let roleFacturacionOnlyId: string; // companyA — apps.facturacion.access only
  let roleRemovableId: string; // companyA — administration.roles.read, permission is stripped mid-test
  let roleBLimitedId: string; // companyB — grants nothing relevant
  let roleBAssignerId: string; // companyB — administration.roles.assign only

  let userMainId: string; // member of A + B; acting admin in both
  let userInactiveRoleId: string; // member of A; holds only the inactive role
  let userInactiveMembershipId: string; // member of A but membership.active = false
  let userNoMembershipId: string; // no membership anywhere
  let userRemovableId: string; // member of A; holds roleRemovable
  let userGestionOnlyId: string;
  let userFacturacionOnlyId: string;

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
        name: `E2E RBAC Tenant ${suffix}`,
        slug: `e2e-rbac-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E RBAC Company A',
        taxId: `e2e-rbac-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E RBAC Company B',
        taxId: `e2e-rbac-b-${suffix}`,
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
    const permRead = await makePermission('administration.roles.read');
    const permCreate = await makePermission('administration.roles.create');
    const permUpdate = await makePermission('administration.roles.update');
    const permDelete = await makePermission('administration.roles.delete');
    const permAssign = await makePermission('administration.roles.assign');
    const permGestion = await makePermission('apps.gestion.access');
    const permFacturacion = await makePermission('apps.facturacion.access');

    async function makeRole(
      companyId: string,
      name: string,
      permissionIds: string[],
      active = true,
    ) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name, active },
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

    const roleAdminLike = await makeRole(companyAId, 'RBAC E2E Admin-like', [
      permRead.id,
      permCreate.id,
      permUpdate.id,
      permDelete.id,
      permAssign.id,
      permGestion.id,
    ]);
    const roleExtra = await makeRole(companyAId, 'RBAC E2E Extra', [
      permFacturacion.id,
    ]);
    const roleInactive = await makeRole(
      companyAId,
      'RBAC E2E Inactive',
      [permRead.id],
      false,
    );
    const roleGestionOnly = await makeRole(
      companyAId,
      'RBAC E2E Gestion Only',
      [permGestion.id],
    );
    const roleFacturacionOnly = await makeRole(
      companyAId,
      'RBAC E2E Facturacion Only',
      [permFacturacion.id],
    );
    const roleRemovable = await makeRole(companyAId, 'RBAC E2E Removable', [
      permRead.id,
    ]);
    const roleBLimited = await makeRole(companyBId, 'RBAC E2E B Limited', []);
    const roleBAssigner = await makeRole(companyBId, 'RBAC E2E B Assigner', [
      permAssign.id,
    ]);

    roleAdminLikeId = roleAdminLike.id;
    roleExtraId = roleExtra.id;
    roleInactiveId = roleInactive.id;
    roleGestionOnlyId = roleGestionOnly.id;
    roleFacturacionOnlyId = roleFacturacionOnly.id;
    roleRemovableId = roleRemovable.id;
    roleBLimitedId = roleBLimited.id;
    roleBAssignerId = roleBAssigner.id;

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-rbac-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const userMain = await makeUser('Main');
    const userInactiveRole = await makeUser('InactiveRole');
    const userInactiveMembership = await makeUser('InactiveMembership');
    const userNoMembership = await makeUser('NoMembership');
    const userRemovable = await makeUser('Removable');
    const userGestionOnly = await makeUser('GestionOnly');
    const userFacturacionOnly = await makeUser('FacturacionOnly');

    userMainId = userMain.id;
    userInactiveRoleId = userInactiveRole.id;
    userInactiveMembershipId = userInactiveMembership.id;
    userNoMembershipId = userNoMembership.id;
    userRemovableId = userRemovable.id;
    userGestionOnlyId = userGestionOnly.id;
    userFacturacionOnlyId = userFacturacionOnly.id;

    async function membership(
      userId: string,
      companyId: string,
      active = true,
    ) {
      return prisma.userCompany.create({
        data: { userId, tenantId, companyId, active },
      });
    }
    await membership(userMainId, companyAId);
    await membership(userMainId, companyBId);
    await membership(userInactiveRoleId, companyAId);
    await membership(userInactiveMembershipId, companyAId, false);
    await membership(userRemovableId, companyAId);
    await membership(userGestionOnlyId, companyAId);
    await membership(userFacturacionOnlyId, companyAId);

    async function assignRole(
      userId: string,
      roleId: string,
      companyId: string,
    ) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assignRole(userMainId, roleAdminLikeId, companyAId);
    await assignRole(userMainId, roleExtraId, companyAId); // multi-role union
    await assignRole(userMainId, roleBLimitedId, companyBId);
    await assignRole(userMainId, roleBAssignerId, companyBId);
    await assignRole(userInactiveRoleId, roleInactiveId, companyAId);
    await assignRole(userInactiveMembershipId, roleAdminLikeId, companyAId);
    await assignRole(userRemovableId, roleRemovableId, companyAId);
    await assignRole(userGestionOnlyId, roleGestionOnlyId, companyAId);
    await assignRole(userFacturacionOnlyId, roleFacturacionOnlyId, companyAId);
  });

  afterAll(async () => {
    await prisma.userRole.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: {
          in: [
            roleAdminLikeId,
            roleExtraId,
            roleInactiveId,
            roleGestionOnlyId,
            roleFacturacionOnlyId,
            roleRemovableId,
            roleBLimitedId,
            roleBAssignerId,
          ],
        },
      },
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

  // Cached per user: AUTH_RATE_LIMIT_MAX caps logins per IP within the
  // test's window, and this file exercises many users across many `it`
  // blocks — logging in once per user (not once per assertion) keeps the
  // suite well under that limit.
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

  // Section 59 — mandatory: permission-gated route success, then 403 after
  // the permission is removed. Also exercises cache invalidation
  // (section 66): the TTL cache must not serve the stale "still allowed"
  // answer once the permission has been removed.
  it('allows a permission-gated route with the permission, denies after it is removed (cache invalidated)', async () => {
    const removableAgent = await loginAs(userRemovableId);
    const before = await removableAgent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(before.status).toBe(200);

    const adminAgent = await loginAs(userMainId);
    const replace = await adminAgent
      .put(`/api/v1/administration/roles/${roleRemovableId}/permissions`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ permissionCodes: [] });
    expect(replace.status).toBe(200);

    const after = await removableAgent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(after.status).toBe(403);
    expect((after.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
  });

  // Section 60 — mandatory: the SAME user has different effective access in different companies.
  it('grants/denies the same user differently depending on the active company', async () => {
    const agent = await loginAs(userMainId);

    const inA = await agent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(inA.status).toBe(200);

    const inB = await agent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyBId);
    expect(inB.status).toBe(403);
    expect((inB.body as ErrorEnvelope).error.code).toBe('PERMISSION_DENIED');
  });

  // Section 61 — mandatory: assigning a Company A role while context is Company B must fail.
  it('rejects assigning a role that belongs to a different company than the active context', async () => {
    const agent = await loginAs(userMainId); // has administration.roles.assign in companyB via roleBAssigner, and is a member of companyB
    const res = await agent
      .post(`/api/v1/administration/users/${userMainId}/roles`)
      .set(COMPANY_ID_HEADER, companyBId)
      .send({ roleId: roleAdminLikeId }); // roleAdminLike belongs to companyA
    expect(res.status).toBe(404);
    expect((res.body as ErrorEnvelope).error.code).toBe('ROLE_NOT_FOUND');
  });

  // Section 62 — mandatory: the target user must already have UserCompany membership.
  it('rejects assigning a role to a user with no membership in the active company', async () => {
    const agent = await loginAs(userMainId);
    const res = await agent
      .post(`/api/v1/administration/users/${userNoMembershipId}/roles`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ roleId: roleGestionOnlyId });
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'USER_NOT_COMPANY_MEMBER',
    );
  });

  // Section 63 — mandatory: effective permissions are the union across multiple active roles.
  it('combines permissions from multiple roles assigned to the same user/company', async () => {
    const agent = await loginAs(userMainId);
    const res = await agent
      .get('/api/v1/context/permissions')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(200);
    const permissions = (res.body as PermissionsBody).permissions;
    expect(permissions).toEqual(
      expect.arrayContaining([
        'administration.roles.read',
        'apps.facturacion.access',
      ]),
    );
  });

  // Section 64 — mandatory: an inactive role must not grant its permissions.
  it('does not grant permissions from an inactive role', async () => {
    const agent = await loginAs(userInactiveRoleId);
    const res = await agent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(403);
  });

  // Section 65 — mandatory: inactive UserCompany membership blocks access even with a UserRole present.
  it('blocks access when company membership is inactive, even if a UserRole row still exists', async () => {
    const agent = await loginAs(userInactiveMembershipId);
    const res = await agent
      .get('/api/v1/administration/roles')
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(403);
    expect((res.body as ErrorEnvelope).error.code).toBe('COMPANY_INACTIVE');
  });

  // Section 67 — mandatory: apps.gestion.access and apps.facturacion.access are independent.
  it('keeps apps.gestion.access and apps.facturacion.access independent', async () => {
    const gestionAgent = await loginAs(userGestionOnlyId);
    const gestionRes = await gestionAgent
      .get('/api/v1/context/permissions')
      .set(COMPANY_ID_HEADER, companyAId);
    const gestionPermissions = (gestionRes.body as PermissionsBody).permissions;
    expect(gestionPermissions).toContain('apps.gestion.access');
    expect(gestionPermissions).not.toContain('apps.facturacion.access');

    const facturacionAgent = await loginAs(userFacturacionOnlyId);
    const facturacionRes = await facturacionAgent
      .get('/api/v1/context/permissions')
      .set(COMPANY_ID_HEADER, companyAId);
    const facturacionPermissions = (facturacionRes.body as PermissionsBody)
      .permissions;
    expect(facturacionPermissions).toContain('apps.facturacion.access');
    expect(facturacionPermissions).not.toContain('apps.gestion.access');
  });

  it('GET /administration/roles requires authentication and company context', async () => {
    const res = await request(app.getHttpServer()).get(
      '/api/v1/administration/roles',
    );
    expect(res.status).toBe(401);
  });

  it('rejects duplicate role assignment', async () => {
    const agent = await loginAs(userMainId);
    const res = await agent
      .post(`/api/v1/administration/users/${userGestionOnlyId}/roles`)
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ roleId: roleGestionOnlyId });
    expect(res.status).toBe(409);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'DUPLICATE_ROLE_ASSIGNMENT',
    );
  });

  it('protects system roles from deletion', async () => {
    const agent = await loginAs(userMainId);
    const systemRole = await prisma.role.create({
      data: {
        tenantId,
        companyId: companyAId,
        name: `RBAC E2E System ${suffix}`,
        isSystem: true,
      },
    });
    const res = await agent
      .delete(`/api/v1/administration/roles/${systemRole.id}`)
      .set(COMPANY_ID_HEADER, companyAId);
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.code).toBe(
      'SYSTEM_ROLE_PROTECTED',
    );
    await prisma.role.delete({ where: { id: systemRole.id } });
  });

  it('prevents removing the last user with security-administration permission', async () => {
    const soleAdminUser = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'SoleAdmin',
        email: `e2e-rbac-sole-admin-${suffix}@example.com`,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        status: 'ACTIVE',
      },
    });
    userIds.push(soleAdminUser.id);
    const soleCompany = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E RBAC Sole Admin Company',
        taxId: `e2e-rbac-sole-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const soleRole = await prisma.role.create({
      data: { tenantId, companyId: soleCompany.id, name: 'Sole Admin Role' },
    });
    const assignPermission = await prisma.permission.upsert({
      where: { code: 'administration.roles.assign' },
      update: {},
      create: {
        code: 'administration.roles.assign',
        module: 'administration',
        resource: 'roles',
        action: 'assign',
      },
    });
    await prisma.rolePermission.create({
      data: { roleId: soleRole.id, permissionId: assignPermission.id },
    });
    await prisma.userCompany.create({
      data: {
        userId: soleAdminUser.id,
        tenantId,
        companyId: soleCompany.id,
        active: true,
      },
    });
    const assignment = await prisma.userRole.create({
      data: {
        userId: soleAdminUser.id,
        roleId: soleRole.id,
        companyId: soleCompany.id,
      },
    });

    const soleAgent = await loginAs(soleAdminUser.id);
    const res = await soleAgent
      .delete(
        `/api/v1/administration/users/${soleAdminUser.id}/roles/${soleRole.id}`,
      )
      .set(COMPANY_ID_HEADER, soleCompany.id);
    expect(res.status).toBe(409);
    expect((res.body as ErrorEnvelope).error.code).toBe('LAST_SECURITY_ADMIN');

    // cleanup — bypass the API since this is fixture teardown, not part of the assertion
    await prisma.userRole.delete({ where: { id: assignment.id } });
    await prisma.userCompany.deleteMany({
      where: { userId: soleAdminUser.id },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: soleRole.id } });
    await prisma.role.delete({ where: { id: soleRole.id } });
    await prisma.company.delete({ where: { id: soleCompany.id } });
  });
});
