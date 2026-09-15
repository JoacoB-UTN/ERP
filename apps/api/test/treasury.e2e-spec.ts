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

  async function ledgerSum(accountId: string) {
    const agg = await prisma.treasuryMovement.aggregate({
      where: { treasuryAccountId: accountId },
      _sum: { amount: true },
    });
    return (agg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2);
  }

  async function storedBalance(accountId: string) {
    const row = await prisma.treasuryAccountBalance.findFirst({
      where: { treasuryAccountId: accountId },
    });
    return (row?.balance ?? new Prisma.Decimal(0)).toFixed(2);
  }

  describe('accounts', () => {
    it('creates a cash box and starts it at zero, not at nothing', async () => {
      const account = await createAccount();
      expect(account.balance).toBe('0.00');
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
      expect((res.body as AccountBody).account.balance).toBe('15000.00');

      const movements = await prisma.treasuryMovement.findMany({
        where: { treasuryAccountId: account.id },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('OPENING_BALANCE');
      expect(await ledgerSum(account.id)).toBe('15000.00');
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
      expect(await ledgerSum(account.id)).toBe('100.00');
    });
  });

  describe('the ledger', () => {
    it('keeps the balance equal to the sum of the movements', async () => {
      const account = await createAccount();
      await post(account.id, '1000.00');
      await post(account.id, '500.50');
      await post(account.id, '-200.50', { movementType: 'PAYMENT' });

      expect(await ledgerSum(account.id)).toBe('1300.00');
      expect(await storedBalance(account.id)).toBe('1300.00');
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
      expect(await ledgerSum(account.id)).toBe('500.00');
      expect(await storedBalance(account.id)).toBe('500.00');
    });

    it('does not double-count a retried post of the same document', async () => {
      const account = await createAccount();
      const sourceId = crypto.randomUUID();

      const first = await post(account.id, '750.00', { sourceId });
      const second = await post(account.id, '750.00', { sourceId });

      expect(first).not.toBeNull();
      // Null, not an error: the ledger already says what the caller wanted.
      expect(second).toBeNull();
      expect(await ledgerSum(account.id)).toBe('750.00');
      expect(await storedBalance(account.id)).toBe('750.00');
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
      expect(await ledgerSum(account.id)).toBe('100.00');
      expect(await storedBalance(account.id)).toBe('100.00');
    });

    it('lets a bank account with an overdraft go below zero', async () => {
      const account = await createAccount({
        code: nextCode('BANCO'),
        name: 'Banco con giro',
        type: 'BANK_ACCOUNT',
        allowsNegativeBalance: true,
      });
      await post(account.id, '-4200.00', { movementType: 'PAYMENT' });
      expect(await storedBalance(account.id)).toBe('-4200.00');
    });

    it('refuses a movement in a currency the account does not hold', async () => {
      const account = await createAccount();
      await expect(
        post(account.id, '100.00', { currencyId: usdId }),
      ).rejects.toMatchObject({
        response: { code: 'TREASURY_CURRENCY_MISMATCH' },
      });
    });

    it('a rebuild running against a concurrent post does not lose it', async () => {
      // The rebuild used to sum OUTSIDE its write transaction, so a
      // movement committed in between was silently overwritten by a total
      // computed before it existed — a repair that loses money. Now it
      // locks the account and sums inside the same transaction, so the
      // two serialize whichever way round they land.
      const account = await createAccount();
      await post(account.id, '1000.00');

      const results = await Promise.allSettled([
        treasury.rebuildTreasuryBalances(companyAId),
        post(account.id, '250.00'),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // The invariant, not a winner: whoever went second, the projection
      // ends up equal to the ledger.
      expect(await storedBalance(account.id)).toBe(await ledgerSum(account.id));
      expect(await ledgerSum(account.id)).toBe('1250.00');
    });

    it("an opening balance racing the account's first movement cannot land on top of it", async () => {
      // The emptiness check now happens under the same lock every writer
      // takes, so "the ledger is empty" cannot go stale between the check
      // and the insert.
      const account = await createAccount();
      const agent = await loginAs(userAdminId);

      const results = await Promise.allSettled([
        agent
          .post(`/api/v1/treasury/accounts/${account.id}/opening-balance`)
          .set(COMPANY_ID_HEADER, companyAId)
          .send({ amount: '900.00' }),
        post(account.id, '100.00'),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      // Either order is fine. What must hold is that the balance equals
      // the ledger, and that there is at most ONE opening movement.
      expect(await storedBalance(account.id)).toBe(await ledgerSum(account.id));
      const openings = await prisma.treasuryMovement.count({
        where: {
          treasuryAccountId: account.id,
          movementType: 'OPENING_BALANCE',
        },
      });
      expect(openings).toBeLessThanOrEqual(1);
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

      expect(await storedBalance(account.id)).toBe('900.00');
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
      expect(await ledgerSum(account.id)).toBe('9200.00');
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
      expect(await storedBalance(account.id)).toBe('333.00');
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
      expect(body.account.balance).toBe('825.00');
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
