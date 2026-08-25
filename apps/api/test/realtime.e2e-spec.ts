import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import {
  COMPANY_ID_HEADER,
  REALTIME_SUBSCRIBE_COMPANY,
  type SubscribeCompanyAck,
} from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RealtimePublisher } from '../src/realtime/realtime.publisher';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';

/** supertest types `Response.headers` as `any`; this is the real shape (see auth.e2e-spec.ts). */
function getSetCookieHeader(headers: unknown): string[] {
  return (headers as Record<string, string[]>)['set-cookie'];
}

/**
 * Realtime (Socket.IO) infrastructure — see
 * docs/desktop-lan-architecture.md "Realtime architecture". Proves the
 * security-critical invariants server-side (never relying on client
 * behavior alone, per AGENTS.md/CLAUDE.md): a socket is authenticated the
 * same way an HTTP request is, company subscription is independently
 * re-validated, and a rejected/rolled-back mutation never publishes an
 * event. Self-contained fixtures, not the dev seed — same pattern as
 * every other e2e spec in this suite.
 *
 * Needs a real listening HTTP server (unlike the rest of this suite,
 * which drives supertest against an unbound app) because socket.io-client
 * is a genuine network client, not something supertest can proxy.
 */
describe('Realtime (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let realtimePublisher: RealtimePublisher;
  let baseUrl: string;
  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  const userIds: string[] = [];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);
    const address = (
      app.getHttpServer() as HttpServer
    ).address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    realtimePublisher = app.get(RealtimePublisher);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Realtime Tenant ${suffix}`,
        slug: `e2e-realtime-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const companyA = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Realtime Company A',
        taxId: `e2e-rt-a-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const companyB = await prisma.company.create({
      data: {
        tenantId,
        legalName: 'E2E Realtime Company B',
        taxId: `e2e-rt-b-${suffix}`,
        countryCode: 'AR',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    companyAId = companyA.id;
    companyBId = companyB.id;

    async function makePermission(code: string) {
      const [module, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module, resource: module, action },
      });
    }
    const customerPermIds = [
      (await makePermission('customers.read')).id,
      (await makePermission('customers.create')).id,
    ];
    const roleA = await prisma.role.create({
      data: { tenantId, companyId: companyAId, name: 'Realtime Customers A' },
    });
    await prisma.rolePermission.createMany({
      data: customerPermIds.map((permissionId) => ({
        roleId: roleA.id,
        permissionId,
      })),
    });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const userA = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'RealtimeA',
        email: `e2e-realtime-a-${suffix}@example.com`,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    const userB = await prisma.user.create({
      data: {
        firstName: 'E2E',
        lastName: 'RealtimeB',
        email: `e2e-realtime-b-${suffix}@example.com`,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    userIds.push(userA.id, userB.id);

    await prisma.userCompany.create({
      data: { userId: userA.id, tenantId, companyId: companyAId, active: true },
    });
    await prisma.userCompany.create({
      data: { userId: userB.id, tenantId, companyId: companyBId, active: true },
    });
    await prisma.userRole.create({
      data: { userId: userA.id, roleId: roleA.id, companyId: companyAId },
    });
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    // Engine.IO keeps its own internal timers alive independent of the
    // HTTP server — app.close() alone isn't enough to let Jest exit
    // cleanly when a real port was bound (see beforeAll's app.listen(0)).
    void app.get(RealtimeGateway).server?.close();
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: { in: [companyAId, companyBId] } } },
    });
    await prisma.role.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.customer.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.customerCodeSequence.deleteMany({
      where: { companyId: { in: [companyAId, companyBId] } },
    });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({
      where: { id: { in: [companyAId, companyBId] } },
    });
    await prisma.tenant.delete({ where: { id: tenantId } });
    await app.close();
  });

  async function loginCookie(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    // Keep only the "name=value" part of each Set-Cookie — the rest
    // (Path, HttpOnly, SameSite, ...) isn't valid in a request Cookie
    // header.
    return getSetCookieHeader(res.headers)
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  function connectSocket(cookie?: string): Socket {
    const socket = io(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      autoConnect: false,
      reconnection: false,
      extraHeaders: cookie ? { Cookie: cookie } : {},
    });
    sockets.push(socket);
    return socket;
  }

  function waitForEvent<T = unknown>(
    socket: Socket,
    event: string,
    timeoutMs = 4000,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for "${event}"`)),
        timeoutMs,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  function ack(
    socket: Socket,
    companyId: string,
  ): Promise<SubscribeCompanyAck> {
    return new Promise((resolve) => {
      socket.emit(REALTIME_SUBSCRIBE_COMPANY, { companyId }, resolve);
    });
  }

  // ---------- Section 26: authentication ----------

  it('rejects a socket that presents no session cookie at all', async () => {
    const socket = connectSocket();
    // Rejected by the auth middleware during the handshake (see
    // realtime.gateway.ts's afterInit) — the client never actually
    // reaches 'connect', it gets 'connect_error' instead.
    const rejected = waitForEvent(socket, 'connect_error');
    socket.connect();
    await rejected;
    expect(socket.connected).toBe(false);
  });

  it('rejects a socket presenting a garbage/forged cookie', async () => {
    const socket = connectSocket('access_token=not-a-real-jwt');
    const rejected = waitForEvent(socket, 'connect_error');
    socket.connect();
    await rejected;
    expect(socket.connected).toBe(false);
  });

  it('accepts a socket carrying a real, valid session cookie', async () => {
    const cookie = await loginCookie(`e2e-realtime-a-${suffix}@example.com`);
    const socket = connectSocket(cookie);
    const connected = waitForEvent(socket, 'connect');
    socket.connect();
    await connected;
    expect(socket.connected).toBe(true);
  });

  // ---------- Section 27: company subscription / isolation ----------

  it('lets an authenticated member subscribe to their own company room', async () => {
    const cookie = await loginCookie(`e2e-realtime-a-${suffix}@example.com`);
    const socket = connectSocket(cookie);
    socket.connect();
    await waitForEvent(socket, 'connect');

    const result = await ack(socket, companyAId);
    expect(result).toEqual({ ok: true, companyId: companyAId });
  });

  it('rejects subscribing to a real company the user is not a member of — never trusts a client-supplied companyId', async () => {
    const cookie = await loginCookie(`e2e-realtime-a-${suffix}@example.com`);
    const socket = connectSocket(cookie);
    socket.connect();
    await waitForEvent(socket, 'connect');

    // companyBId is a genuine, existing company UUID — just not one this
    // user belongs to. Guessing a real UUID must not be enough.
    const result = await ack(socket, companyBId);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('COMPANY_ACCESS_DENIED');
  });

  it('isolates company rooms: an event published for company A reaches A and never reaches B', async () => {
    const cookieA = await loginCookie(`e2e-realtime-a-${suffix}@example.com`);
    const cookieB = await loginCookie(`e2e-realtime-b-${suffix}@example.com`);
    const socketA = connectSocket(cookieA);
    const socketB = connectSocket(cookieB);
    socketA.connect();
    socketB.connect();
    await Promise.all([
      waitForEvent(socketA, 'connect'),
      waitForEvent(socketB, 'connect'),
    ]);
    await Promise.all([ack(socketA, companyAId), ack(socketB, companyBId)]);

    let receivedByB = false;
    socketB.once('customer.updated', () => {
      receivedByB = true;
    });
    const receivedByA = waitForEvent<{ companyId: string; customerId: string }>(
      socketA,
      'customer.updated',
    );

    realtimePublisher.customerUpdated(companyAId, 'fixture-customer-id');

    const payload = await receivedByA;
    expect(payload).toEqual({
      companyId: companyAId,
      customerId: 'fixture-customer-id',
    });

    // Give a disinterested socket a real chance to (wrongly) receive it
    // before asserting it didn't — a same-tick assertion would prove
    // nothing.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(receivedByB).toBe(false);
  });

  // ---------- Section 28: transaction safety ----------

  it('publishes customer.updated only after a mutation actually commits, never on a rejected one', async () => {
    const spy = jest.spyOn(realtimePublisher, 'customerUpdated');
    spy.mockClear();

    const agent = request.agent(app.getHttpServer());
    const loginRes = await agent
      .post('/api/v1/auth/login')
      .send({ email: `e2e-realtime-a-${suffix}@example.com`, password });
    expect(loginRes.status).toBe(200);

    const taxId = `20-${suffix}-realtime-a`.slice(0, 20);

    const created = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: 'Realtime Tx Safety Customer', taxId });
    expect(created.status).toBe(201);
    expect(spy).toHaveBeenCalledTimes(1);

    // Same taxId again — CustomerTaxIdAlreadyExistsException, thrown
    // before the write transaction ever opens. Must publish nothing.
    const rejected = await agent
      .post('/api/v1/customers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({ legalName: 'Duplicate TaxId Customer', taxId });
    expect(rejected.status).toBe(409);
    expect(spy).toHaveBeenCalledTimes(1); // unchanged — the failure emitted nothing

    spy.mockRestore();
  });
});
