import { Injectable } from '@nestjs/common';
import type {
  CreateCustomerCategoryInput,
  UpdateCustomerCategoryInput,
  CustomerCategoryDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import type { RequestContext } from '../company-context/types';
import {
  CustomerCategoryNotFoundException,
  CustomerCategoryAlreadyExistsException,
} from './customers.exceptions';
import type { CustomerCategory } from '../generated/prisma/client';

function toDto(c: CustomerCategory): CustomerCategoryDto {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    active: c.active,
  };
}

/**
 * Category master CRUD only — assigning/unassigning a category to a
 * specific customer goes through CustomersService (categoryIds on
 * create/update), which is where the meaningful audit event lives (see
 * docs/customers.md). No separate `customers.categories.manage`
 * permission — reuses customers.read/create/update, see CLAUDE.md's
 * anti-fragmentation guidance from the RBAC work.
 */
@Injectable()
export class CustomerCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string): Promise<CustomerCategoryDto[]> {
    const rows = await this.prisma.customerCategory.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    ctx: RequestContext,
    input: CreateCustomerCategoryInput,
  ): Promise<CustomerCategoryDto> {
    const conflict = await this.prisma.customerCategory.findUnique({
      where: { companyId_name: { companyId: ctx.companyId, name: input.name } },
    });
    if (conflict) throw new CustomerCategoryAlreadyExistsException();

    const created = await this.prisma.customerCategory.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        name: input.name,
        description: input.description || null,
      },
    });
    return toDto(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateCustomerCategoryInput,
  ): Promise<CustomerCategoryDto> {
    const existing = await this.prisma.customerCategory.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new CustomerCategoryNotFoundException();

    if (input.name !== undefined && input.name !== existing.name) {
      const conflict = await this.prisma.customerCategory.findUnique({
        where: {
          companyId_name: { companyId: ctx.companyId, name: input.name },
        },
      });
      if (conflict) throw new CustomerCategoryAlreadyExistsException();
    }

    const updated = await this.prisma.customerCategory.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined
          ? { description: input.description || null }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    return toDto(updated);
  }
}
