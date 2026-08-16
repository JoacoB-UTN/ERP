import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '@erp/config';

export interface PasswordResetDeliveryPayload {
  email: string;
  token: string;
  expiresAt: Date;
}

/**
 * Abstraction over "how a password reset link reaches the user". No real
 * provider (email/SMS) is wired up yet — that's future work. Swapping in a
 * real implementation later should not require touching AuthService.
 */
export interface PasswordResetDelivery {
  deliver(payload: PasswordResetDeliveryPayload): Promise<void>;
}

/**
 * Development/default implementation: logs that a reset was requested.
 * The raw token is only ever logged outside production, and even then
 * only to make local testing of the flow possible without a real mailbox.
 */
@Injectable()
export class ConsolePasswordResetDelivery implements PasswordResetDelivery {
  private readonly logger = new Logger(ConsolePasswordResetDelivery.name);

  constructor(private readonly configService: ConfigService<Env, true>) {}

  async deliver({
    email,
    token,
    expiresAt,
  }: PasswordResetDeliveryPayload): Promise<void> {
    const isProduction =
      this.configService.get('NODE_ENV', { infer: true }) === 'production';
    if (isProduction) {
      // No real delivery provider configured yet. Never log the token in
      // production — this is intentionally a no-op beyond the audit line.
      this.logger.warn(
        `Password reset requested for ${email}, but no delivery provider is configured.`,
      );
      return;
    }
    this.logger.log(
      `[DEV ONLY] Password reset for ${email}: token=${token} (expires ${expiresAt.toISOString()})`,
    );
    await Promise.resolve();
  }
}

/** In-memory fake for tests — captures the last delivery for assertions. */
@Injectable()
export class InMemoryPasswordResetDelivery implements PasswordResetDelivery {
  public lastDelivery: PasswordResetDeliveryPayload | undefined;

  async deliver(payload: PasswordResetDeliveryPayload): Promise<void> {
    this.lastDelivery = payload;
    await Promise.resolve();
  }
}
