import { describe, expect, it } from 'vitest';
import { parseAgentEnv } from '../src/config';

const base = { DATABASE_URL: 'postgresql://erp:erp@localhost:5433/erp_platform' };

describe('parseAgentEnv', () => {
  it('applies local-first defaults', () => {
    const env = parseAgentEnv({ ...base } as NodeJS.ProcessEnv);

    expect(env.ERP_BACKUP_TIMES).toEqual(['03:00']);
    expect(env.ERP_BACKUP_RETENTION_DAYS).toBe(30);
    expect(env.ERP_BACKUP_KEEP_MINIMUM).toBe(7);
    // The offsite copy must never be on unless deliberately switched on.
    expect(env.ERP_BACKUP_CLOUD_ENABLED).toBe(false);
  });

  it('requires a database url', () => {
    expect(() => parseAgentEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('parses, de-duplicates and sorts the schedule', () => {
    const env = parseAgentEnv({
      ...base,
      ERP_BACKUP_TIMES: '22:00, 03:00 ,03:00',
    } as NodeJS.ProcessEnv);

    expect(env.ERP_BACKUP_TIMES).toEqual(['03:00', '22:00']);
  });

  it('rejects a malformed time of day', () => {
    expect(() =>
      parseAgentEnv({ ...base, ERP_BACKUP_TIMES: '25:00' } as NodeJS.ProcessEnv),
    ).toThrow(/not a valid 24-hour time/);

    expect(() =>
      parseAgentEnv({ ...base, ERP_BACKUP_TIMES: '3am' } as NodeJS.ProcessEnv),
    ).toThrow(/not a valid 24-hour time/);
  });

  it('fails fast when the offsite copy is enabled but not configured', () => {
    // Better to refuse to start than to let an operator believe they have an
    // offsite copy that has never actually uploaded anything.
    expect(() =>
      parseAgentEnv({ ...base, ERP_BACKUP_CLOUD_ENABLED: 'true' } as NodeJS.ProcessEnv),
    ).toThrow(/ERP_BACKUP_CLOUD_BUCKET is required/);
  });

  it('accepts a fully configured offsite copy', () => {
    const env = parseAgentEnv({
      ...base,
      ERP_BACKUP_CLOUD_ENABLED: 'true',
      ERP_BACKUP_CLOUD_BUCKET: 'erp-backups',
      ERP_BACKUP_CLOUD_ACCESS_KEY_ID: 'key',
      ERP_BACKUP_CLOUD_SECRET_ACCESS_KEY: 'secret',
    } as NodeJS.ProcessEnv);

    expect(env.ERP_BACKUP_CLOUD_ENABLED).toBe(true);
    expect(env.ERP_BACKUP_CLOUD_PREFIX).toBe('erp-backups');
  });
});
