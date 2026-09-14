import { Injectable } from '@nestjs/common';
import type {
  CreateProductLineInput,
  UpdateProductLineInput,
  ProductLineDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { ProductLineNotFoundException } from './products.exceptions';
import { ProductLineAlreadyExistsException } from './product-lines.exceptions';
import type { ProductLine } from '../generated/prisma/client';

function toDto(b: ProductLine): ProductLineDto {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    active: b.active,
  };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * ProductLine master CRUD — `companyId + normalizedName` uniqueness (see
 * docs/products.md and schema.prisma's ProductLine model). Audited under its
 * own `entityType: 'ProductLine'`, same reasoning as ProductCategory. Reuses
 * products.read/create/update (no dedicated permission).
 */
@Injectable()
export class ProductLinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string): Promise<ProductLineDto[]> {
    const rows = await this.prisma.productLine.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    ctx: RequestContext,
    input: CreateProductLineInput,
  ): Promise<ProductLineDto> {
    const normalizedName = normalize(input.name);
    const conflict = await this.prisma.productLine.findUnique({
      where: {
        companyId_normalizedName: { companyId: ctx.companyId, normalizedName },
      },
    });
    if (conflict) throw new ProductLineAlreadyExistsException();

    const created = await this.prisma.$transaction(async (tx) => {
      const line = await tx.productLine.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          name: input.name,
          normalizedName,
          description: input.description || null,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'ProductLine',
          entityId: line.id,
          after: { name: line.name },
        },
        tx,
      );
      return line;
    });
    return toDto(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateProductLineInput,
  ): Promise<ProductLineDto> {
    const existing = await this.prisma.productLine.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new ProductLineNotFoundException();

    let normalizedName: string | undefined;
    if (
      input.name !== undefined &&
      normalize(input.name) !== existing.normalizedName
    ) {
      normalizedName = normalize(input.name);
      const conflict = await this.prisma.productLine.findUnique({
        where: {
          companyId_normalizedName: {
            companyId: ctx.companyId,
            normalizedName,
          },
        },
      });
      if (conflict) throw new ProductLineAlreadyExistsException();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const line = await tx.productLine.update({
        where: { id },
        data: {
          ...(input.name !== undefined
            ? { name: input.name, normalizedName }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description || null }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'ProductLine',
          entityId: id,
          before: { name: existing.name, active: existing.active },
          after: { name: line.name, active: line.active },
        },
        tx,
      );
      return line;
    });
    return toDto(updated);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<ProductLineDto> {
    const existing = await this.prisma.productLine.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new ProductLineNotFoundException();
    if (!existing.active) return toDto(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const line = await tx.productLine.update({
        where: { id },
        data: { active: false },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'ProductLine',
          entityId: id,
          before: { active: true },
          after: { active: false },
        },
        tx,
      );
      return line;
    });
    return toDto(updated);
  }
}
