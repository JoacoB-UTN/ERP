import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as argon2 from 'argon2';
import { COMPANY_ID_HEADER } from '@erp/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
import { TreasuryTransfersService } from '../src/treasury/treasury-transfers.service';
import type { RequestContext } from '../src/company-context/types';

interface ErrorEnvelope {
  error: { code: string; message: string };
}
interface TransferBody {
  transfer: {
    id: string;
    number: string;
    status: string;
    amount: string;
    sourceAccountId: string;
    destinationAccountId: string;
  };
}

/**
 * Transfers between treasury accounts — see docs/treasury.md.
 *
 * The assertions that carry the weight are the ledger ones, and they are
 * written as INVARIANTS rather than as races with a predicted winner:
 * both halves exist or neither does, a cancellation ADDS the inverted
 * pair, and opposing simultaneous transfers neither deadlock nor lose
 * money. No sleeps anywhere.
 */
describe('Treasury transfers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let transfersService: TreasuryTransfersService;

  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let arsId: string;
  let usdId: string;

  let userAdminId: string;
  let userNoConfirmId: string;
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
    transfersService = app.get(TreasuryTransfersService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E TrfTreasury Tenant ${suffix}`,
        slug: `e2e-trftreasury-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E TrfTreasury A',
          taxId: `e2e-trftreasury-a-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      }),
      prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E TrfTreasury B',
          taxId: `e2e-trftreasury-b-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;

    // Global and shared with every other suite: upsert, never delete.
    const ars = await prisma.currency.upsert({
      where: { code: 'ARS' },
      update: {},
      create: { code: 'ARS', name: 'Peso argentino', symbol: '$' },
    });
    const usd = await prisma.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: { code: 'USD', name: 'Dólar', symbol: 'US$' },
    });
    arsId = ars.id;
    usdId = usd.id;

    async function makePermission(code: string) {
      const [, resource, action] = code.split('.');
      return prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, module: 'treasury', resource, action },
      });
    }
    const perms = await Promise.all(
      [
        'treasury.accounts.read',
        'treasury.accounts.create',
        'treasury.movements.read',
        'treasury.movements.create',
        'treasury.transfers.read',
        'treasury.transfers.create',
        'treasury.transfers.update',
        'treasury.transfers.confirm',
        'treasury.transfers.cancel',
      ].map(makePermission),
    );
    const byCode = new Map(perms.map((p) => [p.code, p.id]));

    async function makeRole(companyId: string, name: string, codes: string[]) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name: `${name} ${suffix}` },
      });
      await prisma.rolePermission.createMany({
        data: codes.map((c) => ({
          roleId: role.id,
          permissionId: byCode.get(c) as string,
        })),
      });
      return role;
    }
    const allCodes = [...byCode.keys()];
    const roleFullA = await makeRole(companyAId, 'Trf Full A', allCodes);
    const roleFullB = await makeRole(companyBId, 'Trf Full B', allCodes);
    const roleNoConfirm = await makeRole(
      companyAId,
      'Trf NoConfirm',
      allCodes.filter((c) => c !== 'treasury.transfers.confirm'),
    );

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-trftreasury-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const admin = await makeUser('Admin');
    const noConfirm = await makeUser('NoConfirm');
    userAdminId = admin.id;
    userNoConfirmId = noConfirm.id;

    for (const userId of userIds) {
      await prisma.userCompany.create({
        data: { userId, tenantId, companyId: companyAId, active: true },
      });
    }
    await prisma.userCompany.create({
      data: {
        userId: userAdminId,
        tenantId,
        companyId: companyBId,
        active: true,
      },
    });

    await prisma.userRole.create({
      data: {
        userId: userAdminId,
        roleId: roleFullA.id,
        companyId: companyAId,
      },
    });
    await prisma.userRole.create({
      data: {
        userId: userAdminId,
        roleId: roleFullB.id,
        companyId: companyBId,
      },
    });
    await prisma.userRole.create({
      data: {
        userId: userNoConfirmId,
        roleId: roleNoConfirm.id,
        companyId: companyAId,
      },
    });
  });

  afterAll(async () => {
    const companies = { in: [companyAId, companyBId] };
    await prisma.auditLog.deleteMany({ where: { companyId: companies } });
    await prisma.treasuryTransfer.deleteMany({
      where: { companyId: companies },
    });
    await prisma.treasuryTransferSequence.deleteMany({
      where: { companyId: companies },
    });
    await prisma.treasuryMovement.deleteMany({
      where: { companyId: companies },
    });
    await prisma.treasuryAccountBalance.deleteMany({
      where: { companyId: companies },
    });
    await prisma.treasuryAccount.deleteMany({
      where: { companyId: companies },
    });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { role: { companyId: companies } },
    });
    await prisma.role.deleteMany({ where: { companyId: companies } });
    await prisma.userCompany.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.company.deleteMany({ where: { id: companies } });
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

  /** The same context the guard builds for an HTTP request. */
  function ctxA(): RequestContext {
    return {
      userId: userAdminId,
      companyId: companyAId,
      tenantId,
      branchId: undefined,
    };
  }

  let counter = 0;
  /** An account with `opening` already in it, ready to move money. */
  async function makeAccount(
    opening: string,
    options: { companyId?: string; currencyId?: string; type?: string } = {},
  ) {
    // Captured BEFORE the first await. Reading the shared counter after
    // one would hand the same number to two concurrent callers, and the
    // per-company uniqueness of `code` would reject the second — a test
    // bug that looks exactly like a product failure.
    counter += 1;
    const n = counter;
    const companyId = options.companyId ?? companyAId;
    const agent = await loginAs(userAdminId);
    const created = await agent
      .post('/api/v1/treasury/accounts')
      .set(COMPANY_ID_HEADER, companyId)
      .send({
        code: `TRF-${suffix}-${n}`,
        name: `Cuenta ${n}`,
        type: options.type ?? 'CASH_BOX',
        currencyId: options.currencyId ?? arsId,
      })
      .expect(201);
    const id = (created.body as { account: { id: string } }).account.id;

    if (opening !== '0') {
      await agent
        .post(`/api/v1/treasury/accounts/${id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyId)
        .send({ amount: opening })
        .expect(201);
    }
    return id;
  }

  async function balance(accountId: string) {
    const row = await prisma.treasuryAccountBalance.findFirst({
      where: { treasuryAccountId: accountId },
    });
    return (row?.balance ?? new Prisma.Decimal(0)).toFixed(2);
  }

  async function ledgerSum(accountId: string) {
    const agg = await prisma.treasuryMovement.aggregate({
      where: { treasuryAccountId: accountId },
      _sum: { amount: true },
    });
    return (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
  }

  async function createDraft(
    sourceId: string,
    destinationId: string,
    amount: string,
  ) {
    const agent = await loginAs(userAdminId);
    const res = await agent
      .post('/api/v1/treasury/transfers')
      .set(COMPANY_ID_HEADER, companyAId)
      .send({
        sourceAccountId: sourceId,
        destinationAccountId: destinationId,
        amount,
      });
    expect(res.status).toBe(201);
    return (res.body as TransferBody).transfer;
  }

  describe('the draft', () => {
    it('moves no money at all', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      await createDraft(a, b, '400.00');

      expect(await balance(a)).toBe('1000.00');
      expect(await balance(b)).toBe('0.00');
    });

    it('refuses a transfer to the same account', async () => {
      const a = await makeAccount('100.00');
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/treasury/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ sourceAccountId: a, destinationAccountId: a, amount: '10.00' });
      expect(res.status).toBe(400);
    });

    it('refuses two accounts in different currencies', async () => {
      const ars = await makeAccount('1000.00');
      const usd = await makeAccount('0', {
        currencyId: usdId,
        type: 'BANK_ACCOUNT',
      });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/treasury/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceAccountId: ars,
          destinationAccountId: usd,
          amount: '10.00',
        });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_CURRENCY_MISMATCH',
      );
    });

    it('does not reach another company’s account', async () => {
      const mine = await makeAccount('1000.00');
      const theirs = await makeAccount('0', { companyId: companyBId });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/treasury/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          sourceAccountId: mine,
          destinationAccountId: theirs,
          amount: '10.00',
        });
      expect(res.status).toBe(404);
    });
  });

  describe('confirming', () => {
    it('writes both halves and conserves the total', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('250.00');
      const draft = await createDraft(a, b, '400.00');

      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);

      expect(await balance(a)).toBe('600.00');
      expect(await balance(b)).toBe('650.00');
      // Money is neither created nor destroyed by a transfer.
      expect(
        new Prisma.Decimal(await balance(a)).add(await balance(b)).toFixed(2),
      ).toBe('1250.00');

      const movements = await prisma.treasuryMovement.findMany({
        where: { sourceType: 'TreasuryTransfer', sourceId: draft.id },
      });
      expect(movements).toHaveLength(2);
      expect(movements.map((m) => m.movementType).sort()).toEqual([
        'TRANSFER_IN',
        'TRANSFER_OUT',
      ]);
    });

    it('refuses to overdraw the source, and writes neither half', async () => {
      const a = await makeAccount('100.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '500.00');

      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'INSUFFICIENT_TREASURY_FUNDS',
      );

      // The whole transaction rolled back: no half-transfer, and the
      // document is still a draft rather than a CONFIRMED one with no
      // movements behind it.
      expect(await balance(a)).toBe('100.00');
      expect(await balance(b)).toBe('0.00');
      expect(
        await prisma.treasuryMovement.count({
          where: { sourceType: 'TreasuryTransfer', sourceId: draft.id },
        }),
      ).toBe(0);
      const after = await prisma.treasuryTransfer.findFirstOrThrow({
        where: { id: draft.id },
      });
      expect(after.status).toBe('DRAFT');
    });

    it('cannot be confirmed twice', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '100.00');
      const agent = await loginAs(userAdminId);

      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);
      const second = await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(second.status).toBe(409);

      expect(await balance(a)).toBe('900.00');
      expect(await balance(b)).toBe('100.00');
    });

    it('rejects editing a transfer that is no longer a draft', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '100.00');
      const agent = await loginAs(userAdminId);

      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);

      const res = await agent
        .patch(`/api/v1/treasury/transfers/${draft.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '999.00' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_TRANSFER_NOT_DRAFT',
      );
    });

    it('a PATCH carrying only notes still takes the row lock', async () => {
      // The defect this guards against is subtle: an update whose `data`
      // ends up empty takes NO row lock, which made the equivalent guard
      // on StockTransfer decorative. `updatedAt` is always written, so
      // the guard is real — observable here as the timestamp moving.
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '100.00');
      const before = await prisma.treasuryTransfer.findFirstOrThrow({
        where: { id: draft.id },
      });

      const agent = await loginAs(userAdminId);
      await agent
        .patch(`/api/v1/treasury/transfers/${draft.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ notes: 'Depósito del viernes' })
        .expect(200);

      const after = await prisma.treasuryTransfer.findFirstOrThrow({
        where: { id: draft.id },
      });
      expect(after.updatedAt.getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );
    });
  });

  describe('cancelling', () => {
    it('adds the inverted pair instead of deleting anything', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '300.00');
      const agent = await loginAs(userAdminId);

      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);
      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);

      // Back where they started...
      expect(await balance(a)).toBe('1000.00');
      expect(await balance(b)).toBe('0.00');
      // ...but the history is intact: four movements, not zero.
      const movements = await prisma.treasuryMovement.findMany({
        where: { sourceType: 'TreasuryTransfer', sourceId: draft.id },
      });
      expect(movements).toHaveLength(4);
      expect(movements.map((m) => m.movementType).sort()).toEqual([
        'TRANSFER_IN',
        'TRANSFER_IN_REVERSAL',
        'TRANSFER_OUT',
        'TRANSFER_OUT_REVERSAL',
      ]);
      expect(await balance(a)).toBe(await ledgerSum(a));
    });

    it('refuses to cancel a draft', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '100.00');
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_TRANSFER_NOT_CONFIRMED',
      );
    });

    it('cannot be cancelled twice', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '100.00');
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);
      await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(201);

      const second = await agent
        .post(`/api/v1/treasury/transfers/${draft.id}/cancel`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(second.status).toBe(409);
      expect(await balance(a)).toBe('1000.00');
    });
  });

  describe('concurrency', () => {
    it('does not deadlock on opposing simultaneous transfers', async () => {
      // A→B and B→A at the same instant is the classic deadlock: each
      // transaction wants the lock the other holds. The stable lock order
      // means one simply waits. Four pairs, to make a stray ordering bug
      // show up rather than slip through.
      // Setup is sequential on purpose: only the confirms below are the
      // thing under test, and making the fixtures race too just adds
      // ways for the test to fail for reasons that are not the product's.
      const pairs: { a: string; b: string }[] = [];
      for (let i = 0; i < 4; i += 1) {
        pairs.push({
          a: await makeAccount('5000.00'),
          b: await makeAccount('5000.00'),
        });
      }

      const drafts: { id: string }[] = [];
      for (const p of pairs) {
        drafts.push(await createDraft(p.a, p.b, '100.00'));
        drafts.push(await createDraft(p.b, p.a, '100.00'));
      }

      // Driven through the SERVICE, not over HTTP. What is under test is
      // the database lock ordering, and firing sixteen simultaneous
      // requests at an ephemeral supertest listener only added
      // ECONNRESETs from the transport — noise that looks like a product
      // failure and is not one.
      const results = await Promise.allSettled(
        drafts.map((d) => transfersService.confirm(ctxA(), d.id)),
      );
      // Not "most of them": a deadlock surfaces as a rejection here.
      const failed = results
        .filter((r) => r.status === 'rejected')
        .map((r) => String(r.reason));
      expect(failed).toEqual([]);

      // Equal and opposite, so every account is back where it started —
      // and the projection still agrees with the ledger.
      for (const p of pairs) {
        expect(await balance(p.a)).toBe('5000.00');
        expect(await balance(p.b)).toBe('5000.00');
        expect(await balance(p.a)).toBe(await ledgerSum(p.a));
      }
    });

    it('posts one pair when the same transfer is confirmed twice at once', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const draft = await createDraft(a, b, '250.00');
      const results = await Promise.allSettled([
        transfersService.confirm(ctxA(), draft.id),
        transfersService.confirm(ctxA(), draft.id),
      ]);

      // The invariant is not who wins: exactly one succeeds, and the
      // money moved exactly once.
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await balance(a)).toBe('750.00');
      expect(await balance(b)).toBe('250.00');
      expect(
        await prisma.treasuryMovement.count({
          where: { sourceType: 'TreasuryTransfer', sourceId: draft.id },
        }),
      ).toBe(2);
    });
  });

  describe('permissions', () => {
    it('separates creating a transfer from executing it', async () => {
      const a = await makeAccount('1000.00');
      const b = await makeAccount('0');
      const agent = await loginAs(userNoConfirmId);

      const created = await agent
        .post('/api/v1/treasury/transfers')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ sourceAccountId: a, destinationAccountId: b, amount: '50.00' });
      expect(created.status).toBe(201);

      const id = (created.body as TransferBody).transfer.id;
      const confirm = await agent
        .post(`/api/v1/treasury/transfers/${id}/confirm`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(confirm.status).toBe(403);
      expect(await balance(a)).toBe('1000.00');
    });
  });
});
