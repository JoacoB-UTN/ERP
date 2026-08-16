import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import type { LoginResponse, MeResponse } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

interface ErrorEnvelope {
  error: { code: string; message: string };
}

/** supertest types `Response.headers` as `any`; this is the real shape. */
function getSetCookieHeader(headers: unknown): string[] {
  return (headers as Record<string, string[]>)['set-cookie'];
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const testEmail = `e2e-auth-${Date.now()}@example.com`;
  const testPassword = 'e2e-test-password-1234';
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    const passwordHash = await argon2.hash(testPassword, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'Tester',
        email: testEmail,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    // FKs are ON DELETE RESTRICT — children first.
    await prisma.userSession.deleteMany({ where: { userId: testUserId } });
    await prisma.passwordResetToken.deleteMany({
      where: { userId: testUserId },
    });
    await prisma.user.delete({ where: { id: testUserId } });
    await app.close();
  });

  describe('GET /api/v1/auth/me', () => {
    it('fails without authentication', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/auth/me',
      );
      expect(response.status).toBe(401);
    });
  });

  it('full login → me → refresh → logout cycle', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginResponse = await agent
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: testPassword });
    expect(loginResponse.status).toBe(200);
    const loginBody = loginResponse.body as LoginResponse;
    expect(loginBody.user.email).toBe(testEmail);
    expect(loginBody.user).not.toHaveProperty('passwordHash');
    const setCookieHeader = getSetCookieHeader(loginResponse.headers);
    expect(setCookieHeader.some((c) => c.startsWith('access_token='))).toBe(
      true,
    );
    expect(setCookieHeader.some((c) => c.startsWith('refresh_token='))).toBe(
      true,
    );

    const meResponse = await agent.get('/api/v1/auth/me');
    expect(meResponse.status).toBe(200);
    expect((meResponse.body as MeResponse).user.email).toBe(testEmail);

    const previousRefreshCookie = setCookieHeader.find((c) =>
      c.startsWith('refresh_token='),
    );

    const refreshResponse = await agent.post('/api/v1/auth/refresh');
    expect(refreshResponse.status).toBe(200);

    // The old refresh cookie must now be rejected — rotation actually happened.
    const staleAgentResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', previousRefreshCookie ?? '');
    expect(staleAgentResponse.status).toBe(401);

    const meAfterRefresh = await agent.get('/api/v1/auth/me');
    expect(meAfterRefresh.status).toBe(200);

    const logoutResponse = await agent.post('/api/v1/auth/logout');
    expect(logoutResponse.status).toBe(200);

    // Idempotent — logging out again must not error.
    const secondLogout = await agent.post('/api/v1/auth/logout');
    expect(secondLogout.status).toBe(200);

    const meAfterLogout = await agent.get('/api/v1/auth/me');
    expect(meAfterLogout.status).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmail, password: 'not-the-right-password' });
    expect(response.status).toBe(401);
  });

  it('rejects login for an unknown email with the same generic error', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'nobody-here@example.com',
        password: 'whatever-password',
      });
    expect(response.status).toBe(401);
    expect((response.body as ErrorEnvelope).error.message).toBe(
      'Invalid email or password.',
    );
  });
});
