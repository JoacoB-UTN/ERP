import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  authzCacheKey,
  AUTHZ_CACHE_TTL_SECONDS,
} from './authorization.constants';

/**
 * The single place that answers "what may this user do in this company."
 * Never scattered across controllers — see CLAUDE.md ("every protected
 * company-scoped operation must explicitly declare its required
 * permissions") and docs/authorization.md.
 *
 * Effective permissions = union of active permissions from all active
 * roles assigned to the user for that exact company (no allow/deny
 * conflict resolution — see docs/authorization.md). Callers are always
 * expected to pass a userId/companyId that already came from a validated
 * RequestContext (see @CompanyScoped()) — this service does not re-check
 * UserCompany membership itself, since by the time it's reached the
 * guard chain has already guaranteed it (membership is the OUTER
 * boundary; this is the inner one).
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getUserPermissions(
    userId: string,
    companyId: string,
  ): Promise<string[]> {
    const key = authzCacheKey(userId, companyId);
    try {
      const cached = await this.redis.client.get(key);
      if (cached) {
        return JSON.parse(cached) as string[];
      }
    } catch (error) {
      // Redis being unavailable must never block authorization — just
      // recompute from Postgres. Correctness over cache convenience.
      this.logger.warn(`authz cache read failed: ${(error as Error).message}`);
    }

    const codes = await this.computeEffectivePermissions(userId, companyId);

    try {
      await this.redis.client.set(
        key,
        JSON.stringify(codes),
        'EX',
        AUTHZ_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(`authz cache write failed: ${(error as Error).message}`);
    }

    return codes;
  }

  private async computeEffectivePermissions(
    userId: string,
    companyId: string,
  ): Promise<string[]> {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId, companyId, role: { active: true } },
      select: {
        role: {
          select: {
            rolePermissions: {
              select: { permission: { select: { code: true } } },
            },
          },
        },
      },
    });

    const codes = new Set<string>();
    for (const assignment of assignments) {
      for (const rolePermission of assignment.role.rolePermissions) {
        codes.add(rolePermission.permission.code);
      }
    }
    return [...codes];
  }

  async hasAllPermissions(
    userId: string,
    companyId: string,
    required: string[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const effective = new Set(await this.getUserPermissions(userId, companyId));
    return required.every((code) => effective.has(code));
  }

  /** Call after any change to a user's role assignments in a company. */
  async invalidateUserCompany(
    userId: string,
    companyId: string,
  ): Promise<void> {
    await this.safeDel(authzCacheKey(userId, companyId));
  }

  /** Call after a role's permission set or active flag changes — invalidates every user currently assigned that role. */
  async invalidateRole(roleId: string, companyId: string): Promise<void> {
    const assignments = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await Promise.all(
      assignments.map((a) => this.invalidateUserCompany(a.userId, companyId)),
    );
  }

  private async safeDel(key: string): Promise<void> {
    try {
      await this.redis.client.del(key);
    } catch (error) {
      this.logger.warn(
        `authz cache invalidation failed: ${(error as Error).message}`,
      );
    }
  }
}
