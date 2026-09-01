import fs from 'node:fs/promises';
import path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER, type BackupManifest } from '@erp/shared';
// Must be imported before AppModule — see the note in that file.
import { testBackupDir } from './helpers/backup-dir';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

/**
 * GET /system/backups/status — read-only server backup health.
 *
 * The important assertions here are the negative ones: this endpoint must stay
 * read-only and must never leak the server's filesystem layout or any secret.
 * A pg_dump covers every company in the instance, so if this surface ever grew
 * a "take"/"download"/"restore" operation it would hand one company's admin the
 * other companies' data — see docs/backups.md and BackupsService.
 */

interface StatusBody {
  configured: boolean;
  lastRun: { status: string; fileName?: string; verified: boolean } | null;
  lastSuccessfulRun: { status: string } | null;
  schedule: string[];
  retentionDays: number;
  nextRunAt: string | null;
  storedBackups: number;
  totalSizeBytes: number;
  cloudEnabled: boolean;
  recentRuns: { id: string }[];
}

const backupDir = testBackupDir;

describe('System backups (e2e)', () => {
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
        name: `E2E Backups Tenant ${suffix}`,
        slug: `e2e-backups-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const company = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Backups Company',
        taxId: `e2e-backups-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyId = company.id;

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: 'system.backups.read' },
    });

    const roleAllowed = await prisma.role.create({
      data: { tenantId, companyId, name: 'Backups E2E Allowed' },
    });
    await prisma.rolePermission.create({
      data: { roleId: roleAllowed.id, permissionId: permission.id },
    });
    const roleDenied = await prisma.role.create({
      data: { tenantId, companyId, name: 'Backups E2E Denied' },
    });

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-backups-${label.toLowerCase()}-${suffix}@example.com`,
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
    await fs.rm(backupDir, { recursive: true, force: true });
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

  async function writeManifest(manifest: BackupManifest) {
    await fs.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8',
    );
  }

  describe('authorization', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(401);
    });

    it('rejects a company member without system.backups.read', async () => {
      const agent = await loginAs(deniedUserId);
      await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(403);
    });
  });

  describe('status', () => {
    it('reports "not configured" when the agent has never run', async () => {
      await fs.rm(path.join(backupDir, 'manifest.json'), { force: true });

      const agent = await loginAs(allowedUserId);
      const res = await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);

      const body = res.body as StatusBody;
      // A fresh install must look unprotected, not healthy-by-default.
      expect(body.configured).toBe(false);
      expect(body.lastRun).toBeNull();
      expect(body.nextRunAt).toBeNull();
    });

    it('reports the agent-published schedule, retention and last run', async () => {
      await writeManifest({
        version: 1,
        settings: {
          times: ['03:00'],
          retentionDays: 30,
          keepMinimum: 7,
          cloudEnabled: true,
          updatedAt: new Date().toISOString(),
        },
        runs: [
          {
            id: 'run-2',
            startedAt: '2026-09-01T03:00:00.000Z',
            finishedAt: '2026-09-01T03:02:00.000Z',
            status: 'failed',
            trigger: 'scheduled',
            durationMs: 120000,
            verified: false,
            cloud: { status: 'failed' },
            error: 'pg_dump exited with code 1',
          },
          {
            id: 'run-1',
            startedAt: '2026-08-31T03:00:00.000Z',
            finishedAt: '2026-08-31T03:01:00.000Z',
            status: 'success',
            trigger: 'scheduled',
            fileName: 'erp-erp_platform-20260831-030000.dump',
            sizeBytes: 2048,
            sha256: 'a'.repeat(64),
            durationMs: 60000,
            verified: true,
            cloud: { status: 'uploaded', key: 'erp-backups/x.dump' },
          },
        ],
      });

      const agent = await loginAs(allowedUserId);
      const res = await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);

      const body = res.body as StatusBody;
      expect(body.configured).toBe(true);
      expect(body.schedule).toEqual(['03:00']);
      expect(body.retentionDays).toBe(30);
      expect(body.cloudEnabled).toBe(true);
      expect(body.nextRunAt).not.toBeNull();

      // Last run and last SUCCESSFUL run are distinct on purpose: an operator
      // whose most recent backup failed still needs to know how old their
      // newest usable copy is.
      expect(body.lastRun?.status).toBe('failed');
      expect(body.lastSuccessfulRun?.status).toBe('success');
      expect(body.recentRuns).toHaveLength(2);
    });

    it('counts archives actually present on disk', async () => {
      await fs.writeFile(
        path.join(backupDir, 'erp-erp_platform-20260831-030000.dump'),
        Buffer.alloc(2048),
      );

      const agent = await loginAs(allowedUserId);
      const res = await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);

      const body = res.body as StatusBody;
      expect(body.storedBackups).toBe(1);
      expect(body.totalSizeBytes).toBe(2048);
    });

    it('survives a corrupt manifest instead of returning a 500', async () => {
      await fs.writeFile(
        path.join(backupDir, 'manifest.json'),
        '{ not json',
        'utf8',
      );

      const agent = await loginAs(allowedUserId);
      const res = await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);

      expect((res.body as StatusBody).configured).toBe(false);
    });

    it('never exposes server paths or secrets', async () => {
      const agent = await loginAs(allowedUserId);
      const res = await agent
        .get('/api/v1/system/backups/status')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(200);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain(backupDir);
      expect(serialized).not.toMatch(/password|secretAccessKey|DATABASE_URL/i);
    });

    it('exposes no write operation', async () => {
      // Guards the invariant directly: if someone later adds a way to trigger
      // or fetch a backup through the API, this test fails and forces the
      // tenant-isolation question to be answered first.
      const agent = await loginAs(allowedUserId);

      await agent
        .post('/api/v1/system/backups/run')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(404);
      await agent
        .get('/api/v1/system/backups/download')
        .set(COMPANY_ID_HEADER, companyId)
        .expect(404);
    });
  });
});
