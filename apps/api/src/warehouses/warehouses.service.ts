import { Injectable } from '@nestjs/common';
import type {
  CreateWarehouseInput,
  UpdateWarehouseInput,
  WarehouseDto,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import {
  WarehouseNotFoundException,
  WarehouseCodeAlreadyExistsException,
  WarehouseInvalidBranchException,
  WarehouseHasStockException,
  WarehouseHasActiveReservationsException,
} from './warehouses.exceptions';
import type { Warehouse, Branch, Prisma } from '../generated/prisma/client';

type WarehouseWithBranch = Warehouse & { branch: Branch | null };

type AuditableWarehouseFields = Record<
  | 'name'
  | 'description'
  | 'branchId'
  | 'allowsSales'
  | 'allowsPurchases'
  | 'allowNegativeStock'
  | 'status',
  unknown
>;

function toDto(w: WarehouseWithBranch): WarehouseDto {
  return {
    id: w.id,
    branchId: w.branchId,
    branchName: w.branch?.name ?? null,
    code: w.code,
    name: w.name,
    description: w.description,
    allowsSales: w.allowsSales,
    allowsPurchases: w.allowsPurchases,
    allowNegativeStock: w.allowNegativeStock,
    status: w.status,
  };
}

function pickAuditFields(w: Warehouse): AuditableWarehouseFields {
  return {
    name: w.name,
    description: w.description,
    branchId: w.branchId,
    allowsSales: w.allowsSales,
    allowsPurchases: w.allowsPurchases,
    allowNegativeStock: w.allowNegativeStock,
    status: w.status,
  };
}

function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(before) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changedBefore[key] = before[key];
      changedAfter[key] = after[key];
    }
  }
  return { before: changedBefore, after: changedAfter };
}

const WAREHOUSE_INCLUDE = { branch: true } satisfies Prisma.WarehouseInclude;

/**
 * Warehouse master CRUD — see docs/inventory.md. Deactivation is blocked
 * while physical stock (InventoryBalance.onHand != 0) or active
 * reservations still reference the warehouse, so inventory can never be
 * silently hidden (see CLAUDE.md).
 */
@Injectable()
export class WarehousesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(companyId: string): Promise<WarehouseDto[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: { companyId },
      include: WAREHOUSE_INCLUDE,
      orderBy: { code: 'asc' },
    });
    return rows.map(toDto);
  }

  async getById(companyId: string, id: string): Promise<WarehouseDto> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, companyId },
      include: WAREHOUSE_INCLUDE,
    });
    if (!warehouse) throw new WarehouseNotFoundException();
    return toDto(warehouse);
  }

  async create(
    ctx: RequestContext,
    input: CreateWarehouseInput,
  ): Promise<WarehouseDto> {
    if (input.branchId)
      await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    const conflict = await this.prisma.warehouse.findUnique({
      where: { companyId_code: { companyId: ctx.companyId, code: input.code } },
    });
    if (conflict) throw new WarehouseCodeAlreadyExistsException();

    const created = await this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          branchId: input.branchId ?? null,
          code: input.code,
          name: input.name,
          description: input.description || null,
          allowsSales: input.allowsSales,
          allowsPurchases: input.allowsPurchases,
          allowNegativeStock: input.allowNegativeStock,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Warehouse',
          entityId: warehouse.id,
          after: {
            code: warehouse.code,
            name: warehouse.name,
            branchId: warehouse.branchId,
            allowsSales: warehouse.allowsSales,
            allowsPurchases: warehouse.allowsPurchases,
            allowNegativeStock: warehouse.allowNegativeStock,
          },
        },
        tx,
      );
      return warehouse;
    });
    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateWarehouseInput,
  ): Promise<WarehouseDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);

    if (input.branchId !== undefined && input.branchId !== null) {
      await this.assertBranchBelongsToCompany(ctx.companyId, input.branchId);
    }
    if (input.code !== undefined && input.code !== existing.code) {
      const conflict = await this.prisma.warehouse.findUnique({
        where: {
          companyId_code: { companyId: ctx.companyId, code: input.code },
        },
      });
      if (conflict) throw new WarehouseCodeAlreadyExistsException();
    }

    const beforeSnapshot = pickAuditFields(existing);

    const data: Prisma.WarehouseUncheckedUpdateInput = {
      updatedBy: ctx.userId,
    };
    if (input.branchId !== undefined) data.branchId = input.branchId;
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined)
      data.description = input.description || null;
    if (input.allowsSales !== undefined) data.allowsSales = input.allowsSales;
    if (input.allowsPurchases !== undefined)
      data.allowsPurchases = input.allowsPurchases;
    if (input.allowNegativeStock !== undefined)
      data.allowNegativeStock = input.allowNegativeStock;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.warehouse.update({
        where: { id: existing.id },
        data,
      });
      const afterSnapshot = pickAuditFields(updated);
      const diff = diffFields(beforeSnapshot, afterSnapshot);
      if (Object.keys(diff.before).length > 0) {
        await this.auditService.recordFromContext(
          ctx,
          {
            action: 'UPDATE',
            entityType: 'Warehouse',
            entityId: id,
            before: diff.before,
            after: diff.after,
          },
          tx,
        );
      }
    });
    return this.getById(ctx.companyId, id);
  }

  async deactivate(ctx: RequestContext, id: string): Promise<WarehouseDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'INACTIVE') return this.getById(ctx.companyId, id);

    const nonZeroBalance = await this.prisma.inventoryBalance.findFirst({
      where: { companyId: ctx.companyId, warehouseId: id, onHand: { not: 0 } },
    });
    if (nonZeroBalance) throw new WarehouseHasStockException();

    const activeReservation = await this.prisma.stockReservation.findFirst({
      where: {
        companyId: ctx.companyId,
        warehouseId: id,
        status: { in: ['ACTIVE', 'PARTIALLY_CONSUMED'] },
      },
    });
    if (activeReservation) throw new WarehouseHasActiveReservationsException();

    await this.prisma.$transaction(async (tx) => {
      await tx.warehouse.update({
        where: { id },
        data: { status: 'INACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Warehouse',
          entityId: id,
          before: { status: 'ACTIVE' },
          after: { status: 'INACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async reactivate(ctx: RequestContext, id: string): Promise<WarehouseDto> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'ACTIVE') return this.getById(ctx.companyId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.warehouse.update({
        where: { id },
        data: { status: 'ACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'Warehouse',
          entityId: id,
          before: { status: 'INACTIVE' },
          after: { status: 'ACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<Warehouse> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, companyId },
    });
    if (!warehouse) throw new WarehouseNotFoundException();
    return warehouse;
  }

  private async assertBranchBelongsToCompany(
    companyId: string,
    branchId: string,
  ): Promise<void> {
    const found = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
    });
    if (!found) throw new WarehouseInvalidBranchException();
  }
}
