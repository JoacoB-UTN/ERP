import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/config';
import { isAllowedNavigationTarget } from '../src/navigation-policy';

describe('isAllowedNavigationTarget', () => {
  const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });

  it('allows navigation within the configured Gestión origin, any path/query', () => {
    expect(isAllowedNavigationTarget(config, 'http://192.168.1.50:3000/ventas')).toBe(true);
    expect(isAllowedNavigationTarget(config, 'http://192.168.1.50:3000/clientes/123?x=1')).toBe(true);
  });

  it('allows navigation within the configured Facturación origin', () => {
    expect(isAllowedNavigationTarget(config, 'http://192.168.1.50:3002/pos')).toBe(true);
  });

  it('rejects an unrelated external origin', () => {
    expect(isAllowedNavigationTarget(config, 'https://example.com')).toBe(false);
  });

  it('rejects a file: URL', () => {
    expect(isAllowedNavigationTarget(config, 'file:///etc/passwd')).toBe(false);
  });

  it('rejects a javascript: URL', () => {
    expect(isAllowedNavigationTarget(config, 'javascript:alert(1)')).toBe(false);
  });

  it('rejects a different host, even on an otherwise-matching port', () => {
    expect(isAllowedNavigationTarget(config, 'http://192.168.1.99:3000')).toBe(false);
  });

  it('rejects the API origin itself — it is never a navigable workspace', () => {
    expect(isAllowedNavigationTarget(config, 'http://192.168.1.50:3001/api/v1/health')).toBe(false);
  });

  it('rejects an unparsable target', () => {
    expect(isAllowedNavigationTarget(config, 'not a url')).toBe(false);
  });

  it('reflects a reconfigured host — the allow-list is not static', () => {
    const reconfigured = buildConfig({ scheme: 'http', host: '192.168.1.70' });
    expect(isAllowedNavigationTarget(reconfigured, 'http://192.168.1.50:3000')).toBe(false);
    expect(isAllowedNavigationTarget(reconfigured, 'http://192.168.1.70:3000')).toBe(true);
  });
});
