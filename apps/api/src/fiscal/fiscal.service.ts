import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isValidCuitChecksum,
  type FiscalDraftDto,
  type FiscalAuthorizationSummary,
  type FiscalDraftInput,
  type FiscalDraftsQuery,
  type FiscalDraftsResponse,
  type FiscalPreview,
  type FiscalSource,
  type RefreshFiscalIdentityInput,
  type SaveFiscalDraftInput,
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
function authorizationSummary(
  row:
    | {
        status: string;
        pointOfSale: number;
        voucherType: number;
        voucherNumber: number;
      }
    | undefined,
): FiscalAuthorizationSummary | null {
  return row
    ? {
        status: row.status as FiscalAuthorizationSummary['status'],
        pointOfSale: row.pointOfSale,
        voucherType: row.voucherType,
        voucherNumber: row.voucherNumber,
      }
    : null;
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
  async refreshIdentity(
    ctx: RequestContext,
    id: string,
    input: RefreshFiscalIdentityInput,
  ) {
    const scope = { companyId: ctx.companyId, tenantId: ctx.tenantId };
    const target = await this.prisma.fiscalDraft.findFirst({
      where: { id, ...scope },
      select: { salesDocumentId: true },
    });
    if (!target)
      throw new NotFoundException({
        code: 'FISCAL_DRAFT_NOT_FOUND',
        message: 'No se encontró el borrador fiscal.',
      });
    return this.prisma.$transaction(async (tx) => {
      // Use the same lock order as save/authorize so the first submission freezes identity.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-draft:${ctx.companyId}:${target.salesDocumentId}`}, 0))`;
      await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${target.salesDocumentId}::uuid AND "companyId" = ${ctx.companyId}::uuid AND "tenantId" = ${ctx.tenantId}::uuid FOR SHARE`;
      const existing = await tx.fiscalDraft.findFirst({
        where: { id, ...scope },
      });
      if (!existing)
        throw new NotFoundException({
          code: 'FISCAL_DRAFT_NOT_FOUND',
          message: 'No se encontró el borrador fiscal.',
        });
      if (
        existing.salesDocumentId !== target.salesDocumentId ||
        existing.revision !== input.expectedRevision
      )
        throw new ConflictException({
          code: 'FISCAL_DRAFT_REVISION_CONFLICT',
          message:
            'El borrador cambió. Recargalo antes de actualizar la identidad fiscal.',
        });
      const attempted = await tx.fiscalAuthorization.findFirst({
        where: { draftId: existing.id, ...scope },
        select: { id: true },
      });
      if (attempted)
        throw new ConflictException(
          'El borrador ya tiene un intento de autorización. No se puede actualizar su identidad fiscal, incluso si fue rechazado.',
        );
      const sale = await tx.salesDocument.findFirst({
        where: { id: existing.salesDocumentId, ...scope },
        select: {
          id: true,
          status: true,
          customerId: true,
          taxTotal: true,
          currency: { select: { code: true } },
          lines: { select: { taxAmount: true } },
        },
      });
      if (
        !sale ||
        sale.status !== 'CONFIRMED' ||
        sale.currency.code !== 'ARS' ||
        !sale.taxTotal.isZero() ||
        sale.lines.some((line) => !line.taxAmount.isZero())
      )
        throw new BadRequestException(
          'La venta no está disponible para este circuito de pruebas.',
        );
      const [company, customer] = await Promise.all([
        tx.company.findFirst({
          where: { id: ctx.companyId, tenantId: ctx.tenantId },
          select: { legalName: true, taxId: true },
        }),
        tx.customer.findFirst({
          where: { id: sale.customerId, ...scope },
          select: {
            legalName: true,
            taxId: true,
            documentType: true,
            taxCondition: true,
          },
        }),
      ]);
      if (
        !company ||
        !customer ||
        !isValidCuitChecksum(company.taxId.replace(/[-\s]/g, '')) ||
        customer.documentType !== 'CUIT' ||
        !isValidCuitChecksum((customer.taxId ?? '').replace(/[-\s]/g, '')) ||
        !customer.taxCondition ||
        ![
          'RESPONSABLE_INSCRIPTO',
          'MONOTRIBUTO',
          'EXENTO',
          'CONSUMIDOR_FINAL',
        ].includes(customer.taxCondition)
      )
        throw new BadRequestException(
          'Completá los CUIT válidos de la empresa y del cliente, el tipo de documento CUIT y una condición de IVA compatible con homologación antes de actualizar el borrador.',
        );
      const saved = existing.snapshot as unknown as FiscalPreview;
      if (saved.source.saleId !== sale.id)
        throw new BadRequestException(
          'El borrador no coincide con su venta de origen.',
        );
      // Copy only master identity; preserve every commercial/tax value from the saved snapshot.
      const snapshot = {
        ...saved,
        source: {
          ...saved.source,
          issuer: { legalName: company.legalName, taxId: company.taxId },
          recipient: {
            legalName: customer.legalName,
            taxId: customer.taxId,
            taxCondition: customer.taxCondition,
          },
        },
      };
      const row = await tx.fiscalDraft.update({
        where: { id: existing.id, ...scope },
        data: {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          revision: { increment: 1 },
          updatedBy: ctx.userId,
        },
      });
      await this.audit.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'FiscalDraft',
          entityId: row.id,
          before: { revision: existing.revision },
          after: {
            operation: 'REFRESH_IDENTITY',
            salesDocumentId: existing.salesDocumentId,
            revision: row.revision,
          },
        },
        tx,
      );
      return { draft: dto(row) };
    });
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
        include: {
          authorizations: {
            where: { companyId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              status: true,
              pointOfSale: true,
              voucherType: true,
              voucherNumber: true,
              creditNoteDraft: {
                where: { companyId },
                select: {
                  id: true,
                  authorizations: {
                    where: { companyId },
                    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                    take: 1,
                    select: {
                      status: true,
                      pointOfSale: true,
                      voucherType: true,
                      voucherNumber: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.fiscalDraft.count({ where: { companyId } }),
    ]);
    return {
      items: rows.map((row) => {
        const original = row.authorizations[0];
        const note = original?.creditNoteDraft;
        return {
          ...dto(row),
          authorization: authorizationSummary(original),
          creditNote: note
            ? {
                id: note.id,
                authorization: authorizationSummary(note.authorizations[0]),
              }
            : null,
        };
      }),
      pagination: {
        ...query,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }
  async save(ctx: RequestContext, saleId: string, input: SaveFiscalDraftInput) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize only this sale's draft; authorization uses this same lock to freeze the submitted revision.
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
      if (
        existing &&
        (await tx.fiscalAuthorization.findFirst({
          where: {
            companyId: ctx.companyId,
            draftId: existing.id,
            status: { not: 'REJECTED' },
          },
        }))
      ) {
        throw new ConflictException(
          'El borrador tiene una solicitud de homologación registrada y no puede editarse. Consultá su estado.',
        );
      }
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
