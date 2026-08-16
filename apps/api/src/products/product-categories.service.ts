import { Injectable } from '@nestjs/common';
import type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  ProductCategoryDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import {
  ProductCategoryNotFoundException,
  ProductCategoryCycleException,
} from './products.exceptions';
import type { ProductCategory } from '../generated/prisma/client';

function toDto(c: ProductCategory): ProductCategoryDto {
  return {
    id: c.id,
    parentId: c.parentId,
    code: c.code,
    name: c.name,
    description: c.description,
    active: c.active,
  };
}

/**
 * Hierarchical category master CRUD — audited under its own `entityType:
 * 'ProductCategory'` (unlike CustomerCategory, which isn't separately
 * audited) because categories here have a real dedicated management
 * screen and cycle-prevention logic worth tracking independently of any
 * one product — see docs/products.md. Reuses products.read/create/update
 * (no dedicated products.catalog.manage permission), same
 * anti-fragmentation decision as CustomerCategory.
 */
@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string): Promise<ProductCategoryDto[]> {
    const rows = await this.prisma.productCategory.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    ctx: RequestContext,
    input: CreateProductCategoryInput,
  ): Promise<ProductCategoryDto> {
    if (input.parentId)
      await this.assertBelongsToCompany(ctx.companyId, input.parentId);

    const created = await this.prisma.$transaction(async (tx) => {
      const category = await tx.productCategory.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          parentId: input.parentId ?? null,
          code: input.code || null,
          name: input.name,
          description: input.description || null,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'ProductCategory',
          entityId: category.id,
          after: { name: category.name, parentId: category.parentId },
        },
        tx,
      );
      return category;
    });
    return toDto(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateProductCategoryInput,
  ): Promise<ProductCategoryDto> {
    const existing = await this.prisma.productCategory.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new ProductCategoryNotFoundException();

    if (input.parentId !== undefined && input.parentId !== null) {
      await this.assertNoCycle(ctx.companyId, id, input.parentId);
    }

    const data: {
      parentId?: string | null;
      code?: string | null;
      name?: string;
      description?: string | null;
      active?: boolean;
    } = {};
    if (input.parentId !== undefined) data.parentId = input.parentId;
    if (input.code !== undefined) data.code = input.code || null;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined)
      data.description = input.description || null;
    if (input.active !== undefined) data.active = input.active;

    const updated = await this.prisma.$transaction(async (tx) => {
      const category = await tx.productCategory.update({ where: { id }, data });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'ProductCategory',
          entityId: id,
          before: {
            name: existing.name,
            parentId: existing.parentId,
            active: existing.active,
          },
          after: {
            name: category.name,
            parentId: category.parentId,
            active: category.active,
          },
        },
        tx,
      );
      return category;
    });
    return toDto(updated);
  }

  async deactivate(
    ctx: RequestContext,
    id: string,
  ): Promise<ProductCategoryDto> {
    const existing = await this.prisma.productCategory.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new ProductCategoryNotFoundException();
    if (!existing.active) return toDto(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const category = await tx.productCategory.update({
        where: { id },
        data: { active: false },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'ProductCategory',
          entityId: id,
          before: { active: true },
          after: { active: false },
        },
        tx,
      );
      return category;
    });
    return toDto(updated);
  }

  private async assertBelongsToCompany(
    companyId: string,
    id: string,
  ): Promise<void> {
    const found = await this.prisma.productCategory.findFirst({
      where: { id, companyId },
    });
    if (!found) throw new ProductCategoryNotFoundException();
  }

  /** Walks the proposed new parent's ancestor chain — rejects a direct self-parent and any indirect cycle (A -> B -> C -> A). See docs/products.md. */
  private async assertNoCycle(
    companyId: string,
    categoryId: string,
    newParentId: string,
  ): Promise<void> {
    if (newParentId === categoryId) throw new ProductCategoryCycleException();
    let current: string | null = newParentId;
    const seen = new Set<string>();
    while (current) {
      if (current === categoryId) throw new ProductCategoryCycleException();
      if (seen.has(current)) return; // already-validated cycle-free chain reached
      seen.add(current);
      const row: { parentId: string | null } | null =
        await this.prisma.productCategory.findFirst({
          where: { id: current, companyId },
          select: { parentId: true },
        });
      if (!row) throw new ProductCategoryNotFoundException();
      current = row.parentId;
    }
  }
}
