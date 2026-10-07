import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  normalizeTaxId,
  type AuthorizeFiscalDraftInput,
  type FiscalAuthorizationDto,
  type FiscalAuthorizationHistoryQuery,
  type FiscalAuthorizationHistoryResponse,
  type FiscalCreditNoteSnapshot,
} from '@erp/shared';
import {
  Prisma,
  type FiscalCreditNoteAuthorization,
} from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { ArcaWsfeService } from './arca-wsfe.service';
import type {
  ArcaCreditNoteRequest,
  ArcaInvoiceRequest,
} from './fiscal-request';
import { buildCreditNoteRequest } from './fiscal-credit-note-request';

const pending = ['SENDING', 'UNKNOWN'];
const publicSelection = {
  id: true,
  creditNoteDraftId: true,
  draftRevision: true,
  status: true,
  pointOfSale: true,
  voucherType: true,
  voucherNumber: true,
  cae: true,
  expiresAt: true,
  message: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FiscalCreditNoteAuthorizationSelect;
type PublicAuthorization = Prisma.FiscalCreditNoteAuthorizationGetPayload<{
  select: typeof publicSelection;
}>;
function dto(row: PublicAuthorization): FiscalAuthorizationDto {
  return {
    id: row.id,
    draftId: row.creditNoteDraftId,
    draftRevision: row.draftRevision,
    environment: 'HOMOLOGATION',
    status: row.status as FiscalAuthorizationDto['status'],
    pointOfSale: row.pointOfSale,
    voucherType: row.voucherType,
    voucherNumber: row.voucherNumber,
    cae: row.cae,
    expiresAt: row.expiresAt,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('');
}
@Injectable()
export class FiscalCreditNoteAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wsfe: ArcaWsfeService,
  ) {}

  private async draft(
    ctx: RequestContext,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.fiscalCreditNoteDraft.findFirst({
      where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!row)
      throw new NotFoundException(
        'No se encontró el borrador en esta empresa.',
      );
    return row;
  }
  async latest(ctx: RequestContext, creditNoteDraftId: string) {
    await this.draft(ctx, creditNoteDraftId);
    const row = await this.prisma.fiscalCreditNoteAuthorization.findFirst({
      where: {
        creditNoteDraftId,
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { authorization: row ? dto(row) : null };
  }
  async history(
    ctx: RequestContext,
    creditNoteDraftId: string,
    query: FiscalAuthorizationHistoryQuery,
  ): Promise<FiscalAuthorizationHistoryResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const scope = { companyId: ctx.companyId, tenantId: ctx.tenantId };
        const parent = await tx.fiscalCreditNoteDraft.findFirst({
          where: { id: creditNoteDraftId, ...scope },
          select: { id: true },
        });
        if (!parent)
          throw new NotFoundException(
            'No se encontró el borrador en esta empresa.',
          );
        const where = { creditNoteDraftId, ...scope };
        const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
        const rows = await tx.fiscalCreditNoteAuthorization.findMany({
          where,
          orderBy: [...orderBy],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: publicSelection,
        });
        const total = await tx.fiscalCreditNoteAuthorization.count({ where });
        const latest = await tx.fiscalCreditNoteAuthorization.findFirst({
          where,
          orderBy: [...orderBy],
          select: { id: true },
        });
        return {
          items: rows.map(dto),
          latestAuthorizationId: latest?.id ?? null,
          pagination: { page: query.page, pageSize: query.pageSize, total },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  private async source(
    ctx: RequestContext,
    id: string,
    revision: number,
    date: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const draft = await this.draft(ctx, id, db);
    if (draft.revision !== revision)
      throw new ConflictException(
        'La nota cambió. Recargá antes de autorizar.',
      );
    const original = await db.fiscalAuthorization.findFirst({
      where: {
        id: draft.originalAuthorizationId,
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
      },
    });
    if (
      !original ||
      original.status !== 'AUTHORIZED' ||
      original.environment !== 'HOMOLOGATION'
    )
      throw new BadRequestException(
        'La factura original no está autorizada en homologación.',
      );
    const snapshot = draft.snapshot as unknown as FiscalCreditNoteSnapshot;
    const request = buildCreditNoteRequest(snapshot, date);
    const originalRequest = original.request as unknown as ArcaInvoiceRequest;
    if (
      request.associated.date !== originalRequest.date ||
      request.recipientCuit !== originalRequest.recipientCuit ||
      request.recipientVatConditionId !==
        originalRequest.recipientVatConditionId ||
      !(['total', 'net', 'vat', 'exempt', 'notTaxed'] as const).every((key) =>
        new Prisma.Decimal(request[key]).eq(originalRequest[key]),
      ) ||
      JSON.stringify(request.iva) !== JSON.stringify(originalRequest.iva)
    )
      throw new BadRequestException(
        'La nota no coincide con la solicitud autorizada original.',
      );
    const company = await db.company.findFirst({
      where: { id: ctx.companyId, tenantId: ctx.tenantId },
    });
    const settings = await db.fiscalSettings.findFirst({
      where: { companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (
      !company ||
      normalizeTaxId(company.taxId) !== request.issuerCuit ||
      !settings ||
      settings.environment !== 'HOMOLOGATION' ||
      settings.testPointOfSale !== request.pointOfSale ||
      snapshot.original.authorizationId !== original.id ||
      snapshot.original.cae !== original.cae ||
      request.associated.issuerCuit !== original.issuerCuit ||
      request.associated.pointOfSale !== original.pointOfSale ||
      request.associated.voucherType !== original.voucherType ||
      request.associated.voucherNumber !== original.voucherNumber
    )
      throw new BadRequestException(
        'Revisá la empresa, el punto de venta original y los datos guardados de la nota.',
      );
    return { draft, settings, request };
  }
  async authorize(
    ctx: RequestContext,
    creditNoteDraftId: string,
    input: AuthorizeFiscalDraftInput,
  ) {
    await this.draft(ctx, creditNoteDraftId);
    const existing = await this.prisma.fiscalCreditNoteAuthorization.findFirst({
      where: {
        companyId: ctx.companyId,
        creditNoteDraftId,
        status: { not: 'REJECTED' },
      },
    });
    if (existing) return { authorization: dto(existing) };
    const date = today();
    const prepared = await this.source(
      ctx,
      creditNoteDraftId,
      input.expectedRevision,
      date,
    );
    let last: number;
    try {
      await this.wsfe.validate(ctx.companyId, prepared.request);
      last = await this.wsfe.lastNumber(
        ctx.companyId,
        prepared.request.issuerCuit,
        prepared.request.pointOfSale,
        prepared.request.voucherType,
      );
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo validar el acceso de homologación, sus catálogos o el punto de venta. No se envió ningún comprobante.',
      );
    }
    if (!Number.isInteger(last) || last < 0 || last >= 99999999)
      throw new BadRequestException(
        'Numeración de ARCA fuera del rango admitido.',
      );
    let claimed: { row: FiscalCreditNoteAuthorization; send: boolean };
    try {
      claimed = await this.prisma.$transaction(async (tx) => {
        const series = `${prepared.request.issuerCuit}:${prepared.request.pointOfSale}:${prepared.request.voucherType}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`homologation-series:${series}`},0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-credit-note:${ctx.companyId}:${prepared.draft.originalAuthorizationId}`},0))`;
        const current = await this.source(
          ctx,
          creditNoteDraftId,
          input.expectedRevision,
          date,
          tx,
        );
        if (
          current.settings.revision !== prepared.settings.revision ||
          JSON.stringify(current.request) !== JSON.stringify(prepared.request)
        )
          throw new ConflictException(
            'La configuración o los datos fiscales cambiaron. Revisalos antes de enviar.',
          );
        const active = await tx.fiscalCreditNoteAuthorization.findFirst({
          where: {
            companyId: ctx.companyId,
            creditNoteDraftId,
            status: { not: 'REJECTED' },
          },
        });
        if (active) return { row: active, send: false };
        const scope = {
          companyId: ctx.companyId,
          issuerCuit: current.request.issuerCuit,
          pointOfSale: current.request.pointOfSale,
          voucherType: current.request.voucherType,
        };
        const unresolved = await tx.fiscalCreditNoteAuthorization.findFirst({
          where: { ...scope, status: { in: pending } },
        });
        if (unresolved)
          throw new ConflictException(
            'Hay un envío pendiente en esta serie. Consultá su resultado antes de enviar otro.',
          );
        const newer = await tx.fiscalCreditNoteAuthorization.findFirst({
          where: {
            ...scope,
            status: 'AUTHORIZED',
            voucherNumber: { gt: last },
          },
        });
        if (newer)
          throw new ConflictException(
            'La numeración cambió durante la preparación. Volvé a revisar e intentar.',
          );
        const request: ArcaCreditNoteRequest = {
          ...current.request,
          voucherNumber: last + 1,
        };
        const row = await tx.fiscalCreditNoteAuthorization.create({
          data: {
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            creditNoteDraftId,
            draftRevision: current.draft.revision,
            issuerCuit: request.issuerCuit,
            pointOfSale: request.pointOfSale,
            voucherType: request.voucherType,
            voucherNumber: request.voucherNumber,
            request,
            createdBy: ctx.userId,
            message:
              'Solicitud registrada. Consultá el resultado si la conexión se interrumpe.',
          },
        });
        await this.audit.recordFromContext(
          ctx,
          {
            action: 'CREATE',
            entityType: 'FiscalCreditNoteAuthorization',
            entityId: row.id,
            after: {
              status: 'SENDING',
              creditNoteDraftId,
              voucherNumber: row.voucherNumber,
              environment: 'HOMOLOGATION',
            },
          },
          tx,
        );
        return { row, send: true };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'La serie o el borrador tienen otra solicitud registrada. Consultá su estado antes de continuar.',
        );
      throw error;
    }
    if (!claimed.send) return { authorization: dto(claimed.row) };
    let result: {
      status: string;
      cae: string | null;
      expiresAt: string | null;
      message: string;
    };
    try {
      result = await this.wsfe.authorize(
        ctx.companyId,
        claimed.row.request as unknown as ArcaCreditNoteRequest,
      );
    } catch {
      result = {
        status: 'UNKNOWN',
        cae: null,
        expiresAt: null,
        message:
          'Respuesta incierta. No vuelvas a enviar: consultá este mismo comprobante para recuperar el resultado.',
      };
    }
    return this.settle(ctx, claimed.row.id, result);
  }
  private async settle(
    ctx: RequestContext,
    id: string,
    result: {
      status: string;
      cae: string | null;
      expiresAt: string | null;
      message: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-nc-result:${ctx.companyId}:${id}`},0))`;
      const row = await tx.fiscalCreditNoteAuthorization.findFirst({
        where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
      });
      if (!row) throw new NotFoundException('No se encontró la solicitud.');
      if (!pending.includes(row.status)) return { authorization: dto(row) };
      const updated = await tx.fiscalCreditNoteAuthorization.update({
        where: { id, companyId: ctx.companyId },
        data: result,
      });
      await this.audit.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'FiscalCreditNoteAuthorization',
          entityId: id,
          after: {
            status: updated.status,
            voucherNumber: updated.voucherNumber,
            environment: 'HOMOLOGATION',
          },
        },
        tx,
      );
      return { authorization: dto(updated) };
    });
  }
  async reconcile(ctx: RequestContext, id: string) {
    const row = await this.prisma.fiscalCreditNoteAuthorization.findFirst({
      where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!row)
      throw new NotFoundException(
        'No se encontró la solicitud en esta empresa.',
      );
    if (!pending.includes(row.status)) return { authorization: dto(row) };
    try {
      const result = await this.wsfe.consult(
        ctx.companyId,
        row.request as unknown as ArcaCreditNoteRequest,
      );
      if (result) return this.settle(ctx, id, result);
    } catch {
      /* Keep the durable uncertainty; never resend or free this number. */
    }
    return this.settle(ctx, id, {
      status: 'UNKNOWN',
      cae: null,
      expiresAt: null,
      message:
        'El resultado todavía no pudo confirmarse. La serie permanece bloqueada; consultá nuevamente o solicitá revisión. No se reenviará automáticamente.',
    });
  }
}
