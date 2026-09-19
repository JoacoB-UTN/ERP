import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/**
 * GET /system/diagnostics — deep diagnostics for the machine the server runs on.
 *
 * Two families of assertion matter here, and the negative ones matter most:
 *
 * 1. The endpoint is **gated**. `GET /health` is public, and the whole reason
 *    this data lives on a second endpoint is that a version, an uptime and a
 *    disk size must not be readable by anyone who can reach the port. A test
 *    that only checked the happy path would let a future refactor move these
 *    fields back onto `/health` without anything going red.
 * 2. It leaks **no filesystem layout and no secret**. The response crosses to
 *    a browser; where the backups live is not something the product publishes.
 */

interface DiagnosticsBody {
  server: {
    version: string;
    startedAt: string;
    uptimeSeconds: number;
    nodeVersion: string;
  };
  database: {
    startedAt: string | null;
    uptimeSeconds: number | null;
    latencyMs: number | null;
    sizeBytes: number | null;
  };
  disk: { backups: { totalBytes: number; freeBytes: number } | null };
}

describe('System diagnostics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyId: string;
  let allowedUserId: string;
  let deniedUserId: string;
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
        name: `E2E Diagnostics Tenant ${suffix}`,
        slug: `e2e-diagnostics-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const company = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Diagnostics Company',
        taxId: `e2e-diagnostics-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyId = company.id;

    // Upserted, not read: the suite must pass against a freshly migrated
    // database, not only one the demo seed has already touched. Same reasoning
    // as system-backups.e2e-spec.ts.
    const permission = await prisma.permission.upsert({
      where: { code: 'system.backups.read' },
      update: {},
      create: {
        code: 'system.backups.read',
        module: 'system',
        resource: 'backups',
        action: 'read',
      },
    });

    const roleAllowed = await prisma.role.create({
      data: { tenantId, companyId, name: 'Diagnostics E2E Allowed' },
    });
    await prisma.rolePermission.create({
      data: { roleId: roleAllowed.id, permissionId: permission.id },
    });
    const roleDenied = await prisma.role.create({
      data: { tenantId, companyId, name: 'Diagnostics E2E Denied' },
    });

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-diagnostics-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }

    const allowed = await makeUser('Allowed');
    const denied = await makeUser('Denied');
    allowedUserId = allowed.id;
    deniedUserId = denied.id;

    for (const userId of userIds) {
      await prisma.userCompany.create({
        data: { userId, tenantId, companyId, active: true },
      });
    }
    await prisma.userRole.create({
      data: { userId: allowedUserId, roleId: roleAllowed.id, companyId },
    });
    await prisma.userRole.create({
      data: { userId: deniedUserId, roleId: roleDenied.id, companyId },
    });
  });

  afterAll(async () => {
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({ where: { role: { companyId } } });
    await prisma.role.deleteMany({ where: { companyId } });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.delete({ where: { id: companyId } });
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

  function get(agent: request.Agent) {
    return agent
      .get('/api/v1/system/diagnostics')
      .set(COMPANY_ID_HEADER, companyId);
  }

  describe('authorization', () => {
    it('refuses an anonymous caller', async () => {
      // The whole point of the second endpoint. If this ever returns 200,
      // the installation's version and free disk are public.
      await request(app.getHttpServer())
        .get('/api/v1/system/diagnostics')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(401);
    });

    it('refuses a user without system.backups.read', async () => {
      const agent = await loginAs(deniedUserId);
      await get(agent).expect(403);
    });

    it('answers a user who holds system.backups.read', async () => {
      const agent = await loginAs(allowedUserId);
      await get(agent).expect(200);
    });
  });

  describe('what it reports', () => {
    it('identifies the build and how long this process has been up', async () => {
      const agent = await loginAs(allowedUserId);
      const res = await get(agent).expect(200);
      const body = res.body as DiagnosticsBody;

      // "unknown" is the documented fallback; getting it here would mean the
      // version file could not be read, which is worth failing over.
      expect(body.server.version).not.toBe('unknown');
      expect(body.server.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(body.server.nodeVersion).toMatch(/^v\d+\./);
      expect(body.server.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(Date.parse(body.server.startedAt))).toBe(false);
    });

    it('reports when PostgreSQL itself started, not when the API did', async () => {
      // This is the field the endpoint exists for: an orphaned postmaster
      // outliving its service wrapper is invisible from Windows but obvious
      // here, because the database's own start time stops tracking the API's.
      const agent = await loginAs(allowedUserId);
      const res = await get(agent).expect(200);
      const body = res.body as DiagnosticsBody;

      expect(body.database.startedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(body.database.startedAt!))).toBe(false);
      expect(body.database.uptimeSeconds).toBeGreaterThanOrEqual(0);
      // The database was up before this test process was: that ordering is
      // the normal state, and its inversion is the anomaly worth seeing.
      expect(body.database.uptimeSeconds!).toBeGreaterThanOrEqual(
        body.server.uptimeSeconds,
      );
    });

    it('measures database latency and size as numbers, not strings', async () => {
      const agent = await loginAs(allowedUserId);
      const res = await get(agent).expect(200);
      const body = res.body as DiagnosticsBody;

      expect(typeof body.database.latencyMs).toBe('number');
      expect(body.database.latencyMs).toBeGreaterThan(0);
      // pg_database_size returns BIGINT; unconverted it would arrive as a
      // string or blow up JSON serialization.
      expect(typeof body.database.sizeBytes).toBe('number');
      expect(body.database.sizeBytes).toBeGreaterThan(0);
    });

    it('reports free space without naming the directory', async () => {
      const agent = await loginAs(allowedUserId);
      const res = await get(agent).expect(200);
      const body = res.body as DiagnosticsBody;

      expect(body.disk.backups).not.toBeNull();
      expect(body.disk.backups!.totalBytes).toBeGreaterThan(0);
      expect(body.disk.backups!.freeBytes).toBeGreaterThanOrEqual(0);
      expect(body.disk.backups!.freeBytes).toBeLessThanOrEqual(
        body.disk.backups!.totalBytes,
      );
    });
  });

  describe('what it must never expose', () => {
    it('leaks no path, secret or connection string', async () => {
      const agent = await loginAs(allowedUserId);
      const res = await get(agent).expect(200);
      const serialized = JSON.stringify(res.body);

      // A directory layout, a password or a DSN in an operator panel is a
      // gift to anyone who gets a screenshot of it.
      for (const forbidden of [
        'postgresql://',
        'redis://',
        'password',
        'secret',
        'DATABASE_URL',
        '/home/',
        'C:\\',
        'backups/',
      ]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it('exposes no write operation', async () => {
      const agent = await loginAs(allowedUserId);
      // Diagnostics reads; restarting a service or clearing disk is the
      // operator's job. A read permission must never gate an action.
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        const res = await agent[method]('/api/v1/system/diagnostics').set(
          COMPANY_ID_HEADER,
          companyId,
        );
        expect(res.status).toBe(404);
      }
    });
  });
});
