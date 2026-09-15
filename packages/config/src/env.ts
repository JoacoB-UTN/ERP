import { z } from 'zod';

const DEV_ONLY_ACCESS_TOKEN_SECRET = 'dev-insecure-access-secret-change-me';

const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

/**
 * Canonical environment schema for apps/api.
 * Fails fast (throws) if required variables are missing or malformed —
 * the application must not start with an invalid configuration.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    // OPTIONAL, and empty means "this deployment has no cache" rather than
    // "the cache is broken". It was required, so the Windows installer had to
    // invent a value and pointed it at redis://127.0.0.1:6379 -- a Redis the
    // installer deliberately never ships. Every installation therefore
    // reported `degraded` forever, which makes the health panel a permanent
    // yellow light an operator cannot distinguish from a real fault.
    //
    // Redis only caches effective permissions, and AuthorizationService
    // recomputes them from PostgreSQL on any cache error, so running without
    // it is a supported configuration and not a degradation.
    REDIS_URL: z.string().default(''),
    // Comma-separated list of allowed browser origins, e.g.
    // "http://localhost:3000,http://localhost:3002" (Gestión, Facturación).
    CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:3002'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Directory the ERP Server maintenance agent (apps/server-agent) writes its
    // backup archives and manifest to. The API only ever READS the manifest
    // from here to report backup health — it never writes, takes or restores a
    // backup. Must match the agent's own ERP_BACKUP_DIR.
    ERP_BACKUP_DIR: z.string().min(1).default('./backups'),

    // Runs the Current Accounts historical backfill on API startup — see
    // docs/current-accounts.md. On by default: an installation that
    // upgrades into the Current Accounts module otherwise has an empty
    // ledger against sales that already exist, and every customer reads
    // as owing nothing until someone runs the script by hand. Set to
    // "false" to take that responsibility manually
    // (`npm run db:backfill-current-accounts --workspace=apps/api`).
    ERP_CURRENT_ACCOUNTS_BACKFILL_ON_BOOT: booleanString('true'),

    // ---- Authentication ----
    // Signs short-lived access token JWTs. The default is an obviously-fake
    // placeholder so local dev works out of the box; production MUST set a
    // real secret (enforced below).
    AUTH_ACCESS_TOKEN_SECRET: z.string().min(16).default(DEV_ONLY_ACCESS_TOKEN_SECRET),
    // jsonwebtoken-style duration strings (e.g. "15m", "30d").
    AUTH_ACCESS_TOKEN_TTL: z.string().default('15m'),
    AUTH_REFRESH_TOKEN_TTL: z.string().default('30d'),
    // Cookie `Domain` attribute. Left unset in dev so cookies are host-only
    // for "localhost" — which browsers share across ports, letting Gestión
    // (3000), Facturación (3002) and the API (3001) all use the same
    // session cookie without extra configuration. Set explicitly in
    // production (e.g. ".example.com") if apps live on real subdomains.
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    AUTH_COOKIE_SECURE: booleanString('false'),
    AUTH_RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  })
  .superRefine((config, ctx) => {
    if (
      config.NODE_ENV === 'production' &&
      config.AUTH_ACCESS_TOKEN_SECRET === DEV_ONLY_ACCESS_TOKEN_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_ACCESS_TOKEN_SECRET'],
        message:
          'A real AUTH_ACCESS_TOKEN_SECRET must be set in production — the dev default is not allowed.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses and validates process.env, throwing a descriptive error on failure. */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
