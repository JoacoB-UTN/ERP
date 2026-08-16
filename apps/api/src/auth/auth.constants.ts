/** Cookie names for the access/refresh credentials. */
export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Password reset tokens are short-lived by design (much shorter than a
 * session) — a stolen reset link should have a small window of use.
 * Centralized here per CLAUDE.md ("do not hardcode security-sensitive
 * timing values throughout the codebase").
 */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** DI token for the PasswordResetDelivery abstraction. */
export const PASSWORD_RESET_DELIVERY = Symbol('PASSWORD_RESET_DELIVERY');
