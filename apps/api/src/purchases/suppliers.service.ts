import { Injectable } from '@nestjs/common';
import {
  normalizeTaxId,
  formatCuit,
  validateTaxIdForDocumentType,
  type CreateSupplierInput,
  type UpdateSupplierInput,
  type SupplierListQuery,
  type SupplierListResponse,
  type SupplierLookupQuery,
  type SupplierLookupResponse,
  type SupplierSummary,
  type SupplierDetail,
} from '@erp/shared';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import type { Supplier, Prisma } from '../generated/prisma/client';
import {
  SupplierNotFoundException,
  SupplierCodeAlreadyExistsException,
  SupplierTaxIdAlreadyExistsException,
  SupplierInvalidTaxIdException,
} from './suppliers.exceptions';

type AuditableSupplierFields = Record<
  | 'legalName'
  | 'tradeName'
  | 'taxId'
  | 'taxCondition'
  | 'email'
  | 'phone'
  | 'status',
  unknown
>;

function toSummary(s: Supplier): SupplierSummary {
  const taxIdFormatted =
    s.taxId && (s.documentType === 'CUIT' || s.documentType === 'CUIL')
      ? formatCuit(s.taxId)
      : s.taxId;
  return {
    id: s.id,
    code: s.code,
    legalName: s.legalName,
    tradeName: s.tradeName,
    displayName: s.tradeName || s.legalName,
    documentType: s.documentType,
    taxId: s.taxId,
    taxIdFormatted,
    taxCondition: s.taxCondition,
    email: s.email,
    phone: s.phone,
    status: s.status,
  };
}

