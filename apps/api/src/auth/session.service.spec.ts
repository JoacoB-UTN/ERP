import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { PrismaService } from '../database/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';

describe('SessionService', () => {
  let prisma: {
    userSession: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let tokenService: {
    generateOpaqueToken: jest.Mock;
    hashOpaqueToken: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let service: SessionService;

  beforeEach(() => {
    prisma = {
      userSession: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    tokenService = {
      generateOpaqueToken: jest.fn(() => 'raw-token'),
      hashOpaqueToken: jest.fn((t: string) => `hash(${t})`),
    };
    configService = { get: jest.fn(() => '30d') };
    service = new SessionService(
      prisma as unknown as PrismaService,
      tokenService as unknown as TokenService,
      configService as unknown as ConfigService<Env, true>,
    );
  });

  it('creates a session storing only the hashed token, never the raw one', async () => {
    prisma.userSession.create.mockResolvedValue({ id: 's1' });

    const { rawToken } = await service.createSession('user-1', {});

    expect(rawToken).toBe('raw-token');
    const createCalls = prisma.userSession.create.mock.calls as unknown[][];
    const createArgs = createCalls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createArgs.data.tokenHash).toBe('hash(raw-token)');
    expect(createArgs.data).not.toHaveProperty('rawToken');
    expect(createArgs.data).not.toHaveProperty('token');
  });

  it('rotateSession returns null for an unknown token', async () => {
    prisma.userSession.findUnique.mockResolvedValue(null);
    await expect(service.rotateSession('bad-token', {})).resolves.toBeNull();
  });

  it('rotateSession returns null for an already-revoked session', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 10_000),
    });
    await expect(service.rotateSession('token', {})).resolves.toBeNull();
  });

  it('rotateSession returns null for an expired session', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 10_000),
    });
    await expect(service.rotateSession('token', {})).resolves.toBeNull();
  });

  it('rotates: revokes the old session and issues a brand new one', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
    });
    prisma.userSession.update.mockResolvedValue({
      id: 's1',
      revokedAt: new Date(),
    });
    prisma.userSession.create.mockResolvedValue({ id: 's2', userId: 'u1' });

    const result = await service.rotateSession('old-raw-token', {});

    expect(result).not.toBeNull();
    expect(result?.session.id).toBe('s2');
    expect(result?.userId).toBe('u1');
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          revokedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });

  it('revokeByRawToken is idempotent — an unknown token returns null, not an error', async () => {
    prisma.userSession.findUnique.mockResolvedValue(null);
    await expect(service.revokeByRawToken('unknown-token')).resolves.toBeNull();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('revokeByRawToken is idempotent — an already-revoked session returns null, not an error', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: new Date(),
    });
    await expect(
      service.revokeByRawToken('already-revoked-token'),
    ).resolves.toBeNull();
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('revokeByRawToken revokes an active session and returns its identity', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      revokedAt: null,
    });
    const result = await service.revokeByRawToken('active-token');
    expect(result).toEqual({ id: 's1', userId: 'u1' });
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          revokedAt: expect.any(Date) as unknown,
        }) as unknown,
      }),
    );
  });

  it('revokeAllForUser can exclude the current session id', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 3 });

    const count = await service.revokeAllForUser('u1', 'current-session-id');

    expect(count).toBe(3);
    const updateManyCalls = prisma.userSession.updateMany.mock
      .calls as unknown[][];
    const { where: whereArg } = updateManyCalls[0][0] as {
      where: { id?: unknown };
    };
    expect(whereArg.id).toEqual({ not: 'current-session-id' });
  });
});
