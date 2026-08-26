import { describe, it, expect } from 'vitest';
import { DEFAULT_RUNTIME_PORTS, resolveServiceUrl } from '@erp/shared';

/**
 * Proves the runtime-host resolution logic that fixes the historical
 * build-time `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_GESTION_URL`/
 * `NEXT_PUBLIC_FACTURACION_URL` assumption — see
 * docs/desktop-lan-architecture.md's "Runtime LAN addressing". The exact
 * same built bundle must resolve differently depending on which host the
 * page was actually loaded from, with zero rebuild — this is the central
 * acceptance criterion for the Electron thin client (Prompt #20).
 */
describe('resolveServiceUrl', () => {
  it('derives the API origin from a page loaded on localhost', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'http:', hostname: 'localhost' },
    });
    expect(url).toBe('http://localhost:3001/api/v1');
  });

  it('derives the API origin from a page loaded on 127.0.0.1 — no rebuild needed vs. localhost', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'http:', hostname: '127.0.0.1' },
    });
    expect(url).toBe('http://127.0.0.1:3001/api/v1');
  });

  it('derives the API origin from a page loaded on a real LAN IP', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'http:', hostname: '192.168.1.50' },
    });
    expect(url).toBe('http://192.168.1.50:3001/api/v1');
  });

  it('derives the API origin from a .local LAN hostname, preserving https', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'https:', hostname: 'erp-servidor.local' },
    });
    expect(url).toBe('https://erp-servidor.local:3001/api/v1');
  });

  it('derives the sibling Facturación origin (no path) from the same page host', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.facturacion,
      currentOrigin: { protocol: 'http:', hostname: '127.0.0.1' },
    });
    expect(url).toBe('http://127.0.0.1:3002');
  });

  it('derives the sibling Gestión origin from a LAN IP host', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.gestion,
      currentOrigin: { protocol: 'http:', hostname: '192.168.1.50' },
    });
    expect(url).toBe('http://192.168.1.50:3000');
  });

  it('an explicit override wins outright over the current page host', () => {
    const url = resolveServiceUrl({
      explicitOverride: 'http://api.example.test:9999/api/v1',
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'http:', hostname: '192.168.1.50' },
    });
    expect(url).toBe('http://api.example.test:9999/api/v1');
  });

  it('an empty-string override is treated as unset, not as a literal empty base URL', () => {
    const url = resolveServiceUrl({
      explicitOverride: '',
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: { protocol: 'http:', hostname: '127.0.0.1' },
    });
    expect(url).toBe('http://127.0.0.1:3001/api/v1');
  });

  it('falls back to localhost when there is no current origin (SSR/build-time) and no override', () => {
    const url = resolveServiceUrl({
      port: DEFAULT_RUNTIME_PORTS.api,
      path: '/api/v1',
      currentOrigin: null,
    });
    expect(url).toBe('http://localhost:3001/api/v1');
  });
});
