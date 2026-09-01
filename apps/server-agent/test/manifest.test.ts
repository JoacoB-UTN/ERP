import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BackupRunRecord } from '@erp/shared';
import { manifestPath, readManifest, recordRun, writeManifest } from '../src/manifest';

let dir: string;

const run = (id: string): BackupRunRecord => ({
  id,
  startedAt: '2026-09-01T03:00:00.000Z',
  finishedAt: '2026-09-01T03:01:00.000Z',
  status: 'success',
  trigger: 'scheduled',
  fileName: `erp-erp_platform-20260901-030000.dump`,
  sizeBytes: 1024,
  sha256: 'abc',
  durationMs: 60000,
  verified: true,
  cloud: { status: 'disabled' },
});

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-manifest-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('manifest', () => {
  it('treats a missing manifest as "never run", not an error', async () => {
    const manifest = await readManifest(dir);

    expect(manifest.runs).toEqual([]);
    expect(manifest.version).toBe(1);
  });

  it('round-trips runs newest first', async () => {
    await recordRun(dir, run('first'));
    await recordRun(dir, run('second'));

    const manifest = await readManifest(dir);
    expect(manifest.runs.map((entry) => entry.id)).toEqual(['second', 'first']);
  });

  it('survives a corrupt manifest without blocking future backups', async () => {
    // A truncated file must not stop tonight's backup — the history matters
    // far less than still having a backup.
    await fs.writeFile(manifestPath(dir), '{"version":1,"runs":[', 'utf8');

    const manifest = await readManifest(dir);
    expect(manifest.runs).toEqual([]);

    await recordRun(dir, run('after-corruption'));
    expect((await readManifest(dir)).runs.map((entry) => entry.id)).toEqual([
      'after-corruption',
    ]);
  });

  it('leaves no temp file behind after a write', async () => {
    await writeManifest(dir, { version: 1, runs: [run('a')] });

    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['manifest.json']);
  });

  it('never records a secret', async () => {
    await recordRun(dir, run('a'));
    const raw = await fs.readFile(manifestPath(dir), 'utf8');

    expect(raw).not.toMatch(/password|secret|accessKey|DATABASE_URL/i);
  });
});
