import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { runCli } from './cli';

function empty(installationId: string) {
  return {
    version: 1,
    installationId,
    companyId: `${installationId}-company`,
    capturedAt: '2026-10-03T12:00:00Z',
    units: [],
    lines: [],
    categories: [],
    products: [],
    variants: [],
    codes: [],
  };
}

describe('offline diagnostic CLI filesystem boundary', () => {
  let directory: string;
  let central: string;
  let local: string;
  let output: string;
  let stdout: jest.Mock;
  let stderr: jest.Mock;
  const invoke = (extra: string[] = []) =>
    runCli(
      ['--central', central, '--local', local, '--output', output, ...extra],
      stdout,
      stderr,
    );

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'catalog-diagnostic-'));
    central = join(directory, 'central.json');
    local = join(directory, 'local.json');
    output = join(directory, 'report');
    writeFileSync(central, JSON.stringify(empty('central')));
    writeFileSync(local, JSON.stringify(empty('local')));
    stdout = jest.fn();
    stderr = jest.fn();
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('writes both reports while preserving input bytes and works without DB environment', () => {
    const before = [readFileSync(central), readFileSync(local)];
    expect(invoke()).toBe(0);
    expect(readFileSync(central)).toEqual(before[0]);
    expect(readFileSync(local)).toEqual(before[1]);
    expect(
      JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')),
    ).toMatchObject({ status: 'clear' });
    expect(
      readFileSync(join(output, 'report.md'), 'utf8').length,
    ).toBeGreaterThan(0);
  });

  it('refuses an existing destination without altering a previous report', () => {
    expect(invoke()).toBe(0);
    const before = readFileSync(join(output, 'report.json'));
    expect(invoke()).toBe(4);
    expect(readFileSync(join(output, 'report.json'))).toEqual(before);
  });

  it('refuses output paths aliasing an input or another directory', () => {
    const before = readFileSync(central);
    output = central;
    expect(invoke()).toBe(4);
    expect(readFileSync(central)).toEqual(before);
    output = join(directory, 'alias');
    symlinkSync(directory, output, 'dir');
    expect(invoke()).toBe(4);
    expect(readFileSync(central)).toEqual(before);
  });

  it('never treats missing or malformed input as an empty local catalog or leaks its contents', () => {
    writeFileSync(local, 'secret-sensitive-not-json');
    expect(invoke()).toBe(4);
    expect(existsSync(output)).toBe(false);
    expect(JSON.stringify(stderr.mock.calls)).not.toContain('secret-sensitive');
    rmSync(local);
    expect(invoke()).toBe(4);
    mkdirSync(local);
    expect(invoke()).toBe(4);
  });

  it('rejects oversized input before parsing', () => {
    writeFileSync(local, ' '.repeat(10 * 1024 * 1024 + 1));
    expect(invoke()).toBe(4);
    expect(existsSync(output)).toBe(false);
  });

  it('emits an invalid report, not success, for forbidden fields', () => {
    writeFileSync(local, JSON.stringify({ ...empty('local'), prices: [] }));
    expect(invoke()).toBe(2);
    expect(
      JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')),
    ).toMatchObject({ status: 'invalid-input' });
  });

  it('returns review-required for central-only data rather than implying import readiness', () => {
    writeFileSync(
      central,
      JSON.stringify({
        ...empty('central'),
        units: [{ id: 'unit-c', code: 'UN' }],
      }),
    );
    expect(invoke()).toBe(1);
    expect(
      JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')),
    ).toMatchObject({ status: 'review-required' });
  });

  it('reports incompatible mapped product types as conflict', () => {
    const fixtures = join(__dirname, '../../test/fixtures/sync-diagnostics');
    central = join(fixtures, 'central.json');
    local = join(fixtures, 'local-conflict.json');
    expect(invoke(['--mappings', join(fixtures, 'mappings.json')])).toBe(3);
    expect(
      JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')),
    ).toMatchObject({ status: 'conflicts' });
  });

  (process.platform === 'win32' ? it.skip : it)(
    'rejects a FIFO without waiting for a writer',
    () => {
      rmSync(local);
      expect(spawnSync('mkfifo', [local]).status).toBe(0);
      expect(invoke()).toBe(4);
      expect(existsSync(output)).toBe(false);
    },
  );

  it('refuses duplicate/unknown arguments and does not consume stale output as evidence', () => {
    expect(invoke(['--central', central])).toBe(4);
    expect(invoke(['--apply', 'yes'])).toBe(4);
    expect(existsSync(output)).toBe(false);
  });
});
