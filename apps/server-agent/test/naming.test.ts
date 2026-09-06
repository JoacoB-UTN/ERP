import { describe, expect, it } from 'vitest';
import { buildArchiveName, isArchiveName, parseArchiveDate } from '../src/naming';

describe('archive naming', () => {
  it('builds a sortable, filesystem-safe name', () => {
    const name = buildArchiveName('erp_platform', new Date(2026, 8, 1, 3, 5, 9));
    expect(name).toBe('erp-erp_platform-20260901-030509.dump');
  });

  it('sanitises database names that are not filename-safe', () => {
    const name = buildArchiveName('erp/prod db', new Date(2026, 8, 1, 3, 0, 0));
    expect(name).toBe('erp-erp_prod_db-20260901-030000.dump');
  });

  it('round-trips the timestamp', () => {
    const at = new Date(2026, 8, 1, 3, 5, 9);
    const parsed = parseArchiveDate(buildArchiveName('erp_platform', at));

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(1);
    expect(parsed?.getHours()).toBe(3);
    expect(parsed?.getMinutes()).toBe(5);
    expect(parsed?.getSeconds()).toBe(9);
  });

  it('rejects foreign files', () => {
    expect(isArchiveName('manifest.json')).toBe(false);
    expect(isArchiveName('backup.sql')).toBe(false);
    expect(parseArchiveDate('manifest.json')).toBeNull();
  });
});
