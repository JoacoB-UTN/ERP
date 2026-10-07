import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  FiscalCreditNoteDraftDto,
  FiscalCreditNoteSnapshot,
  FiscalPreview,
  SaveFiscalCreditNoteInput,
} from '@erp/shared';
import { Prisma, type FiscalCreditNoteDraft } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { validFiscalDate, type ArcaInvoiceRequest } from './fiscal-request';
import { readArcaRecipient, readFiscalRecipient } from './fiscal-recipient';

function dto(row: FiscalCreditNoteDraft): FiscalCreditNoteDraftDto {
  return {
    ...(row.snapshot as unknown as FiscalCreditNoteSnapshot),
    id: row.id,
    revision: row.revision,
    reason: row.reason,
    status: 'DRAFT',
    environment: 'HOMOLOGATION',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
@Injectable()
export class FiscalCreditNoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  private async original(
    ctx: RequestContext,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const original = await db.fiscalAuthorization.findFirst({
      where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!original)
      throw new NotFoundException(
        'No se encontró el comprobante original en esta empresa.',
      );
    return original;
  }
  async get(ctx: RequestContext, originalId: string) {
    await this.original(ctx, originalId);
    const row = await this.prisma.fiscalCreditNoteDraft.findFirst({
      where: {
        originalAuthorizationId: originalId,
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
      },
    });
    return { draft: row ? dto(row) : null };
  }
  async save(
    ctx: RequestContext,
    originalId: string,
    input: SaveFiscalCreditNoteInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-credit-note:${ctx.companyId}:${originalId}`}, 0))`;
      const original = await this.original(ctx, originalId, tx);
      const creditNoteType = ({ 1: 3, 6: 8, 11: 13 } as const)[
        original.voucherType as 1 | 6 | 11
      ];
      if (
        original.status !== 'AUTHORIZED' ||
        original.environment !== 'HOMOLOGATION' ||
        !original.cae ||
        !creditNoteType
      )
        throw new BadRequestException(
          'Solo se admiten facturas A, B o C autorizadas en homologación.',
        );
      const existing = await tx.fiscalCreditNoteDraft.findFirst({
        where: {
          companyId: ctx.companyId,
          tenantId: ctx.tenantId,
          originalAuthorizationId: originalId,
        },
      });
      if (input.expectedRevision !== (existing?.revision ?? 0))
        throw new ConflictException(
          'El borrador de nota de crédito cambió. Recargá para revisar la versión guardada.',
        );
      if (
        existing &&
        (await tx.fiscalCreditNoteAuthorization.findFirst({
          where: {
            companyId: ctx.companyId,
            creditNoteDraftId: existing.id,
            status: { not: 'REJECTED' },
          },
        }))
      )
        throw new ConflictException(
          'La nota tiene un envío registrado. Consultá su estado; no puede editarse.',
        );
      let snapshot: Prisma.InputJsonValue;
      if (existing) snapshot = existing.snapshot as Prisma.InputJsonValue;
      else {
        const draft = await tx.fiscalDraft.findFirst({
          where: {
            id: original.draftId,
            companyId: ctx.companyId,
            tenantId: ctx.tenantId,
          },
        });
        if (!draft || draft.revision !== original.draftRevision)
          throw new ConflictException(
            'El borrador original no coincide con la factura autorizada.',
          );
        const invoice = draft.snapshot as unknown as FiscalPreview;
        const request = original.request as unknown as ArcaInvoiceRequest;
        const recipient = readArcaRecipient(request);
        const savedRecipient = readFiscalRecipient(
          invoice.source.recipient,
          request.voucherType,
        );
        if (
          recipient.recipientDocumentType !==
            savedRecipient.recipientDocumentType ||
          recipient.recipientDocumentNumber !==
            savedRecipient.recipientDocumentNumber ||
          !validFiscalDate(request.date) ||
          request.voucherType !== original.voucherType ||
          request.pointOfSale !== original.pointOfSale ||
          request.voucherNumber !== original.voucherNumber ||
          request.issuerCuit !== original.issuerCuit ||
          { A: 1, B: 6, C: 11 }[invoice.invoiceType] !== original.voucherType ||
          !new Prisma.Decimal(request.total).gt(0) ||
          !new Prisma.Decimal(request.total).eq(invoice.totals.finalAmount) ||
          !new Prisma.Decimal(request.net).eq(invoice.totals.netAmount) ||
          !new Prisma.Decimal(request.vat).eq(invoice.totals.vatAmount) ||
          !new Prisma.Decimal(request.exempt).eq(invoice.totals.exemptAmount) ||
          !new Prisma.Decimal(request.notTaxed).eq(
            invoice.totals.notTaxedAmount,
          )
        )
          throw new BadRequestException(
            'Los datos guardados de la factura original no son consistentes.',
          );
        const frozen: FiscalCreditNoteSnapshot = {
          original: {
            authorizationId: original.id,
            issuerCuit: original.issuerCuit,
            pointOfSale: original.pointOfSale,
            voucherType: original.voucherType,
            voucherNumber: original.voucherNumber,
            date: request.date,
            cae: original.cae,
          },
          creditNoteType,
          authorizedAmounts: {
            total: request.total,
            net: request.net,
            vat: request.vat,
            exempt: request.exempt,
            notTaxed: request.notTaxed,
            iva: request.iva,
          },
          invoice: {
            source: invoice.source,
            invoiceType: invoice.invoiceType,
            lines: invoice.lines,
            totals: invoice.totals,
          },
        };
        snapshot = frozen as unknown as Prisma.InputJsonValue;
      }
      const row = existing
        ? await tx.fiscalCreditNoteDraft.update({
            where: {
              companyId_originalAuthorizationId: {
                companyId: ctx.companyId,
                originalAuthorizationId: originalId,
              },
            },
            data: {
              reason: input.reason,
              revision: { increment: 1 },
              updatedBy: ctx.userId,
            },
          })
        : await tx.fiscalCreditNoteDraft.create({
            data: {
              tenantId: ctx.tenantId,
              companyId: ctx.companyId,
              originalAuthorizationId: originalId,
              reason: input.reason,
              snapshot,
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            },
          });
      await this.audit.recordFromContext(
        ctx,
        {
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'FiscalCreditNoteDraft',
          entityId: row.id,
          after: {
            originalAuthorizationId: originalId,
            revision: row.revision,
            status: 'DRAFT',
            environment: 'HOMOLOGATION',
          },
        },
        tx,
      );
      return { draft: dto(row) };
    });
  }
}
