import { describe, expect, it } from 'vitest';
import { buildObjectKey, isCloudEnabled } from '../src/cloud';
import { parseAgentEnv } from '../src/config';

const base = { DATABASE_URL: 'postgresql://erp:erp@localhost:5433/erp_platform' };

describe('buildObjectKey', () => {
  it('joins prefix and file name', () => {
    expect(buildObjectKey('erp-backups', 'a.dump')).toBe('erp-backups/a.dump');
  });

  it('tolerates surrounding slashes', () => {
    expect(buildObjectKey('/erp/backups/', 'a.dump')).toBe('erp/backups/a.dump');
  });

  it('omits an empty prefix', () => {
    expect(buildObjectKey('', 'a.dump')).toBe('a.dump');
  });
});

describe('isCloudEnabled', () => {
  it('is off by default — a local install must work with no account', () => {
    expect(isCloudEnabled(parseAgentEnv({ ...base } as NodeJS.ProcessEnv))).toBe(false);
  });
});
