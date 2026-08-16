import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import type { AuditService } from '../audit/audit.service';

describe('AuthService', () => {
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    userSession: { updateMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let passwordService: { verify: jest.Mock; hash: jest.Mock };
  let tokenService: {
    signAccessToken: jest.Mock;
    generateOpaqueToken: jest.Mock;
    hashOpaqueToken: jest.Mock;
  };
  let sessionService: {
    createSession: jest.Mock;
    rotateSession: jest.Mock;
    revokeByRawToken: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let delivery: { deliver: jest.Mock };
  let auditService: { record: jest.Mock };
  let service: AuthService;

  const activeUser = {
    id: 'u1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    passwordHash: 'hashed:secret',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userSession: { updateMany: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    passwordService = {
      verify: jest.fn(),
      hash: jest.fn((p: string) => `hashed:${p}`),
    };
    tokenService = {
      signAccessToken: jest.fn(() => 'signed-jwt'),
      generateOpaqueToken: jest.fn(() => 'raw-reset-token'),
      hashOpaqueToken: jest.fn((t: string) => `hash(${t})`),
    };
    sessionService = {
      createSession: jest.fn(() => ({
        session: { id: 's1', expiresAt: new Date() },
        rawToken: 'raw-refresh',
      })),
      rotateSession: jest.fn(),
      revokeByRawToken: jest.fn(),
      revokeAllForUser: jest.fn(() => 2),
    };
    delivery = { deliver: jest.fn() };
    auditService = { record: jest.fn() };

    service = new AuthService(
      prisma as unknown as PrismaService,
      passwordService,
      tokenService as unknown as TokenService,
      sessionService as unknown as SessionService,
      auditService as unknown as AuditService,
      delivery,
    );
  });

  describe('login', () => {
    it('rejects an unknown email with the generic message (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login('nobody@example.com', 'whatever', {}),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid email or password.'),
      );
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('rejects an inactive/blocked user with the SAME generic message', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: 'BLOCKED',
      });
      await expect(
        service.login(activeUser.email, 'secret', {}),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid email or password.'),
      );
      expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('rejects a wrong password with the generic message', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(false);
      await expect(
        service.login(activeUser.email, 'wrong', {}),
      ).rejects.toThrow(
        new UnauthorizedException('Invalid email or password.'),
      );
      expect(sessionService.createSession).not.toHaveBeenCalled();
    });

    it('succeeds for a valid active user and never returns the password hash', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);
      prisma.user.update.mockResolvedValue({});

      const result = await service.login(activeUser.email, 'secret', {});

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user.email).toBe(activeUser.email);
      expect(result.accessToken).toBe('signed-jwt');
      expect(result.refreshToken).toBe('raw-refresh');
      expect(sessionService.createSession).toHaveBeenCalledWith('u1', {});
      expect(tokenService.signAccessToken).toHaveBeenCalledWith({
        sub: 'u1',
        email: activeUser.email,
        sid: 's1',
      });
    });
  });

  describe('refresh', () => {
    it('rejects when the session cannot be rotated (invalid/expired/revoked)', async () => {
      sessionService.rotateSession.mockResolvedValue(null);
      await expect(service.refresh('bad-token', {})).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates and issues a fresh access token bound to the new session', async () => {
      sessionService.rotateSession.mockResolvedValue({
        session: { id: 's2', expiresAt: new Date() },
        rawToken: 'new-raw-refresh',
        userId: 'u1',
      });
      prisma.user.findUnique.mockResolvedValue(activeUser);

      const result = await service.refresh('old-raw', {});

      expect(result.refreshToken).toBe('new-raw-refresh');
      expect(tokenService.signAccessToken).toHaveBeenCalledWith({
        sub: 'u1',
        email: activeUser.email,
        sid: 's2',
      });
    });
  });

  describe('logout', () => {
    it('is a no-op (idempotent) when there is no refresh token', async () => {
      await expect(service.logout(undefined, {})).resolves.toBeUndefined();
      expect(sessionService.revokeByRawToken).not.toHaveBeenCalled();
    });

    it('revokes the session for a given refresh token', async () => {
      await service.logout('some-raw-token', {});
      expect(sessionService.revokeByRawToken).toHaveBeenCalledWith(
        'some-raw-token',
      );
    });
  });

  describe('logoutAll', () => {
    it('revokes all sessions for the user', async () => {
      await service.logoutAll('u1', {});
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('u1');
    });
  });

  describe('changePassword', () => {
    it('rejects an incorrect current password without touching the user', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        service.changePassword(
          'u1',
          's1',
          'wrong',
          'brand-new-password-1234',
          {},
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates the password and revokes every OTHER session, keeping the current one', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      passwordService.verify.mockResolvedValue(true);

      await service.changePassword(
        'u1',
        'current-session-id',
        'secret',
        'brand-new-password-1234',
        {},
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hashed:brand-new-password-1234' },
      });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith(
        'u1',
        'current-session-id',
      );
    });
  });

  describe('forgotPassword', () => {
    it('does nothing (and never calls delivery) for an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await service.forgotPassword('nobody@example.com');
      expect(delivery.deliver).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('does nothing for an inactive user (no enumeration signal either way)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: 'BLOCKED',
      });
      await service.forgotPassword(activeUser.email);
      expect(delivery.deliver).not.toHaveBeenCalled();
    });

    it('creates a hashed token and delivers the RAW token (never the hash) for an active user', async () => {
      prisma.user.findUnique.mockResolvedValue(activeUser);
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.forgotPassword(activeUser.email);

      const createCalls = prisma.passwordResetToken.create.mock
        .calls as unknown[][];
      const createArgs = createCalls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArgs.data.tokenHash).toBe('hash(raw-reset-token)');
      expect(delivery.deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          email: activeUser.email,
          token: 'raw-reset-token',
        }),
      );
    });
  });

  describe('resetPassword', () => {
    it('rejects an unknown token with a generic message', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);
      await expect(
        service.resetPassword('bad-token', 'brand-new-password-1234', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        service.resetPassword('token', 'brand-new-password-1234', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 100_000),
      });
      await expect(
        service.resetPassword('token', 'brand-new-password-1234', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('changes the password, marks the token used, and revokes every session', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'r1',
        userId: 'u1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 100_000),
      });

      await service.resetPassword('good-token', 'brand-new-password-1234', {});

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { passwordHash: 'hashed:brand-new-password-1234' },
      });
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { usedAt: expect.any(Date) as unknown },
      });
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as unknown },
      });
    });
  });
});
