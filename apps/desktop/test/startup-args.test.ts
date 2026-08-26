import { describe, it, expect } from 'vitest';
import { parseStartupArgs } from '../src/startup-args';

describe('parseStartupArgs', () => {
  it('parses --workspace=gestion', () => {
    expect(parseStartupArgs(['--workspace=gestion'])).toEqual({ workspace: 'gestion' });
  });

  it('parses --workspace=facturacion', () => {
    expect(parseStartupArgs(['--workspace=facturacion'])).toEqual({ workspace: 'facturacion' });
  });

  it('finds the flag among other argv entries', () => {
    expect(parseStartupArgs(['/path/to/ERP.exe', '--workspace=gestion', '--some-other-flag'])).toEqual({
      workspace: 'gestion',
    });
  });

  it('returns no workspace when the flag is absent', () => {
    expect(parseStartupArgs(['/path/to/ERP.exe'])).toEqual({});
  });

  it('returns no workspace for an empty argv', () => {
    expect(parseStartupArgs([])).toEqual({});
  });

  it('falls back safely on an unknown workspace value — never executes an arbitrary value', () => {
    expect(parseStartupArgs(['--workspace=facturacion-admin-mode'])).toEqual({});
  });

  it('falls back safely on an empty workspace value', () => {
    expect(parseStartupArgs(['--workspace='])).toEqual({});
  });

  it('falls back safely on an attempted URL/path injection', () => {
    expect(parseStartupArgs(['--workspace=http://evil.example.com'])).toEqual({});
  });

  it('is case-sensitive — "Gestion" is not a recognized workspace', () => {
    expect(parseStartupArgs(['--workspace=Gestion'])).toEqual({});
  });
});
