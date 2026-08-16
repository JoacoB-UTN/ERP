import { Injectable } from '@nestjs/common';
import type { CreateBrandInput, UpdateBrandInput, BrandDto } from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { BrandNotFoundException } from './products.exceptions';
import { BrandAlreadyExistsException } from './brands.exceptions';
import type { Brand } from '../generated/prisma/client';

function toDto(b: Brand): BrandDto {
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
 * Brand master CRUD — `companyId + normalizedName` uniqueness (see
 * docs/products.md and schema.prisma's Brand model). Audited under its
 * own `entityType: 'Brand'`, same reasoning as ProductCategory. Reuses
 * products.read/create/update (no dedicated permission).
 */
@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string): Promise<BrandDto[]> {
    const rows = await this.prisma.brand.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    ctx: RequestContext,
    input: CreateBrandInput,
  ): Promise<BrandDto> {
    const normalizedName = normalize(input.name);
    const conflict = await this.prisma.brand.findUnique({
      where: {
        companyId_normalizedName: { companyId: ctx.companyId, normalizedName },
      },
    });
    if (conflict) throw new BrandAlreadyExistsException();

    const created = await this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.create({
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
          entityType: 'Brand',
          entityId: brand.id,
          after: { name: brand.name },
        },
        tx,
      );
      return brand;
    });
    return toDto(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateBrandInput,
  ): Promise<BrandDto> {
    const existing = await this.prisma.brand.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new BrandNotFoundException();

    let normalizedName: string | undefined;
    if (
      input.name !== undefined &&
      normalize(input.name) !== existing.normalizedName
    ) {
      normalizedName = normalize(input.name);
      const conflict = await this.prisma.brand.findUnique({
        where: {
          companyId_normalizedName: {
            companyId: ctx.companyId,
            normalizedName,
          },
        },
      });
      if (conflict) throw new BrandAlreadyExistsException();
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.update({
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
          entityType: 'Brand',
          entityId: id,
          before: { name: existing.name, active: existing.active },
          after: { name: brand.name, active: brand.active },
        },
        tx,
      );
      return brand;
    });
    return toDto(updated);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<BrandDto> {
    const existing = await this.prisma.brand.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new BrandNotFoundException();
    if (!existing.active) return toDto(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const brand = await tx.brand.update({
        where: { id },
        data: { active: false },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Brand',
          entityId: id,
          before: { active: true },
          after: { active: false },
        },
        tx,
      );
      return brand;
    });
    return toDto(updated);
  }
}
