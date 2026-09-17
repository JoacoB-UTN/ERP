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
import { TreasuryService } from '../src/treasury/treasury.service';

interface ErrorEnvelope {
  error: { code: string; message: string };
}
interface AccountBody {
  account: {
    id: string;
    code: string;
    type: string;
    balance: string;
    currencyId: string;
    active: boolean;
    allowsNegativeBalance: boolean;
  };
}
interface StatementBody {
  account: { id: string; balance: string };
  rows: { movementType: string; amount: string; runningBalance: string }[];
  pagination: { total: number };
  excludesPosSales: boolean;
}

/**
 * Treasury accounts and the movement ledger — see docs/treasury.md.
 *
 * Self-contained fixtures, never the dev seed. The assertions that carry
 * the weight are the ledger ones: the balance must always equal the sum
 * of the movements, a retried post must not double-count, and no company
 * may see another's cash.
 */
describe('Treasury (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let treasury: TreasuryService;

  const suffix = Date.now();
  const password = 'e2e-test-password-1234';

  let tenantId: string;
  let companyAId: string;
  let companyBId: string;
  let arsId: string;
  let usdId: string;

  let userAdminId: string;
  let userReadOnlyId: string;
  let userNoLedgerId: string;
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
    treasury = app.get(TreasuryService);

    const tenant = await prisma.tenant.create({
      data: {
        name: `E2E Treasury Tenant ${suffix}`,
        slug: `e2e-treasury-tenant-${suffix}`,
      },
    });
    tenantId = tenant.id;

    const [companyA, companyB] = await Promise.all([
      prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E Treasury Company A',
          taxId: `e2e-treasury-a-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      }),
      prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E Treasury Company B',
          taxId: `e2e-treasury-b-${suffix}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      }),
    ]);
    companyAId = companyA.id;
    companyBId = companyB.id;

    // Currencies are global, so they are shared with every other suite —
    // upsert by code rather than create, and never delete them in teardown.
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
    const permAccountsRead = await makePermission('treasury.accounts.read');
    const permAccountsCreate = await makePermission('treasury.accounts.create');
    const permAccountsUpdate = await makePermission('treasury.accounts.update');
    const permMovementsRead = await makePermission('treasury.movements.read');
    const permMovementsCreate = await makePermission(
      'treasury.movements.create',
    );

    async function makeRole(
      companyId: string,
      name: string,
      permissionIds: string[],
    ) {
      const role = await prisma.role.create({
        data: { tenantId, companyId, name: `${name} ${suffix}` },
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
    const allIds = [
      permAccountsRead.id,
      permAccountsCreate.id,
      permAccountsUpdate.id,
      permMovementsRead.id,
      permMovementsCreate.id,
    ];
    const roleFullA = await makeRole(companyAId, 'Treasury Full A', allIds);
    const roleFullB = await makeRole(companyBId, 'Treasury Full B', allIds);
    const roleReadOnly = await makeRole(companyAId, 'Treasury ReadOnly', [
      permAccountsRead.id,
      permMovementsRead.id,
    ]);
    // Can see that accounts exist, cannot read a single peso of the ledger.
    const roleNoLedger = await makeRole(companyAId, 'Treasury NoLedger', [
      permAccountsRead.id,
    ]);
    const roleNoAccess = await makeRole(companyAId, 'Treasury NoAccess', []);

    async function makeUser(label: string) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
      });
      const user = await prisma.user.create({
        data: {
          firstName: 'E2E',
          lastName: label,
          email: `e2e-treasury-${label.toLowerCase()}-${suffix}@example.com`,
          passwordHash,
          status: 'ACTIVE',
        },
      });
      userIds.push(user.id);
      return user;
    }
    const admin = await makeUser('Admin');
    const readOnly = await makeUser('ReadOnly');
    const noLedger = await makeUser('NoLedger');
    const noAccess = await makeUser('NoAccess');
    userAdminId = admin.id;
    userReadOnlyId = readOnly.id;
    userNoLedgerId = noLedger.id;
    userNoAccessId = noAccess.id;

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

    async function assign(userId: string, roleId: string, companyId: string) {
      return prisma.userRole.create({ data: { userId, roleId, companyId } });
    }
    await assign(userAdminId, roleFullA.id, companyAId);
    await assign(userAdminId, roleFullB.id, companyBId);
    await assign(userReadOnlyId, roleReadOnly.id, companyAId);
    await assign(userNoLedgerId, roleNoLedger.id, companyAId);
    await assign(userNoAccessId, roleNoAccess.id, companyAId);
  });

  afterAll(async () => {
    const companies = { in: [companyAId, companyBId] };
    await prisma.auditLog.deleteMany({ where: { companyId: companies } });
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

  let codeCounter = 0;
  function nextCode(prefix: string) {
    codeCounter += 1;
    return `${prefix}-${suffix}-${codeCounter}`;
  }

  async function createAccount(
    overrides: Record<string, unknown> = {},
    companyId = companyAId,
    userId = userAdminId,
  ) {
    const agent = await loginAs(userId);
    const res = await agent
      .post('/api/v1/treasury/accounts')
      .set(COMPANY_ID_HEADER, companyId)
      .send({
        code: nextCode('CAJA'),
        name: 'Caja de prueba',
        type: 'CASH_BOX',
        currencyId: arsId,
        ...overrides,
      });
    expect(res.status).toBe(201);
    return (res.body as AccountBody).account;
  }

  /** Posts straight through the service, the way Cobros/Pagos will. */
  async function post(
    accountId: string,
    amount: string,
    options: {
      movementType?: Prisma.TreasuryMovementCreateInput['movementType'];
      sourceId?: string;
      companyId?: string;
      currencyId?: string;
    } = {},
  ) {
    return prisma.$transaction((tx) =>
      treasury.post(
        tx,
        { companyId: options.companyId ?? companyAId, tenantId },
        {
          treasuryAccountId: accountId,
          movementType: options.movementType ?? 'COLLECTION',
          amount: new Prisma.Decimal(amount),
          occurredAt: new Date(),
          sourceType: 'CustomerCollection',
          sourceId: options.sourceId ?? crypto.randomUUID(),
          currencyId: options.currencyId ?? arsId,
        },
      ),
    );
  }

  /**
   * Holds a transaction open at the critical point.
   *
   * `Promise.all` over two calls proves nothing about interleaving: the
   * runtime is free to run them one after the other, so the test passes
   * whether or not the locking works. This forces the bad ordering
   * instead — the first writer is left INSIDE its transaction, holding
   * the account lock and with its work uncommitted, while the second one
   * starts. Release only once the second is under way.
   *
   * Returns the gate to open and the transaction's own promise, which
   * must be awaited so a failure inside it is not swallowed.
   */
  function holdPostOpen(
    accountId: string,
    amount: string,
    companyId = companyAId,
  ) {
    let release!: () => void;
    let reachedBarrier!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inside = new Promise<void>((r) => {
      reachedBarrier = r;
    });

    const tx = prisma.$transaction(
      async (client) => {
        await treasury.post(
          client,
          { companyId, tenantId },
          {
            treasuryAccountId: accountId,
            movementType: 'COLLECTION',
            amount: new Prisma.Decimal(amount),
            occurredAt: new Date(),
            sourceType: 'CustomerCollection',
            sourceId: crypto.randomUUID(),
            currencyId: arsId,
          },
        );
        // Written, lock held, NOT committed.
        reachedBarrier();
        await gate;
      },
      // Generous: the point is the barrier, not a timeout.
      { timeout: 20_000, maxWait: 20_000 },
    );

    return { inside, release, tx };
  }

  /**
   * Waits until somebody is actually BLOCKED on this account's advisory
   * lock, by looking at `pg_locks`.
   *
   * This is what makes the race tests deterministic. Starting a promise
   * and releasing the barrier on the next line proves nothing: the second
   * operation may not have reached the database yet, and the test then
   * passes even with the locking removed — measured, that is exactly what
   * happened. Waiting for the waiter to appear means the collision has
   * genuinely occurred before anything is released.
   *
   * It polls observable database state, not the clock: if the operation
   * never takes the lock, no waiter ever appears and the test fails
   * instead of silently proving nothing.
   */
  async function waitForLockWaiter(
    companyId: string,
    accountId: string,
  ): Promise<void> {
    const name = `treasury:${companyId}:${accountId}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<{ waiting: number }[]>(Prisma.sql`
        SELECT count(*)::int AS waiting
        FROM pg_locks l
        WHERE l.locktype = 'advisory'
          AND NOT l.granted
          AND ((l.classid::bigint << 32) | l.objid::bigint)
              = hashtextextended(${name}, 0)
      `);
      if ((rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((r) => setImmediate(r));
    }
    throw new Error(
      `Nadie se bloqueó en el lock de ${name}: la operación no lo está tomando.`,
    );
  }

  async function ledgerSum(accountId: string) {
    const agg = await prisma.treasuryMovement.aggregate({
      where: { treasuryAccountId: accountId },
      _sum: { amount: true },
    });
    // `toString`, not `toFixed(2)` — the helper must not do the rounding
    // the product is being tested for NOT doing.
    return (agg._sum.amount ?? new Prisma.Decimal(0)).toString();
  }

  async function storedBalance(accountId: string) {
    const row = await prisma.treasuryAccountBalance.findFirst({
      where: { treasuryAccountId: accountId },
    });
    return (row?.balance ?? new Prisma.Decimal(0)).toString();
  }

  describe('accounts', () => {
    it('creates a cash box and starts it at zero, not at nothing', async () => {
      const account = await createAccount();
      expect(account.balance).toBe('0');
      expect(account.active).toBe(true);
    });

    it('refuses a duplicate code within the company', async () => {
      const code = nextCode('DUP');
      await createAccount({ code });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/treasury/accounts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ code, name: 'Otra', type: 'CASH_BOX', currencyId: arsId });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_ACCOUNT_CODE_ALREADY_EXISTS',
      );
    });

    it('lets two companies use the same code — uniqueness is per company', async () => {
      const code = nextCode('SHARED');
      await createAccount({ code }, companyAId);
      const second = await createAccount({ code }, companyBId);
      expect(second.code).toBe(code);
    });

    it('refuses a cash box that claims it can go negative', async () => {
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post('/api/v1/treasury/accounts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: nextCode('BADCAJA'),
          name: 'Caja imposible',
          type: 'CASH_BOX',
          currencyId: arsId,
          allowsNegativeBalance: true,
        });
      expect(res.status).toBe(400);
    });

    it('can clear a field that was set, not only overwrite it', async () => {
      // A wrong CBU has to be removable. `?? undefined` in the update
      // would swallow the explicit null and silently keep the old value.
      const account = await createAccount({
        code: nextCode('BANCOCBU'),
        name: 'Banco con CBU',
        type: 'BANK_ACCOUNT',
        cbu: '0000003100010000000001',
      });
      const agent = await loginAs(userAdminId);

      const stored = await prisma.treasuryAccount.findFirstOrThrow({
        where: { id: account.id },
      });
      expect(stored.cbu).toBe('0000003100010000000001');

      await agent
        .patch(`/api/v1/treasury/accounts/${account.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ cbu: null })
        .expect(200);

      const cleared = await prisma.treasuryAccount.findFirstOrThrow({
        where: { id: account.id },
      });
      expect(cleared.cbu).toBeNull();
    });

    it('leaves a field alone when the edit does not mention it', async () => {
      const account = await createAccount({
        code: nextCode('BANCOKEEP'),
        name: 'Banco',
        type: 'BANK_ACCOUNT',
        bankName: 'Banco Nación',
      });
      const agent = await loginAs(userAdminId);

      await agent
        .patch(`/api/v1/treasury/accounts/${account.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ name: 'Banco renombrado' })
        .expect(200);

      const after = await prisma.treasuryAccount.findFirstOrThrow({
        where: { id: account.id },
      });
      expect(after.name).toBe('Banco renombrado');
      expect(after.bankName).toBe('Banco Nación');
    });

    it('does not let an edit turn a cash box into one that can go negative', async () => {
      const account = await createAccount();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .patch(`/api/v1/treasury/accounts/${account.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ allowsNegativeBalance: true });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'CASH_BOX_CANNOT_ALLOW_NEGATIVE',
      );
    });
  });

  describe('the opening balance', () => {
    it('is a real movement, so the ledger explains the first peso too', async () => {
      const account = await createAccount();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '15000.00' });
      expect(res.status).toBe(201);
      expect((res.body as AccountBody).account.balance).toBe('15000');

      const movements = await prisma.treasuryMovement.findMany({
        where: { treasuryAccountId: account.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('OPENING_BALANCE');
      expect(await ledgerSum(account.id)).toBe('15000');
    });

    it('can only be set once — a second one would be a correction in disguise', async () => {
      const account = await createAccount();
      const agent = await loginAs(userAdminId);
      await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '100.00' })
        .expect(201);

      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '200.00' });
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_OPENING_BALANCE_ALREADY_SET',
      );
      expect(await ledgerSum(account.id)).toBe('100');
    });
  });

  describe('the ledger', () => {
    it('keeps the balance equal to the sum of the movements', async () => {
      const account = await createAccount();
      await post(account.id, '1000.00');
      await post(account.id, '500.50');
      await post(account.id, '-200.50', { movementType: 'PAYMENT' });

      expect(await ledgerSum(account.id)).toBe('1300');
      expect(await storedBalance(account.id)).toBe('1300');
    });

    it('a duplicate post leaves the transaction usable for the writes around it', async () => {
      // The defect this pins down: a unique violation ABORTS the whole
      // PostgreSQL transaction, and catching the P2002 in TypeScript does
      // not undo that — every later statement fails with "current
      // transaction is aborted".
      //
      // The earlier idempotency test missed it because the duplicate was
      // the only thing in its transaction. The real callers all write
      // before and after: a Cobro's confirm flips the status, posts to
      // the customer ledger, posts here, then audits. So this test does
      // the same, and fails loudly if `post` ever goes back to catching
      // the error instead of avoiding it.
      const account = await createAccount();
      const sourceId = crypto.randomUUID();
      await post(account.id, '500.00', { sourceId });

      await prisma.$transaction(async (tx) => {
        await tx.treasuryAccount.update({
          where: { id: account.id },
          data: { notes: 'antes del duplicado' },
        });

        const duplicate = await treasury.post(
          tx,
          { companyId: companyAId, tenantId },
          {
            treasuryAccountId: account.id,
            movementType: 'COLLECTION',
            amount: new Prisma.Decimal('500.00'),
            occurredAt: new Date(),
            sourceType: 'CustomerCollection',
            sourceId,
            currencyId: arsId,
          },
        );
        expect(duplicate).toBeNull();

        // The write that used to explode.
        await tx.treasuryAccount.update({
          where: { id: account.id },
          data: { notes: 'despues del duplicado' },
        });
      });

      const after = await prisma.treasuryAccount.findFirstOrThrow({
        where: { id: account.id },
      });
      expect(after.notes).toBe('despues del duplicado');
      expect(await ledgerSum(account.id)).toBe('500');
      expect(await storedBalance(account.id)).toBe('500');
    });

    it('a duplicate post leaves the transaction usable for the writes around it', async () => {
      // The defect this pins down: a unique violation ABORTS the whole
      // PostgreSQL transaction, and catching the P2002 in TypeScript does
      // not undo that — every later statement fails with "current
      // transaction is aborted".
      //
      // The earlier idempotency test missed it because the duplicate was
      // the only thing in its transaction. The real callers all write
      // before and after: a Cobro's confirm flips the status, posts to
      // the customer ledger, posts here, then audits. So this test does
      // the same, and fails loudly if `post` ever goes back to catching
      // the error instead of avoiding it.
      const account = await createAccount();
      const sourceId = crypto.randomUUID();
      await post(account.id, '500.00', { sourceId });

      await prisma.$transaction(async (tx) => {
        await tx.treasuryAccount.update({
          where: { id: account.id },
          data: { notes: 'antes del duplicado' },
        });

        const duplicate = await treasury.post(
          tx,
          { companyId: companyAId, tenantId },
          {
            treasuryAccountId: account.id,
            movementType: 'COLLECTION',
            amount: new Prisma.Decimal('500.00'),
            occurredAt: new Date(),
            sourceType: 'CustomerCollection',
            sourceId,
            currencyId: arsId,
          },
        );
        expect(duplicate).toBeNull();

        // The write that used to explode.
        await tx.treasuryAccount.update({
          where: { id: account.id },
          data: { notes: 'despues del duplicado' },
        });
      });

      const after = await prisma.treasuryAccount.findFirstOrThrow({
        where: { id: account.id },
      });
      expect(after.notes).toBe('despues del duplicado');
      expect(await ledgerSum(account.id)).toBe('500');
      expect(await storedBalance(account.id)).toBe('500');
    });

    it('does not double-count a retried post of the same document', async () => {
      const account = await createAccount();
      const sourceId = crypto.randomUUID();

      const first = await post(account.id, '750.00', { sourceId });
      const second = await post(account.id, '750.00', { sourceId });

      expect(first).not.toBeNull();
      // Null, not an error: the ledger already says what the caller wanted.
      expect(second).toBeNull();
      expect(await ledgerSum(account.id)).toBe('750');
      expect(await storedBalance(account.id)).toBe('750');
    });

    it('refuses to overdraw a cash box, and writes nothing when it refuses', async () => {
      const account = await createAccount();
      await post(account.id, '100.00');

      await expect(
        post(account.id, '-150.00', { movementType: 'PAYMENT' }),
      ).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_TREASURY_FUNDS' },
      });

      // The whole transaction rolled back — the rejected movement must not
      // be sitting in an immutable ledger.
      expect(await ledgerSum(account.id)).toBe('100');
      expect(await storedBalance(account.id)).toBe('100');
    });

    it('lets a bank account with an overdraft go below zero', async () => {
      const account = await createAccount({
        code: nextCode('BANCO'),
        name: 'Banco con giro',
        type: 'BANK_ACCOUNT',
        allowsNegativeBalance: true,
      });
      await post(account.id, '-4200.00', { movementType: 'PAYMENT' });
      expect(await storedBalance(account.id)).toBe('-4200');
    });

    it('refuses a movement in a currency the account does not hold', async () => {
      const account = await createAccount();
      await expect(
        post(account.id, '100.00', { currencyId: usdId }),
      ).rejects.toMatchObject({
        response: { code: 'TREASURY_CURRENCY_MISMATCH' },
      });
    });

    it('a rebuild cannot sum past an uncommitted post — forced, not raced', async () => {
      // The defect: the rebuild summed the ledger OUTSIDE its write
      // transaction, so a movement committed in between was overwritten
      // by a total computed before it existed.
      //
      // Two things make this deterministic rather than a hopeful race:
      //
      // 1. A barrier. The post is left INSIDE its transaction, holding
      //    the account lock, uncommitted, while the rebuild starts.
      // 2. **A company of its own.** Scoped to the shared company the
      //    rebuild walks dozens of accounts first, so by the time it
      //    reached this one the post had long committed and the test
      //    passed with the lock removed — the exact "passes by accident"
      //    failure this rewrite exists to kill. With one account in the
      //    company, the collision is forced.
      //
      // Verified by deleting the lock from rebuildTreasuryBalances: the
      // test then fails.
      const company = await prisma.company.create({
        data: {
          tenantId,
          legalName: 'E2E Treasury Race',
          taxId: `e2e-treasury-race-${suffix}-${Date.now()}`,
          countryCode: 'AR',
          timezone: 'America/Argentina/Buenos_Aires',
        },
      });
      const account = await prisma.treasuryAccount.create({
        data: {
          tenantId,
          companyId: company.id,
          code: `RACE-${suffix}`,
          name: 'Caja de la carrera',
          type: 'CASH_BOX',
          currencyId: arsId,
        },
      });

      await prisma.$transaction((tx) =>
        treasury.post(
          tx,
          { companyId: company.id, tenantId },
          {
            treasuryAccountId: account.id,
            movementType: 'COLLECTION',
            amount: new Prisma.Decimal('1000.00'),
            occurredAt: new Date(),
            sourceType: 'CustomerCollection',
            sourceId: crypto.randomUUID(),
            currencyId: arsId,
          },
        ),
      );

      try {
        await runTheRace();
      } finally {
        await prisma.treasuryMovement.deleteMany({
          where: { companyId: company.id },
        });
        await prisma.treasuryAccountBalance.deleteMany({
          where: { companyId: company.id },
        });
        await prisma.treasuryAccount.deleteMany({
          where: { companyId: company.id },
        });
        await prisma.company.delete({ where: { id: company.id } });
      }

      async function runTheRace() {
        const held = holdPostOpen(account.id, '250.00', company.id);
        await held.inside;

        // Starts while the post holds the lock, and this company has
        // exactly one account, so the rebuild reaches it immediately.
        const rebuild = treasury.rebuildTreasuryBalances(company.id);

        // `finally` because the barrier must open even when the assertion
        // below fails: without it, a failing run leaves the held
        // transaction and the rebuild waiting on each other and the suite
        // hangs instead of reporting. Measured, with the lock deleted.
        try {
          // Do not release until the rebuild is genuinely blocked on the
          // lock. Releasing on the next line let it commit first, and the
          // test passed with the lock deleted.
          await waitForLockWaiter(company.id, account.id);
        } finally {
          held.release();
        }
        await held.tx;
        await rebuild;

        expect(await ledgerSum(account.id)).toBe('1250');
        expect(await storedBalance(account.id)).toBe('1250');
      }
    });

    it('an opening cannot land after the first movement — and says so with a 409', async () => {
      // Two things the earlier version got wrong, both raised in review:
      //
      // 1. `Promise.all` over two calls does not force the interleaving —
      //    they may simply run one after the other, and the test passes
      //    even if the emptiness check goes back outside the lock.
      // 2. It never asserted the HTTP status, so a 500 counted as a
      //    fulfilled promise and the run stayed green.
      //
      // Now the first movement is held uncommitted with the lock taken,
      // the opening request is fired and observed to BLOCK on that lock,
      // and only then is the barrier released.
      const account = await createAccount();
      const held = holdPostOpen(account.id, '100.00');
      await held.inside;

      const agent = await loginAs(userAdminId);
      const openingPromise = agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '900.00' })
        .then((r) => r);

      try {
        await waitForLockWaiter(companyAId, account.id);
      } finally {
        held.release();
      }
      await held.tx;

      const res = await openingPromise;
      // The movement won the lock, so the ledger is no longer empty and
      // the opening must be refused — with the domain error, not a 500.
      expect(res.status).toBe(409);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'TREASURY_OPENING_BALANCE_ALREADY_SET',
      );

      // And nothing was written: no opening at all, and the balance is
      // exactly the first movement.
      expect(
        await prisma.treasuryMovement.count({
          where: {
            treasuryAccountId: account.id,
            movementType: 'OPENING_BALANCE',
          },
        }),
      ).toBe(0);
      expect(await storedBalance(account.id)).toBe('100');
      expect(await storedBalance(account.id)).toBe(await ledgerSum(account.id));
    });

    it('when the opening gets there first, it is the only one', async () => {
      // The other direction, asserted explicitly: 201, exactly one
      // OPENING_BALANCE, and a later attempt refused.
      const account = await createAccount();
      const agent = await loginAs(userAdminId);

      const first = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '900.00' });
      expect(first.status).toBe(201);

      await post(account.id, '100.00');

      const second = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '50.00' });
      expect(second.status).toBe(409);

      expect(
        await prisma.treasuryMovement.count({
          where: {
            treasuryAccountId: account.id,
            movementType: 'OPENING_BALANCE',
          },
        }),
      ).toBe(1);
      expect(await storedBalance(account.id)).toBe('1000');
    });

    it('rebuilds a balance that drifted, from the ledger', async () => {
      const account = await createAccount();
      await post(account.id, '900.00');

      // Corrupt the projection the way only a bug ever could.
      await prisma.treasuryAccountBalance.update({
        where: { treasuryAccountId: account.id },
        data: { balance: new Prisma.Decimal('7.77') },
      });
      expect(await storedBalance(account.id)).toBe('7.77');

      await treasury.rebuildTreasuryBalances(companyAId);

      expect(await storedBalance(account.id)).toBe('900');
      expect(await storedBalance(account.id)).toBe(await ledgerSum(account.id));
    });
  });

  describe('concurrency', () => {
    it('leaves the balance equal to the ledger after simultaneous posts', async () => {
      // The invariant, not a winner: whatever order Postgres picks, the
      // projection must equal the sum of what actually got written. No
      // sleeps, no assumption about who goes first.
      const account = await createAccount();
      await post(account.id, '10000.00');

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          post(account.id, '-100.00', { movementType: 'PAYMENT' }),
        ),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      expect(await storedBalance(account.id)).toBe(await ledgerSum(account.id));
      expect(await ledgerSum(account.id)).toBe('9200');
    });

    it('posts one movement when the same document is confirmed twice at once', async () => {
      const account = await createAccount();
      const sourceId = crypto.randomUUID();

      const results = await Promise.allSettled([
        post(account.id, '333.00', { sourceId }),
        post(account.id, '333.00', { sourceId }),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const movements = await prisma.treasuryMovement.count({
        where: { treasuryAccountId: account.id },
      });
      expect(movements).toBe(1);
      expect(await storedBalance(account.id)).toBe('333');
    });
  });

  describe('company isolation', () => {
    it('does not reveal another company’s account', async () => {
      const accountB = await createAccount({}, companyBId);
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/treasury/accounts/${accountB.id}`)
        .set(COMPANY_ID_HEADER, companyAId);
      // Not found, not forbidden: distinguishing them would confirm it exists.
      expect(res.status).toBe(404);
    });

    it('never lists another company’s accounts', async () => {
      await createAccount({}, companyBId);
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get('/api/v1/treasury/accounts')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);
      const ids = (res.body as { accounts: { id: string }[] }).accounts.map(
        (a) => a.id,
      );
      const bAccounts = await prisma.treasuryAccount.findMany({
        where: { companyId: companyBId },
        select: { id: true },
      });
      for (const b of bAccounts) expect(ids).not.toContain(b.id);
    });
  });

  describe('the statement', () => {
    it('carries a running balance that ends at the account balance', async () => {
      const account = await createAccount();
      await post(account.id, '1000.00');
      await post(account.id, '-250.00', { movementType: 'PAYMENT' });
      await post(account.id, '75.00');

      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/treasury/accounts/${account.id}/statement`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(200);

      const body = res.body as StatementBody;
      expect(body.pagination.total).toBe(3);
      expect(body.rows.at(-1)?.runningBalance).toBe(body.account.balance);
      expect(body.account.balance).toBe('825');
    });

    it('keeps the real running balance when the rows are filtered', async () => {
      // The defect: filtering by type or date used to restart the running
      // total from the filtered subset, so "payments since March" read as
      // though the account had been empty in February. The filters decide
      // which rows are SHOWN; the running balance is still the account's.
      const account = await createAccount();
      await post(account.id, '1000.00');
      await post(account.id, '-300.00', { movementType: 'PAYMENT' });
      await post(account.id, '500.00');
      await post(account.id, '-200.00', { movementType: 'PAYMENT' });

      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/treasury/accounts/${account.id}/statement`)
        .query({ movementType: 'PAYMENT' })
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const body = res.body as StatementBody;
      expect(body.pagination.total).toBe(2);
      // 1000 - 300 = 700 after the first payment, and 1000-300+500-200 =
      // 1000 after the second — NOT -300 and -500, which is what summing
      // only the filtered rows would give.
      expect(body.rows.map((r) => r.runningBalance)).toEqual(['700', '1000']);
      // And the last one equals the account balance, because the last
      // payment is also the account's last movement.
      expect(body.rows.at(-1)?.runningBalance).toBe(body.account.balance);
    });

    it('says out loud that a cash box does not include POS sales', async () => {
      // The gap is real until POS is wired — see docs/treasury.md. The API
      // has to hand the UI that fact rather than let it show a bare number.
      const account = await createAccount();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/treasury/accounts/${account.id}/statement`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect((res.body as StatementBody).excludesPosSales).toBe(true);
    });
  });

  describe('decimal precision', () => {
    it('keeps three and four decimals instead of rounding to two', async () => {
      // The column is NUMERIC(19,4) and each currency declares its own
      // precision. Serializing everything through toFixed(2) quietly
      // rounded real amounts.
      const account = await createAccount();
      await post(account.id, '10.1234');
      await post(account.id, '0.005');

      expect(await ledgerSum(account.id)).toBe('10.1284');
      const agent = await loginAs(userAdminId);
      const res = await agent
        .get(`/api/v1/treasury/accounts/${account.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);
      expect((res.body as AccountBody).account.balance).toBe('10.1284');
    });
  });

  describe('the opening balance sign', () => {
    it('lets a bank account with an overdraft open negative', async () => {
      // A bank can genuinely be overdrawn the day the module is loaded,
      // and refusing to record that forces the operator to lie about the
      // starting position.
      const account = await createAccount({
        code: nextCode('BANCONEG'),
        name: 'Banco en descubierto',
        type: 'BANK_ACCOUNT',
        allowsNegativeBalance: true,
      });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '-2500.50' });
      expect(res.status).toBe(201);
      expect((res.body as AccountBody).account.balance).toBe('-2500.5');
    });

    it('refuses a negative opening on a cash box, and says why', async () => {
      const account = await createAccount();
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '-100' });
      expect(res.status).toBe(400);
      // Its own code: "there is not enough money" is not what happened.
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'NEGATIVE_OPENING_BALANCE_NOT_ALLOWED',
      );
    });

    it('refuses a negative opening on a bank without an overdraft', async () => {
      const account = await createAccount({
        code: nextCode('BANCOSIN'),
        name: 'Banco sin descubierto',
        type: 'BANK_ACCOUNT',
      });
      const agent = await loginAs(userAdminId);
      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '-1' });
      expect(res.status).toBe(400);
      expect((res.body as ErrorEnvelope).error.code).toBe(
        'NEGATIVE_OPENING_BALANCE_NOT_ALLOWED',
      );
    });
  });

  describe('permissions', () => {
    it('refuses a user with no treasury permissions at all', async () => {
      const agent = await loginAs(userNoAccessId);
      const res = await agent
        .get('/api/v1/treasury/accounts')
        .set(COMPANY_ID_HEADER, companyAId);
      expect(res.status).toBe(403);
    });

    it('refuses account creation to a read-only user', async () => {
      const agent = await loginAs(userReadOnlyId);
      const res = await agent
        .post('/api/v1/treasury/accounts')
        .set(COMPANY_ID_HEADER, companyAId)
        .send({
          code: nextCode('NOPE'),
          name: 'No',
          type: 'CASH_BOX',
          currencyId: arsId,
        });
      expect(res.status).toBe(403);
    });

    it('refuses the statement to a reader who may not see the account', async () => {
      // The statement returns the account too — balance, bank, CBU, alias
      // — so the ledger code alone is not enough for it.
      const account = await createAccount();
      const agent = await loginAs(userReadOnlyId);
      await agent
        .get(`/api/v1/treasury/accounts/${account.id}/statement`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);
    });

    it('separates seeing an account from reading its ledger', async () => {
      const account = await createAccount();
      const agent = await loginAs(userNoLedgerId);

      await agent
        .get(`/api/v1/treasury/accounts/${account.id}`)
        .set(COMPANY_ID_HEADER, companyAId)
        .expect(200);

      const statement = await agent
        .get(`/api/v1/treasury/accounts/${account.id}/statement`)
        .set(COMPANY_ID_HEADER, companyAId);
      expect(statement.status).toBe(403);
    });

    it('refuses an opening balance to a user who cannot write movements', async () => {
      const account = await createAccount();
      const agent = await loginAs(userReadOnlyId);
      const res = await agent
        .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
        .set(COMPANY_ID_HEADER, companyAId)
        .send({ amount: '10.00' });
      expect(res.status).toBe(403);
    });
  });
});
