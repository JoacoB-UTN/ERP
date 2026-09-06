import { describe, expect, it } from 'vitest';
import { connectionArgs, parseDatabaseUrl, resolvePgBinary } from '../src/pg';

describe('parseDatabaseUrl', () => {
  it('extracts connection parameters', () => {
    const connection = parseDatabaseUrl('postgresql://erp:secret@10.0.0.5:5433/erp_platform');

    expect(connection).toEqual({
      host: '10.0.0.5',
      port: 5433,
      database: 'erp_platform',
      user: 'erp',
      password: 'secret',
    });
  });

  it('defaults the port to 5432', () => {
    expect(parseDatabaseUrl('postgres://erp@localhost/erp_platform').port).toBe(5432);
  });

  it('decodes percent-encoded credentials', () => {
    const connection = parseDatabaseUrl('postgresql://us%40er:p%40ss@localhost/db');

    expect(connection.user).toBe('us@er');
    expect(connection.password).toBe('p@ss');
  });

  it('rejects a non-postgres url', () => {
    expect(() => parseDatabaseUrl('mysql://erp@localhost/db')).toThrow(/Unsupported/);
  });

  it('rejects a url without a database', () => {
    expect(() => parseDatabaseUrl('postgresql://erp@localhost/')).toThrow(/does not name a database/);
  });
});

describe('connectionArgs', () => {
  it('never passes the password on the command line', () => {
    // argv is world-readable on Windows; the password goes through PGPASSWORD.
    const connection = parseDatabaseUrl('postgresql://erp:secret@localhost/db');
    const args = connectionArgs(connection);

    expect(args.join(' ')).not.toContain('secret');
    expect(args).toContain('--no-password');
  });
});

describe('resolvePgBinary', () => {
  it('falls back to PATH when no bin directory is configured', () => {
    const resolved = resolvePgBinary('pg_dump');
    expect(resolved).toMatch(/^pg_dump(\.exe)?$/);
  });

  it('joins an explicit bin directory', () => {
    const resolved = resolvePgBinary('pg_dump', '/opt/pg/bin');
    expect(resolved).toContain('pg_dump');
    expect(resolved).toContain('bin');
  });
});
