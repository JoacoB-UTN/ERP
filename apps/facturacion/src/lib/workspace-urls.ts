import { DEFAULT_RUNTIME_PORTS, getBrowserOrigin, resolveServiceUrl } from '@erp/shared';

/**
 * Gestión's own origin — used only by the workspace switcher (see
 * docs/desktop-ui-direction.md). Resolved at runtime from the current
 * page's own host — see docs/desktop-lan-architecture.md's "Runtime LAN
 * addressing"; set `NEXT_PUBLIC_GESTION_URL` to override explicitly
 * (dev/test only).
 */
export const GESTION_URL = resolveServiceUrl({
  explicitOverride: process.env.NEXT_PUBLIC_GESTION_URL,
  port: DEFAULT_RUNTIME_PORTS.gestion,
  currentOrigin: getBrowserOrigin(),
});