function toDetail(s: Supplier): SupplierDetail {
  return {
    ...toSummary(s),
    address: s.address,
    city: s.city,
    province: s.province,
    postalCode: s.postalCode,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Only the fields worth diffing in an UPDATE audit record — same pattern as CustomersService.pickAuditFields. */
function pickAuditFields(s: Supplier): AuditableSupplierFields {
  return {
    legalName: s.legalName,
    tradeName: s.tradeName,
    taxId: s.taxId,
    taxCondition: s.taxCondition,
    email: s.email,
    phone: s.phone,
    status: s.status,
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

/**
 * Supplier master data — see docs/purchases.md. Deliberately a smaller
 * surface than CustomersService (no addresses/contacts/categories yet —
 * see docs/purchases.md's "Extension points" for the deferred supplier
 * current-account/fiscal-document scope). Never physically deleted;
 * deactivate/reactivate flip `status`, same pattern as Customer.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(
    companyId: string,
    query: SupplierListQuery,
  ): Promise<SupplierListResponse> {
    const where: Prisma.SupplierWhereInput = { companyId };
    if (query.status) where.status = query.status;
    if (query.search) {
      const term = query.search.trim();
      const normalizedTax = normalizeTaxId(term);
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { legalName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
        ...(normalizedTax ? [{ taxId: { contains: normalizedTax } }] : []),
      ];
    }

    const skip = (query.page - 1) * query.pageSize;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      items: rows.map(toSummary),
      pagination: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  /** Lightweight, ACTIVE-only search for Purchase Order/Receipt supplier pickers — mirrors CustomersService.lookup. */
  async lookup(
    companyId: string,
    query: SupplierLookupQuery,
  ): Promise<SupplierLookupResponse> {
    const where: Prisma.SupplierWhereInput = { companyId, status: 'ACTIVE' };
    if (query.search) {
      const term = query.search.trim();
      const normalizedTax = normalizeTaxId(term);
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { legalName: { contains: term, mode: 'insensitive' } },
        { tradeName: { contains: term, mode: 'insensitive' } },
        ...(normalizedTax ? [{ taxId: { contains: normalizedTax } }] : []),
      ];
    }
    const rows = await this.prisma.supplier.findMany({
      where,
      orderBy: { legalName: 'asc' },
      take: query.limit,
    });
    return {
      items: rows.map((s) => ({
        id: s.id,
        code: s.code,
        displayName: s.tradeName || s.legalName,
        legalName: s.legalName,
        taxId: s.taxId,
        status: s.status,
      })),
    };
  }

  async getById(companyId: string, id: string): Promise<SupplierDetail> {
    const supplier = await this.findScopedOrThrow(companyId, id);
    return toDetail(supplier);
  }

  async create(
    ctx: RequestContext,
    input: CreateSupplierInput,
  ): Promise<SupplierDetail> {
    const normalizedTaxId = input.taxId ? normalizeTaxId(input.taxId) : null;
    if (normalizedTaxId) {
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        normalizedTaxId,
      );
    }
    const manualCode = input.code?.trim();
    if (manualCode) {
      await this.assertCodeAvailable(this.prisma, ctx.companyId, manualCode);
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const code = manualCode || (await this.nextCode(tx, ctx.companyId));

      const supplier = await tx.supplier.create({
        data: {
          tenantId: ctx.tenantId,
          companyId: ctx.companyId,
          code,
          legalName: input.legalName,
          tradeName: input.tradeName || null,
          documentType: input.documentType ?? null,
          taxId: normalizedTaxId,
          taxCondition: input.taxCondition ?? null,
          email: input.email || null,
          phone: input.phone || null,
          address: input.address || null,
          city: input.city || null,
          province: input.province || null,
          postalCode: input.postalCode || null,
          notes: input.notes || null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        },
      });

      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'CREATE',
          entityType: 'Supplier',
          entityId: supplier.id,
          after: {
            code: supplier.code,
            legalName: supplier.legalName,
            tradeName: supplier.tradeName,
            documentType: supplier.documentType,
            taxId: supplier.taxId,
            taxCondition: supplier.taxCondition,
            status: supplier.status,
          },
        },
        tx,
      );

      return supplier;
    });

    return this.getById(ctx.companyId, created.id);
  }

  async update(
    ctx: RequestContext,
    id: string,
    input: UpdateSupplierInput,
  ): Promise<SupplierDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);

    const normalizedTaxId =
      input.taxId === undefined
        ? undefined
        : input.taxId
          ? normalizeTaxId(input.taxId)
          : null;
    const effectiveTaxId =
      normalizedTaxId === undefined ? existing.taxId : normalizedTaxId;
    // A PATCH only carries the fields the caller actually sent — the Zod
    // schema's own superRefine (packages/shared/src/suppliers.ts) can only
    // validate the taxId/documentType PAIR as it appears in THIS request
    // body, so it silently skips CUIT/CUIL checksum validation whenever
    // either field is omitted (e.g. PATCH { taxId } alone, on a supplier
    // whose existing documentType is CUIT). Re-validate here using the
    // EFFECTIVE pair — existing value merged with whatever this PATCH
    // actually changes — reusing the same shared checksum logic, never a
    // duplicated algorithm.
    const effectiveDocumentType =
      input.documentType === undefined
        ? existing.documentType
        : input.documentType;
    if (effectiveTaxId) {
      const result = validateTaxIdForDocumentType(
        effectiveDocumentType,
        effectiveTaxId,
      );
      if (!result.valid)
        throw new SupplierInvalidTaxIdException(result.message);
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        effectiveTaxId,
        existing.id,
      );
    }

    const beforeSnapshot = pickAuditFields(existing);

    const data: Prisma.SupplierUpdateInput = { updatedBy: ctx.userId };
    if (input.legalName !== undefined) data.legalName = input.legalName;
    if (input.tradeName !== undefined) data.tradeName = input.tradeName || null;
    if (input.documentType !== undefined)
      data.documentType = input.documentType;
    if (normalizedTaxId !== undefined) data.taxId = normalizedTaxId;
    if (input.taxCondition !== undefined)
      data.taxCondition = input.taxCondition;
    if (input.email !== undefined) data.email = input.email || null;
    if (input.phone !== undefined) data.phone = input.phone || null;
    if (input.address !== undefined) data.address = input.address || null;
    if (input.city !== undefined) data.city = input.city || null;
    if (input.province !== undefined) data.province = input.province || null;
    if (input.postalCode !== undefined)
      data.postalCode = input.postalCode || null;
    if (input.notes !== undefined) data.notes = input.notes || null;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
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
            entityType: 'Supplier',
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

  async deactivate(ctx: RequestContext, id: string): Promise<SupplierDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'INACTIVE') return this.getById(ctx.companyId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id },
        data: { status: 'INACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'DEACTIVATE',
          entityType: 'Supplier',
          entityId: id,
          before: { status: 'ACTIVE' },
          after: { status: 'INACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  async reactivate(ctx: RequestContext, id: string): Promise<SupplierDetail> {
    const existing = await this.findScopedOrThrow(ctx.companyId, id);
    if (existing.status === 'ACTIVE') return this.getById(ctx.companyId, id);
    if (existing.taxId) {
      await this.assertTaxIdAvailable(
        this.prisma,
        ctx.companyId,
        existing.taxId,
        id,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id },
        data: { status: 'ACTIVE', updatedBy: ctx.userId },
      });
      await this.auditService.recordFromContext(
        ctx,
        {
          action: 'ACTIVATE',
          entityType: 'Supplier',
          entityId: id,
          before: { status: 'INACTIVE' },
          after: { status: 'ACTIVE' },
        },
        tx,
      );
    });
    return this.getById(ctx.companyId, id);
  }

  // ---------- Internal helpers ----------

  /** Exposed for PurchaseOrdersService/PurchaseReceiptsService — same company-scoped lookup, avoids a second implementation. */
  async loadScoped(companyId: string, id: string): Promise<Supplier> {
    return this.findScopedOrThrow(companyId, id);
  }

  private async findScopedOrThrow(
    companyId: string,
    id: string,
  ): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, companyId },
    });
    if (!supplier) throw new SupplierNotFoundException();
    return supplier;
  }

  /** Only ACTIVE suppliers count as a conflict — see docs/purchases.md. */
  private async assertTaxIdAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    normalizedTaxId: string,
    excludeId?: string,
  ): Promise<void> {
    const conflict = await client.supplier.findFirst({
      where: {
        companyId,
        taxId: normalizedTaxId,
        status: 'ACTIVE',
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (conflict) throw new SupplierTaxIdAlreadyExistsException();
  }

  private async assertCodeAvailable(
    client: PrismaService | Prisma.TransactionClient,
    companyId: string,
    code: string,
  ): Promise<void> {
    const conflict = await client.supplier.findFirst({
      where: { companyId, code },
    });
    if (conflict) throw new SupplierCodeAlreadyExistsException();
  }

  /** Atomic per-company counter — see SupplierCodeSequence in schema.prisma. */
  private async nextCode(
    tx: Prisma.TransactionClient,
    companyId: string,
  ): Promise<string> {
    const seq = await tx.supplierCodeSequence.upsert({
      where: { companyId },
      create: { companyId, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });
    return String(seq.lastValue).padStart(6, '0');
  }
}
