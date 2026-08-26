import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildConfig,
  DEFAULT_PORTS,
  isValidStoredConfig,
  loadConfig,
  normalizeServerInput,
  saveConfig,
  type DesktopConfig,
} from '../src/config';

describe('normalizeServerInput', () => {
  it('accepts a bare LAN IP', () => {
    const result = normalizeServerInput('192.168.1.50');
    expect(result).toEqual({ ok: true, scheme: 'http', host: '192.168.1.50' });
  });

  it('accepts an explicit http:// scheme', () => {
    const result = normalizeServerInput('http://192.168.1.50');
    expect(result).toEqual({ ok: true, scheme: 'http', host: '192.168.1.50' });
  });

  it('accepts a bare .local hostname', () => {
    const result = normalizeServerInput('erp-server.local');
    expect(result).toEqual({ ok: true, scheme: 'http', host: 'erp-server.local' });
  });

  it('accepts an explicit https:// .local hostname', () => {
    const result = normalizeServerInput('https://erp-server.local');
    expect(result).toEqual({ ok: true, scheme: 'https', host: 'erp-server.local' });
  });

  it('accepts a bare hostname without a TLD', () => {
    const result = normalizeServerInput('erp-server');
    expect(result).toEqual({ ok: true, scheme: 'http', host: 'erp-server' });
  });

  it('trims surrounding whitespace', () => {
    const result = normalizeServerInput('  192.168.1.50  ');
    expect(result).toEqual({ ok: true, scheme: 'http', host: '192.168.1.50' });
  });

  it('rejects empty input', () => {
    const result = normalizeServerInput('   ');
    expect(result.ok).toBe(false);
  });

  it('rejects a javascript: scheme', () => {
    const result = normalizeServerInput('javascript:alert(1)');
    expect(result.ok).toBe(false);
  });

  it('rejects a file: scheme', () => {
    const result = normalizeServerInput('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects a data: scheme', () => {
    const result = normalizeServerInput('data:text/html,<script>alert(1)</script>');
    expect(result.ok).toBe(false);
  });

  it('rejects an ftp: scheme', () => {
    const result = normalizeServerInput('ftp://192.168.1.50');
    expect(result.ok).toBe(false);
  });

  it('rejects embedded username/password', () => {
    const result = normalizeServerInput('http://user:pass@192.168.1.50');
    expect(result.ok).toBe(false);
  });

  it('rejects a path', () => {
    const result = normalizeServerInput('http://192.168.1.50/path');
    expect(result.ok).toBe(false);
  });

  it('accepts a bare trailing slash (normalizes to root, not a real path)', () => {
    const result = normalizeServerInput('http://192.168.1.50/');
    expect(result).toEqual({ ok: true, scheme: 'http', host: '192.168.1.50' });
  });

  it('rejects a query string', () => {
    const result = normalizeServerInput('http://192.168.1.50?x=1');
    expect(result.ok).toBe(false);
  });

  it('rejects a fragment', () => {
    const result = normalizeServerInput('http://192.168.1.50#frag');
    expect(result.ok).toBe(false);
  });

  it('rejects an explicit port', () => {
    const result = normalizeServerInput('192.168.1.50:8080');
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed URL', () => {
    const result = normalizeServerInput('http://');
    expect(result.ok).toBe(false);
  });

  it('lowercases the resulting host', () => {
    const result = normalizeServerInput('ERP-SERVER.LOCAL');
    expect(result).toEqual({ ok: true, scheme: 'http', host: 'erp-server.local' });
  });
});

describe('buildConfig', () => {
  it('builds a full config with default ports from normalized input', () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    expect(config).toEqual({
      version: 1,
      scheme: 'http',
      host: '192.168.1.50',
      ports: { gestion: 3000, api: 3001, facturacion: 3002 },
    });
  });

  it('uses DEFAULT_PORTS as the single source of default port values', () => {
    const config = buildConfig({ scheme: 'https', host: 'erp-server.local' });
    expect(config.ports).toEqual(DEFAULT_PORTS);
  });
});

describe('isValidStoredConfig', () => {
  const valid: DesktopConfig = {
    version: 1,
    scheme: 'http',
    host: '192.168.1.50',
    ports: { gestion: 3000, api: 3001, facturacion: 3002 },
  };

  it('accepts a well-formed config', () => {
    expect(isValidStoredConfig(valid)).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidStoredConfig(null)).toBe(false);
  });

  it('rejects a wrong version', () => {
    expect(isValidStoredConfig({ ...valid, version: 2 })).toBe(false);
  });

  it('rejects an invalid scheme', () => {
    expect(isValidStoredConfig({ ...valid, scheme: 'ftp' })).toBe(false);
  });

  it('rejects a missing host', () => {
    const rest = { version: valid.version, scheme: valid.scheme, ports: valid.ports };
    expect(isValidStoredConfig(rest)).toBe(false);
  });

  it('rejects malformed ports', () => {
    expect(isValidStoredConfig({ ...valid, ports: { gestion: 'x', api: 3001, facturacion: 3002 } })).toBe(
      false,
    );
  });

  it('rejects a bare string', () => {
    expect(isValidStoredConfig('192.168.1.50')).toBe(false);
  });
});

describe('saveConfig / loadConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-desktop-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('round-trips a saved config', async () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    await saveConfig(dir, config);
    const loaded = await loadConfig(dir);
    expect(loaded).toEqual(config);
  });

  it('returns null when no config file exists yet (first run)', async () => {
    const loaded = await loadConfig(dir);
    expect(loaded).toBeNull();
  });

  it('returns null for a corrupt/malformed config file rather than throwing', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'server-config.json'), '{ not valid json', 'utf-8');
    const loaded = await loadConfig(dir);
    expect(loaded).toBeNull();
  });

  it('leaves no leftover temp files after a save', async () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    await saveConfig(dir, config);
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['server-config.json']);
  });

  it('overwrites a previously saved config', async () => {
    await saveConfig(dir, buildConfig({ scheme: 'http', host: '192.168.1.50' }));
    await saveConfig(dir, buildConfig({ scheme: 'https', host: 'erp-server.local' }));
    const loaded = await loadConfig(dir);
    expect(loaded?.host).toBe('erp-server.local');
    expect(loaded?.scheme).toBe('https');
  });
});
