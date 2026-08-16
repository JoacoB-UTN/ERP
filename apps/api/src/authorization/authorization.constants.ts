/** Reflector metadata key set by @RequirePermissions() and read by PermissionGuard. */
export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Short TTL: correctness matters more than shaving a query off frequent
 * permission checks (see CLAUDE.md). Every mutation that can change a
 * user's effective permissions explicitly invalidates the relevant keys
 * (AuthorizationService.invalidate*), so this TTL is only a safety net,
 * not the primary invalidation mechanism.
 */
export const AUTHZ_CACHE_TTL_SECONDS = 30;

export function authzCacheKey(userId: string, companyId: string): string {
  return `authz:${userId}:${companyId}`;
}
