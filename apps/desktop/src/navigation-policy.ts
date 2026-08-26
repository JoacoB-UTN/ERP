import type { DesktopConfig } from './config';
import { allowedWorkspaceOrigins } from './urls';

/**
 * SECURITY CRITICAL — see docs/desktop-lan-architecture.md's "Security
 * model". A workspace `BrowserWindow` loads remote, untrusted server
 * content; this is the single choke point deciding whether a top-level
 * navigation or `window.open()` target is allowed to proceed. Default
 * deny: anything not exactly one of the configured server's own
 * Gestión/Facturación origins is rejected, regardless of scheme trickery
 * (`javascript:`, `file:`, `data:`), a different host, or a different
 * port on the same host. Reconfiguring the server (a new host) changes
 * what's allowed — nothing here is a static allow-list baked at build
 * time.
 */
export function isAllowedNavigationTarget(config: DesktopConfig, targetUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return allowedWorkspaceOrigins(config).includes(parsed.origin);
}
