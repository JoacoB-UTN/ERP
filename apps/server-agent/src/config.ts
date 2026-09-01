import { z } from 'zod';

/**
 * Configuration for the ERP Server maintenance agent.
 *
 * Read from the process environment (the installer writes these into the
 * Windows service definition), validated with zod and failing fast — same
 * contract as the API's own environment schema in `packages/config`.
 *
 * Cloud credentials are read from the environment ONLY. They are never
 * persisted to the database, never written to the backup manifest, and
 * never logged — see AGENTS.md on secret leakage.
 */

const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((v) => v === 'true');

/** "HH:MM" in 24-hour local time. */
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

const timesOfDay = z
  .string()
  .default('03:00')
  .transform((raw, ctx) => {
    const parts = raw
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one backup time is required (e.g. "03:00").',
      });
      return z.NEVER;
    }

    for (const part of parts) {
      if (!TIME_OF_DAY.test(part)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${part}" is not a valid 24-hour time of day (expected HH:MM).`,
        });
        return z.NEVER;
      }
    }

    // Sorted and de-duplicated so "next run" maths is order-independent.
    return [...new Set(parts)].sort();
  });

export const agentEnvSchema = z
  .object({
    /** Same connection string the API uses — the agent only ever reads it to derive pg_dump arguments. */
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    ERP_BACKUP_DIR: z.string().min(1).default('./backups'),
    ERP_BACKUP_TIMES: timesOfDay,
    /** Delete backups older than this — but never below ERP_BACKUP_KEEP_MINIMUM. */
    ERP_BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    /**
     * Hard floor on how many successful backups survive pruning, regardless of
     * age. Protects the case where the agent was offline for a month and every
     * surviving backup is "expired" — deleting them all would leave the
     * business with nothing.
     */
    ERP_BACKUP_KEEP_MINIMUM: z.coerce.number().int().positive().default(7),

    /**
     * Explicit path to the PostgreSQL bin directory (the one holding
     * pg_dump/pg_restore). The installer points this at the bundled
     * PostgreSQL; when unset the agent falls back to PATH.
     */
    ERP_PG_BIN_DIR: z.string().optional(),
    /** A dump that takes longer than this is treated as failed. */
    ERP_BACKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),

    // ---- Offsite copy (optional, S3-compatible: AWS S3, Backblaze B2, MinIO, R2) ----
    // Disabled by default: the product is local-first, and a local install must
    // never require an internet connection or an account to be operable.
    ERP_BACKUP_CLOUD_ENABLED: booleanString('false'),
    ERP_BACKUP_CLOUD_ENDPOINT: z.string().url().optional(),
    ERP_BACKUP_CLOUD_REGION: z.string().default('us-east-1'),
    ERP_BACKUP_CLOUD_BUCKET: z.string().optional(),
    ERP_BACKUP_CLOUD_PREFIX: z.string().default('erp-backups'),
    ERP_BACKUP_CLOUD_ACCESS_KEY_ID: z.string().optional(),
    ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY: z.string().optional(),

    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  })
  .superRefine((config, ctx) => {
    if (config.ERP_BACKUP_KEEP_MINIMUM < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ERP_BACKUP_KEEP_MINIMUM'],
        message: 'Retention must always keep at least one backup.',
      });
    }

    if (!config.ERP_BACKUP_CLOUD_ENABLED) return;

    // Fail at startup rather than at 03:00 when nobody is watching: a cloud
    // copy that is switched on but misconfigured is worse than one that is off,
    // because the operator believes they have an offsite copy.
    const required = [
      ['ERP_BACKUP_CLOUD_BUCKET', config.ERP_BACKUP_CLOUD_BUCKET],
      ['ERP_BACKUP_CLOUD_ACCESS_KEY_ID', config.ERP_BACKUP_CLOUD_ACCESS_KEY_ID],
      ['ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY', config.ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY],
    ] as const;

    for (const [name, value] of required) {
      if (!value) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: `${name} is required when ERP_BACKUP_CLOUD_ENABLED is true.`,
        });
      }
    }
  });

export type AgentEnv = z.infer<typeof agentEnvSchema>;

export function parseAgentEnv(raw: NodeJS.ProcessEnv): AgentEnv {
  const result = agentEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid ERP Server agent configuration:\n${issues}`);
  }
  return result.data;
}
