import { Injectable } from '@nestjs/common';
import type {
  CreateUnitOfMeasureInput,
  UpdateUnitOfMeasureInput,
  UnitOfMeasureDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import type { RequestContext } from '../company-context/types';
import { UnitNotFoundException } from './products.exceptions';
import { UnitCodeAlreadyExistsException } from './units.exceptions';
import type { UnitOfMeasure } from '../generated/prisma/client';

function toDto(u: UnitOfMeasure): UnitOfMeasureDto {
  return {
    id: u.id,
    code: u.code,
    name: u.name,
    symbol: u.symbol,
    decimalPlaces: u.decimalPlaces,
    active: u.active,
  };
}

/**
 * Unit-of-measure master CRUD — always company-scoped (no nullable
 * companyId "system unit" rows; see schema.prisma's UnitOfMeasure doc
 * comment and docs/products.md). Not audited: config-only master data,
 * not in the task's "at minimum" audit list. Deactivating a unit never
 * invalidates existing Product references — see docs/products.md.
 */
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string): Promise<UnitOfMeasureDto[]> {
    const rows = await this.prisma.unitOfMeasure.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    ctx: RequestContext,
    input: CreateUnitOfMeasureInput,
  ): Promise<UnitOfMeasureDto> {
    const conflict = await this.prisma.unitOfMeasure.findUnique({
      where: { companyId_code: { companyId: ctx.companyId, code: input.code } },
    });
    if (conflict) throw new UnitCodeAlreadyExistsException();

    const created = await this.prisma.unitOfMeasure.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        code: input.code,
        name: input.name,
        symbol: input.symbol,
        decimalPlaces: input.decimalPlaces,
      },
    });
    return toDto(created);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateUnitOfMeasureInput,
  ): Promise<UnitOfMeasureDto> {
    const existing = await this.prisma.unitOfMeasure.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new UnitNotFoundException();

    if (input.code !== undefined && input.code !== existing.code) {
      const conflict = await this.prisma.unitOfMeasure.findUnique({
        where: {
          companyId_code: { companyId: ctx.companyId, code: input.code },
        },
      });
      if (conflict) throw new UnitCodeAlreadyExistsException();
    }

    const updated = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
        ...(input.decimalPlaces !== undefined
          ? { decimalPlaces: input.decimalPlaces }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    return toDto(updated);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<UnitOfMeasureDto> {
    const existing = await this.prisma.unitOfMeasure.findFirst({
      where: { id, companyId: ctx.companyId },
    });
    if (!existing) throw new UnitNotFoundException();
    if (!existing.active) return toDto(existing);
    const updated = await this.prisma.unitOfMeasure.update({
      where: { id },
      data: { active: false },
    });
    return toDto(updated);
  }
}
