import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  FiscalDraftDto,
  FiscalDraftInput,
  FiscalDraftsQuery,
  FiscalDraftsResponse,
  FiscalPreview,
  FiscalSource,
  SaveFiscalDraftInput,
} from '@erp/shared';
import { Prisma, type FiscalDraft } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { calculateFiscalBreakdown } from './fiscal-calculation';

const PENDING = [
  'Configurar y validar la empresa emisora y su condición frente al IVA.',
  'Validar identificación y condición fiscal del receptor y tipo de comprobante.',
  'Configurar certificado, servicio y punto de venta de homologación de ARCA.',
  'Validar conceptos, fechas, alícuotas y datos obligatorios con ARCA antes de autorizar.',
];
function dto(row: FiscalDraft): FiscalDraftDto {
  const snapshot = row.snapshot as unknown as FiscalPreview;
  return {
    ...snapshot,
    id: row.id,
    status: 'DRAFT',
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorizationAvailable: false,
    pendingRequirements: [...PENDING],
  };
}
@Injectable()
export class FiscalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async source(
    companyId: string,
    saleId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<FiscalSource> {
    const sale = await client.salesDocument.findFirst({
      where: { id: saleId, companyId },
      include: {
        company: true,
        customer: true,
        currency: true,
        lines: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!sale)
      throw new NotFoundException({
        code: 'FISCAL_SALE_NOT_FOUND',
        message: 'No se encontró la venta en esta empresa.',
      });
    if (sale.status !== 'CONFIRMED')
      throw new BadRequestException({
        code: 'FISCAL_SALE_NOT_CONFIRMED',
        message: 'Solo se pueden preparar ventas confirmadas.',
      });
    if (
      sale.currency.code !== 'ARS' ||
      !sale.taxTotal.isZero() ||
      sale.lines.some((line) => !line.taxAmount.isZero())
    ) {
      throw new BadRequestException({
        code: 'FISCAL_SOURCE_UNSUPPORTED',
        message:
          'Esta etapa admite ventas internas en ARS sin impuestos previamente calculados.',
      });
    }
    const existing = await client.fiscalDraft.findUnique({
      where: {
        companyId_salesDocumentId: { companyId, salesDocumentId: saleId },
      },
    });
    if (existing) return (existing.snapshot as unknown as FiscalPreview).source;
    return {
      saleId: sale.id,
      saleNumber: sale.number,
      currencyCode: 'ARS',
      total: sale.total.toString(),
      issuer: { legalName: sale.company.legalName, taxId: sale.company.taxId },
      recipient: {
        legalName: sale.customer.legalName,
        taxId: sale.customer.taxId,
        taxCondition: sale.customer.taxCondition ?? 'UNKNOWN',
      },
      lines: sale.lines.map((line) => ({
        salesLineId: line.id,
        description: line.description,
        quantity: line.quantity.toString(),
        finalAmount: line.totalAmount.toString(),
      })),
    };
  }
  async getSource(companyId: string, saleId: string) {
    return { source: await this.source(companyId, saleId) };
  }
  private previewFrom(
    source: FiscalSource,
    input: FiscalDraftInput,
  ): FiscalPreview {
    return {
      source,
      ...calculateFiscalBreakdown(source.lines, source.total, input),
      invoiceType: input.invoiceType,
      amountInterpretation: input.amountInterpretation,
      authorizationAvailable: false,
      pendingRequirements: [...PENDING],
    };
  }
  async preview(companyId: string, saleId: string, input: FiscalDraftInput) {
    return {
      preview: this.previewFrom(await this.source(companyId, saleId), input),
    };
  }
  async getById(companyId: string, id: string) {
    const row = await this.prisma.fiscalDraft.findFirst({
      where: { id, companyId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'FISCAL_DRAFT_NOT_FOUND',
        message: 'No se encontró el borrador fiscal.',
      });
    return { draft: dto(row) };
  }
  async getForSale(companyId: string, saleId: string) {
    const row = await this.prisma.fiscalDraft.findUnique({
      where: {
        companyId_salesDocumentId: { companyId, salesDocumentId: saleId },
      },
    });
    return { draft: row ? dto(row) : null };
  }
  async list(
    companyId: string,
    query: FiscalDraftsQuery,
  ): Promise<FiscalDraftsResponse> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.fiscalDraft.findMany({
        where: { companyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.fiscalDraft.count({ where: { companyId } }),
    ]);
    return {
      items: rows.map(dto),
      pagination: {
        ...query,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
  async save(ctx: RequestContext, saleId: string, input: SaveFiscalDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize only this sale's draft; number allocation/ARCA is deliberately absent.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-draft:${ctx.companyId}:${saleId}`}, 0))`;
      // A row lock also prevents a concurrent sales cancellation/status change.
      await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${saleId}::uuid AND "companyId" = ${ctx.companyId}::uuid FOR SHARE`;
      const existing = await tx.fiscalDraft.findUnique({
        where: {
          companyId_salesDocumentId: {
            companyId: ctx.companyId,
            salesDocumentId: saleId,
          },
        },
      });
      if ((existing?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException({
          code: 'FISCAL_DRAFT_REVISION_CONFLICT',
          message:
            'El borrador cambió. Recargalo antes de guardar para no sobrescribir otra edición.',
        });
      const source = await this.source(ctx.companyId, saleId, tx);
      const { expectedRevision: _revision, ...calculationInput } = input;
      const preview = this.previewFrom(source, calculationInput);
      const snapshot = preview as unknown as Prisma.InputJsonValue;
      const row = existing
        ? await tx.fiscalDraft.update({
            where: {
              companyId_salesDocumentId: {
                companyId: ctx.companyId,
                salesDocumentId: saleId,
              },
            },
            data: {
              snapshot,
              revision: { increment: 1 },
              updatedBy: ctx.userId,
            },
          })
        : await tx.fiscalDraft.create({
            data: {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              salesDocumentId: saleId,
              snapshot,
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            },
          });
      await this.audit.recordFromContext(
        ctx,
        {
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'FiscalDraft',
          entityId: row.id,
          after: {
            salesDocumentId: saleId,
            revision: row.revision,
            invoiceType: preview.invoiceType,
            total: preview.totals.finalAmount,
          },
        },
        tx,
      );
      return { draft: dto(row) };
    });
  }
}
