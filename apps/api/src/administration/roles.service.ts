import { Injectable } from '@nestjs/common';
import type {
  CreateRoleInput,
  UpdateRoleInput,
  RoleSummary,
  CompanyUserSummary,
} from '@erp/shared';
import { PERMISSION_CATALOG } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import {
  RoleNotFoundException,
  SystemRoleProtectedException,
  UnknownPermissionCodeException,
  UserNotCompanyMemberException,
  DuplicateRoleAssignmentException,
  LastSecurityAdminException,
} from './administration.exceptions';
import type {
  Role,
  RolePermission,
  Permission,
} from '../generated/prisma/client';

/**
 * The permission that lets a user manage roles/assignments at all. Used
 * only for the "don't orphan security administration" guard below — see
 * docs/authorization.md for the exact scope of this protection (it covers
 * direct assignment removal, role disable, and permission-set replacement;
 * it does not attempt to reason about every possible mutation path).
 */
const SECURITY_ADMIN_PERMISSION = 'administration.roles.assign';

type RoleWithPermissions = Role & {
  rolePermissions: (RolePermission & { permission: Permission })[];
};

function toRoleSummary(role: RoleWithPermissions): RoleSummary {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    active: role.active,
    permissionCodes: role.rolePermissions.map((rp) => rp.permission.code),
  };
}

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string): Promise<RoleSummary[]> {
    const roles = await this.prisma.role.findMany({
      where: { companyId },
      include: { rolePermissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map(toRoleSummary);
  }

  async getById(companyId: string, roleId: string): Promise<RoleSummary> {
    const role = await this.findScopedOrThrow(companyId, roleId);
    return toRoleSummary(role);
  }

  async create(
    ctx: RequestContext,
    input: CreateRoleInput,
  ): Promise<RoleSummary> {
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
        },
        include: { rolePermissions: { include: { permission: true } } },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Role',
          entityId: created.id,
          after: {
            name: created.name,
            description: created.description,
            active: created.active,
            isSystem: created.isSystem,
          },
        },
        tx,
      );
      return created;
    });
    return toRoleSummary(role);
  }

  async update(
    ctx: RequestContext,
    roleId: string,
    input: UpdateRoleInput,
  ): Promise<RoleSummary> {
    const role = await this.findScopedOrThrow(ctx.companyId, roleId);

    if (
      role.isSystem &&
      (input.name !== undefined || input.active !== undefined)
    ) {
      throw new SystemRoleProtectedException();
    }

    if (input.active === false && role.active) {
      await this.assertNotOrphaningSecurityAdministration({
        companyId: ctx.companyId,
        excludeRoleId: role.id,
        role,
      });
    }

    const before = {
      name: role.name,
      description: role.description,
      active: role.active,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.role.update({
        where: { id: role.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
        include: { rolePermissions: { include: { permission: true } } },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'Role',
          entityId: role.id,
          before,
          after: { name: u.name, description: u.description, active: u.active },
        },
        tx,
      );
      return u;
    });

    await this.authorizationService.invalidateRole(role.id, ctx.companyId);
    return toRoleSummary(updated);
  }

  /**
   * DELETE /administration/roles/:id is implemented as a soft-disable
   * (active: false), never a hard delete — a role currently assigned to
   * users must not silently vanish out from under them, and system roles
   * must never be removable at all. See docs/authorization.md.
   */
  async remove(ctx: RequestContext, roleId: string): Promise<RoleSummary> {
    const role = await this.findScopedOrThrow(ctx.companyId, roleId);
    if (role.isSystem) {
      throw new SystemRoleProtectedException();
    }
    if (role.active) {
      await this.assertNotOrphaningSecurityAdministration({
        companyId: ctx.companyId,
        excludeRoleId: role.id,
        role,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.role.update({
        where: { id: role.id },
        data: { active: false },
        include: { rolePermissions: { include: { permission: true } } },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Role',
          entityId: role.id,
          before: { active: true },
          after: { active: false },
        },
        tx,
      );
      return u;
    });

    await this.authorizationService.invalidateRole(role.id, ctx.companyId);
    return toRoleSummary(updated);
  }

  listPermissionCatalog() {
    return PERMISSION_CATALOG;
  }

  async replacePermissions(
    ctx: RequestContext,
    roleId: string,
    permissionCodes: string[],
  ): Promise<RoleSummary> {
    const role = await this.findScopedOrThrow(ctx.companyId, roleId);

    const uniqueCodes = [...new Set(permissionCodes)];
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: uniqueCodes } },
    });
    if (permissions.length !== uniqueCodes.length) {
      const known = new Set(permissions.map((p) => p.code));
      const unknown = uniqueCodes.filter((c) => !known.has(c));
      throw new UnknownPermissionCodeException(unknown);
    }

    const hadSecurityAdmin = role.rolePermissions.some(
      (rp) => rp.permission.code === SECURITY_ADMIN_PERMISSION,
    );
    const willHaveSecurityAdmin = uniqueCodes.includes(
      SECURITY_ADMIN_PERMISSION,
    );
    if (role.active && hadSecurityAdmin && !willHaveSecurityAdmin) {
      await this.assertNotOrphaningSecurityAdministration({
        companyId: ctx.companyId,
        excludeRoleId: role.id,
        role,
      });
    }

    // One meaningful event per save, not one per row touched (see
    // CLAUDE.md — no automatic per-row ORM auditing). A save that changes
    // nothing (identical permission set) is not a business fact worth
    // recording.
    const beforeCodes = role.rolePermissions.map((rp) => rp.permission.code);
    const beforeSet = new Set(beforeCodes);
    const afterSet = new Set(uniqueCodes);
    const permissionsAdded = uniqueCodes.filter((c) => !beforeSet.has(c));
    const permissionsRemoved = beforeCodes.filter((c) => !afterSet.has(c));

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
        });
      }
      if (permissionsAdded.length > 0 || permissionsRemoved.length > 0) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'PERMISSIONS_CHANGE',
            entityType: 'Role',
            entityId: role.id,
            metadata: { permissionsAdded, permissionsRemoved },
          },
          tx,
        );
      }
      return tx.role.findUniqueOrThrow({
        where: { id: role.id },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });

    await this.authorizationService.invalidateRole(role.id, ctx.companyId);
    return toRoleSummary(updated);
  }

  async listUserRoles(
    companyId: string,
    userId: string,
  ): Promise<RoleSummary[]> {
    const assignments = await this.prisma.userRole.findMany({
      where: { userId, companyId },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });
    return assignments.map((a) => toRoleSummary(a.role));
  }

  async assignRole(
    ctx: RequestContext,
    targetUserId: string,
    roleId: string,
  ): Promise<RoleSummary> {
    await this.assertActiveCompanyMember(ctx.companyId, targetUserId);
    const role = await this.findScopedOrThrow(ctx.companyId, roleId, {
      requireActive: true,
    });

    const existing = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: targetUserId,
          roleId: role.id,
          companyId: ctx.companyId,
        },
      },
    });
    if (existing) {
      throw new DuplicateRoleAssignmentException();
    }

    await this.prisma.$transaction(async (tx) => {
      const created = await tx.userRole.create({
        data: {
          userId: targetUserId,
          roleId: role.id,
          companyId: ctx.companyId,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ASSIGN',
          entityType: 'UserRole',
          entityId: created.id,
          metadata: {
            targetUserId,
            roleId: role.id,
            roleName: role.name,
            companyId: ctx.companyId,
          },
        },
        tx,
      );
    });

    await this.authorizationService.invalidateUserCompany(
      targetUserId,
      ctx.companyId,
    );
    return toRoleSummary(role);
  }

  async removeRole(
    ctx: RequestContext,
    targetUserId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.findScopedOrThrow(ctx.companyId, roleId);
    const assignment = await this.prisma.userRole.findUnique({
      where: {
        userId_roleId_companyId: {
          userId: targetUserId,
          roleId: role.id,
          companyId: ctx.companyId,
        },
      },
    });
    if (!assignment) {
      return; // idempotent — matches the project's convention for revocation-style operations
    }

    const grantsSecurityAdmin = role.rolePermissions.some(
      (rp) => rp.permission.code === SECURITY_ADMIN_PERMISSION,
    );
    if (role.active && grantsSecurityAdmin) {
      await this.assertNotOrphaningSecurityAdministration({
        companyId: ctx.companyId,
        excludeAssignmentId: assignment.id,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRole.delete({ where: { id: assignment.id } });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UNASSIGN',
          entityType: 'UserRole',
          entityId: assignment.id,
          metadata: {
            targetUserId,
            roleId: role.id,
            roleName: role.name,
            companyId: ctx.companyId,
          },
        },
        tx,
      );
    });

    await this.authorizationService.invalidateUserCompany(
      targetUserId,
      ctx.companyId,
    );
  }

  async listCompanyUsers(companyId: string): Promise<CompanyUserSummary[]> {
    const memberships = await this.prisma.userCompany.findMany({
      where: { companyId, active: true },
      include: {
        user: {
          include: {
            userRoles: {
              where: { companyId },
              include: { role: true },
            },
          },
        },
      },
      orderBy: { user: { firstName: 'asc' } },
    });

    return memberships.map((m) => ({
      id: m.user.id,
      firstName: m.user.firstName,
      lastName: m.user.lastName,
      email: m.user.email,
      status: m.user.status,
      roles: m.user.userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      })),
    }));
  }

  private async findScopedOrThrow(
    companyId: string,
    roleId: string,
    options?: { requireActive?: boolean },
  ): Promise<RoleWithPermissions> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, companyId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!role || (options?.requireActive && !role.active)) {
      throw new RoleNotFoundException();
    }
    return role;
  }

  private async assertActiveCompanyMember(
    companyId: string,
    userId: string,
  ): Promise<void> {
    const membership = await this.prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership || !membership.active) {
      throw new UserNotCompanyMemberException();
    }
  }

  /**
   * Refuses an action if, after excluding the given assignment/role, no
   * user in the company would still hold SECURITY_ADMIN_PERMISSION via an
   * active role. Scope: called from role disable, role-permission
   * replacement (only when it would drop the permission), and direct
   * assignment removal — see class-level doc comment.
   */
  private async assertNotOrphaningSecurityAdministration(params: {
    companyId: string;
    excludeAssignmentId?: string;
    excludeRoleId?: string;
    /** Skip the query entirely if the role in question never granted the permission — cheap short-circuit. */
    role?: RoleWithPermissions;
  }): Promise<void> {
    if (
      params.role &&
      !params.role.rolePermissions.some(
        (rp) => rp.permission.code === SECURITY_ADMIN_PERMISSION,
      )
    ) {
      return;
    }

    const remaining = await this.prisma.userRole.findMany({
      where: {
        companyId: params.companyId,
        ...(params.excludeAssignmentId
          ? { NOT: { id: params.excludeAssignmentId } }
          : {}),
        ...(params.excludeRoleId
          ? { roleId: { not: params.excludeRoleId } }
          : {}),
        role: {
          active: true,
          rolePermissions: {
            some: { permission: { code: SECURITY_ADMIN_PERMISSION } },
          },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    if (remaining.length === 0) {
      throw new LastSecurityAdminException();
    }
  }
}
