/**
 * Parses jsonwebtoken-style duration strings ("15m", "30d", "1h", "45s")
 * into milliseconds. Only used where we need to compute a plain Date
 * (e.g. UserSession.expiresAt) — @nestjs/jwt accepts these strings
 * natively for signing, so JWT expiry never goes through this function.
 */
export function parseDurationMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(
      `Invalid duration string: "${duration}" (expected e.g. "15m", "30d")`,
    );
  }
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * unitMs[unit];
}
