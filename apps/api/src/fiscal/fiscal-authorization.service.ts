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
  type FiscalPreview,
  type FiscalAuthenticationResponse,
} from '@erp/shared';
import { Prisma, type FiscalAuthorization } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';
import { ArcaWsaaService } from './arca-wsaa.service';
import { ArcaWsfeService, type ArcaInvoiceRequest } from './arca-wsfe.service';
import { buildHomologationRequest } from './fiscal-request';

const pending = ['SENDING', 'UNKNOWN'];
function dto(row: FiscalAuthorization): FiscalAuthorizationDto {
  return {
    id: row.id,
    draftId: row.draftId,
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
export class FiscalAuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly wsaa: ArcaWsaaService,
    private readonly wsfe: ArcaWsfeService,
  ) {}

  private async draft(
    ctx: RequestContext,
    id: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.fiscalDraft.findFirst({
      where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!row)
      throw new NotFoundException(
        'No se encontró el borrador en esta empresa.',
      );
    return row;
  }
  async latest(ctx: RequestContext, draftId: string) {
    await this.draft(ctx, draftId);
    const row = await this.prisma.fiscalAuthorization.findFirst({
      where: { draftId, companyId: ctx.companyId, tenantId: ctx.tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return { authorization: row ? dto(row) : null };
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
        'El borrador cambió. Recargalo antes de autorizar.',
      );
    const settings = await db.fiscalSettings.findFirst({
      where: { companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!settings)
      throw new BadRequestException(
        'Completá la configuración fiscal de homologación.',
      );
    const company = await db.company.findFirst({
      where: { id: ctx.companyId, tenantId: ctx.tenantId },
    });
    const sale = await db.salesDocument.findFirst({
      where: {
        id: draft.salesDocumentId,
        companyId: ctx.companyId,
        tenantId: ctx.tenantId,
      },
      include: { customer: true, currency: true },
    });
    const snapshot = draft.snapshot as unknown as FiscalPreview;
    if (
      !company ||
      !sale ||
      sale.status !== 'CONFIRMED' ||
      sale.currency.code !== 'ARS' ||
      !sale.taxTotal.isZero()
    )
      throw new BadRequestException(
        'La venta no está disponible para este circuito de pruebas.',
      );
    if (
      sale.customer.documentType !== 'CUIT' ||
      normalizeTaxId(company.taxId) !==
        normalizeTaxId(snapshot.source.issuer.taxId) ||
      normalizeTaxId(sale.customer.taxId ?? '') !==
        normalizeTaxId(snapshot.source.recipient.taxId ?? '') ||
      sale.customer.taxCondition !== snapshot.source.recipient.taxCondition
    ) {
      throw new BadRequestException(
        'Esta etapa requiere un receptor identificado con CUIT y datos fiscales que coincidan con el borrador guardado. Revisá los datos antes de emitir.',
      );
    }
    if (!new Prisma.Decimal(snapshot.totals.finalAmount).eq(sale.total))
      throw new BadRequestException(
        'El importe guardado no coincide con la venta.',
      );
    return {
      draft,
      settings,
      request: buildHomologationRequest(snapshot, settings, date),
    };
  }
  async authenticate(
    ctx: RequestContext,
  ): Promise<FiscalAuthenticationResponse> {
    const company = await this.prisma.company.findFirst({
      where: { id: ctx.companyId, tenantId: ctx.tenantId },
    });
    if (!company) throw new NotFoundException('No se encontró la empresa.');
    try {
      const ticket = await this.wsaa.getTicket(
        ctx.companyId,
        normalizeTaxId(company.taxId),
      );
      return {
        environment: 'HOMOLOGATION',
        status: 'READY',
        expiresAt: ticket.expiresAt,
        message:
          'Autenticación de pruebas correcta. Todavía debe validarse cada comprobante y su punto de venta.',
      };
    } catch {
      return {
        environment: 'HOMOLOGATION',
        status: 'UNAVAILABLE',
        expiresAt: null,
        message:
          'No se pudo autenticar. Revisá en el servidor el certificado, su clave privada, el CUIT, la vigencia y la asociación a wsfe de homologación. No compartas claves por chat.',
      };
    }
  }
  async authorize(
    ctx: RequestContext,
    draftId: string,
    input: AuthorizeFiscalDraftInput,
  ) {
    await this.draft(ctx, draftId);
    const existing = await this.prisma.fiscalAuthorization.findFirst({
      where: { companyId: ctx.companyId, draftId, status: { not: 'REJECTED' } },
    });
    if (existing) return { authorization: dto(existing) };
    const date = today();
    const prepared = await this.source(
      ctx,
      draftId,
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
    let claimed: { row: FiscalAuthorization; send: boolean };
    try {
      claimed = await this.prisma.$transaction(async (tx) => {
        const series = `${prepared.request.issuerCuit}:${prepared.request.pointOfSale}:${prepared.request.voucherType}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`homologation-series:${series}`},0))`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-draft:${ctx.companyId}:${prepared.draft.salesDocumentId}`},0))`;
        await tx.$queryRaw`SELECT id FROM sales_documents WHERE id = ${prepared.draft.salesDocumentId}::uuid AND "companyId" = ${ctx.companyId}::uuid FOR SHARE`;
        const current = await this.source(
          ctx,
          draftId,
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
        const active = await tx.fiscalAuthorization.findFirst({
          where: {
            companyId: ctx.companyId,
            draftId,
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
        const unresolved = await tx.fiscalAuthorization.findFirst({
          where: { ...scope, status: { in: pending } },
        });
        if (unresolved)
          throw new ConflictException(
            'Hay un envío pendiente en esta serie. Consultá su resultado antes de enviar otro.',
          );
        const newer = await tx.fiscalAuthorization.findFirst({
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
        const request: ArcaInvoiceRequest = {
          ...current.request,
          voucherNumber: last + 1,
        };
        const row = await tx.fiscalAuthorization.create({
          data: {
            tenantId: ctx.tenantId,
            companyId: ctx.companyId,
            draftId,
            draftRevision: current.draft.revision,
            issuerCuit: request.issuerCuit,
            pointOfSale: request.pointOfSale,
            voucherType: request.voucherType,
            voucherNumber: request.voucherNumber,
            request: request as unknown as Prisma.InputJsonValue,
            createdBy: ctx.userId,
            message:
              'Solicitud registrada. Consultá el resultado si la conexión se interrumpe.',
          },
        });
        await this.audit.recordFromContext(
          ctx,
          {
            action: 'CREATE',
            entityType: 'FiscalAuthorization',
            entityId: row.id,
            after: {
              status: 'SENDING',
              draftId,
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
        claimed.row.request as unknown as ArcaInvoiceRequest,
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
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-result:${ctx.companyId}:${id}`},0))`;
      const row = await tx.fiscalAuthorization.findFirst({
        where: { id, companyId: ctx.companyId, tenantId: ctx.tenantId },
      });
      if (!row) throw new NotFoundException('No se encontró la solicitud.');
      if (!pending.includes(row.status)) return { authorization: dto(row) };
      const updated = await tx.fiscalAuthorization.update({
        where: { id, companyId: ctx.companyId },
        data: result,
      });
      await this.audit.recordFromContext(
        ctx,
        {
          action: 'UPDATE',
          entityType: 'FiscalAuthorization',
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
    const row = await this.prisma.fiscalAuthorization.findFirst({
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
        row.request as unknown as ArcaInvoiceRequest,
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
