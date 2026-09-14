import { Injectable } from '@nestjs/common';
import type { CompanyUserSummary, CreateUserInput } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { PasswordService } from '../auth/password.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { PermissionDeniedException } from '../authorization/authorization.exceptions';
import {
  EmailAlreadyRegisteredException,
  RoleNotFoundException,
} from './administration.exceptions';

/**
 * Creating users for the active company.
 *
 * Kept out of RolesService: that class is about what a user may do, this is
 * about the account existing at all. They meet only at the optional initial
 * role assignment, which is done here inline rather than by calling
 * assignRole() — that method re-checks company membership and audits one
 * ASSIGN per role, which is right for a later change to a live user but
 * wrong for the moment of creation, where the roles are part of the CREATE.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly authorizationService: AuthorizationService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    ctx: RequestContext,
    input: CreateUserInput,
  ): Promise<CompanyUserSummary> {
    // `email` is globally unique on User, so an address already in use
    // cannot become a second account. It is deliberately NOT silently
    // attached to this company either: that would let any company
    // administrator pull a stranger's existing account into their own
    // company without that person ever agreeing to it.
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new EmailAlreadyRegisteredException();
    }

    // Validated before the transaction opens, and scoped to the active
    // company: a role id from another company must read as "no such role"
    // (see RoleNotFoundException), never as "not yours".
    const roleIds = [...new Set(input.roleIds)];
    if (roleIds.length > 0) {
      // The route requires `administration.users.create`; handing out roles
      // additionally requires `administration.roles.assign`. Without this
      // check, "may onboard people" would quietly imply "may grant any
      // permission in the company", since a brand-new user with the
      // Administrador role is the same escalation as assigning it to an
      // existing one. Checked here rather than on the route because it
      // depends on the body: creating a user with no roles must stay open
      // to someone who only has users.create.
      const mayAssign = await this.authorizationService.hasAllPermissions(
        ctx.userId,
        ctx.companyId,
        ['administration.roles.assign'],
      );
      if (!mayAssign) {
        throw new PermissionDeniedException();
      }

      const roles = await this.prisma.role.findMany({
        where: { id: { in: roleIds }, companyId: ctx.companyId, active: true },
        select: { id: true },
      });
      if (roles.length !== roleIds.length) {
        throw new RoleNotFoundException();
      }
    }

    const passwordHash = await this.passwordService.hash(input.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          passwordHash,
          // ACTIVE, not PENDING: PENDING exists for an account waiting on an
          // email confirmation this product has no way to send, and login
          // rejects anything but ACTIVE. Creating a user who cannot sign in
          // and cannot be activated would be a dead end.
          status: 'ACTIVE',
        },
      });

      await tx.userCompany.create({
        data: {
          userId: user.id,
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
        },
      });

      if (roleIds.length > 0) {
        await tx.userRole.createMany({
          data: roleIds.map((roleId) => ({
            userId: user.id,
            roleId,
            companyId: ctx.companyId,
          })),
        });
      }

      // One CREATE describing the account, not a CREATE plus N ASSIGNs:
      // the roles chosen in the form are part of what was created (see
      // CLAUDE.md — audit records domain actions, not row writes). The
      // hash never enters the record.
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'User',
          entityId: user.id,
          after: {
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            status: user.status,
          },
          metadata: { companyId: ctx.companyId, roleIds },
        },
        tx,
      );

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          userRoles: {
            where: { companyId: ctx.companyId },
            include: { role: true },
          },
        },
      });
    });

    await this.authorizationService.invalidateUserCompany(
      created.id,
      ctx.companyId,
    );

    return {
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      email: created.email,
      status: created.status,
      roles: created.userRoles.map((ur) => ({
        id: ur.role.id,
        name: ur.role.name,
      })),
    };
  }
}
