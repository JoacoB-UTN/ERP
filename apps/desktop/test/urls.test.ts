import { describe, it, expect } from 'vitest';
import { buildConfig } from '../src/config';
import {
  allowedWorkspaceOrigins,
  apiHealthUrl,
  apiUrl,
  facturacionUrl,
  gestionUrl,
  workspaceUrl,
} from '../src/urls';

describe('URL derivation', () => {
  it('derives Gestión/API/Facturación URLs for a LAN IP host', () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    expect(gestionUrl(config)).toBe('http://192.168.1.50:3000');
    expect(apiUrl(config)).toBe('http://192.168.1.50:3001');
    expect(apiHealthUrl(config)).toBe('http://192.168.1.50:3001/api/v1/health');
    expect(facturacionUrl(config)).toBe('http://192.168.1.50:3002');
  });

  it('derives URLs for 127.0.0.1 distinctly from localhost — no rebuild, just a different config', () => {
    const localhost = buildConfig({ scheme: 'http', host: 'localhost' });
    const loopbackIp = buildConfig({ scheme: 'http', host: '127.0.0.1' });
    expect(gestionUrl(localhost)).toBe('http://localhost:3000');
    expect(gestionUrl(loopbackIp)).toBe('http://127.0.0.1:3000');
    expect(apiUrl(localhost)).toBe('http://localhost:3001');
    expect(apiUrl(loopbackIp)).toBe('http://127.0.0.1:3001');
  });

  it('preserves https for a .local hostname', () => {
    const config = buildConfig({ scheme: 'https', host: 'erp-servidor.local' });
    expect(gestionUrl(config)).toBe('https://erp-servidor.local:3000');
    expect(facturacionUrl(config)).toBe('https://erp-servidor.local:3002');
  });

  it('workspaceUrl resolves by name to the same value as the dedicated function', () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    expect(workspaceUrl(config, 'gestion')).toBe(gestionUrl(config));
    expect(workspaceUrl(config, 'facturacion')).toBe(facturacionUrl(config));
  });

  it('allowedWorkspaceOrigins lists exactly the two workspace origins, never the API origin', () => {
    const config = buildConfig({ scheme: 'http', host: '192.168.1.50' });
    const origins = allowedWorkspaceOrigins(config);
    expect(origins).toEqual(['http://192.168.1.50:3000', 'http://192.168.1.50:3002']);
    expect(origins).not.toContain('http://192.168.1.50:3001');
  });
});
