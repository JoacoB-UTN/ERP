import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  fiscalIssuerVatConditionSchema,
  isValidCuitChecksum,
  normalizeTaxId,
  type FiscalSettingsResponse,
  type SaveFiscalSettingsInput,
} from '@erp/shared';
import type { FiscalSettings, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../company-context/types';

@Injectable()
export class FiscalSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async company(
    ctx: RequestContext,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const company = await db.company.findFirst({
      where: { id: ctx.companyId, tenantId: ctx.tenantId },
      select: { legalName: true, taxId: true },
    });
    if (!company)
      throw new NotFoundException('No se encontró la empresa emisora.');
    return company;
  }

  private response(
    company: { legalName: string; taxId: string },
    row: FiscalSettings | null,
  ): FiscalSettingsResponse {
    const taxId = normalizeTaxId(company.taxId);
    const taxIdFormatValid =
      /^[\d\s-]+$/.test(company.taxId) &&
      !/^0+$/.test(taxId) &&
      isValidCuitChecksum(taxId);
    const vatCondition = row?.vatCondition
      ? fiscalIssuerVatConditionSchema.parse(row.vatCondition)
      : null;
    const testPointOfSale = row?.testPointOfSale ?? null;
    const pendingRequirements: string[] = [];
    if (!taxIdFormatValid)
      pendingRequirements.push(
        'Revisar el formato y dígito verificador del CUIT de la empresa.',
      );
    if (!vatCondition)
      pendingRequirements.push(
        'Definir la condición frente al IVA del emisor.',
      );
    if (!testPointOfSale)
      pendingRequirements.push(
        'Definir el punto de venta de pruebas para Web Services.',
      );
    pendingRequirements.push(
      'Configurar las credenciales en el servidor y probar la autenticación de homologación.',
      'Validar con ARCA la inscripción del emisor, su condición fiscal y la habilitación del punto de venta.',
      'Revisar cada borrador antes de solicitar su autorización de homologación; no habilita facturación real.',
    );
    return {
      settings: {
        environment: 'HOMOLOGATION',
        issuer: {
          legalName: company.legalName,
          taxId: company.taxId,
          taxIdFormatValid,
        },
        vatCondition,
        testPointOfSale,
        revision: row?.revision ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
        authorizationAvailable: false,
        pendingRequirements,
      },
    };
  }

  async get(ctx: RequestContext): Promise<FiscalSettingsResponse> {
    const company = await this.company(ctx);
    const row = await this.prisma.fiscalSettings.findFirst({
      where: { companyId: ctx.companyId, tenantId: ctx.tenantId },
    });
    return this.response(company, row);
  }

  async save(
    ctx: RequestContext,
    input: SaveFiscalSettingsInput,
  ): Promise<FiscalSettingsResponse> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`fiscal-settings:${ctx.companyId}`}, 0))`;
      const company = await this.company(ctx, tx);
      const existing = await tx.fiscalSettings.findFirst({
        where: { companyId: ctx.companyId, tenantId: ctx.tenantId },
      });
      if ((existing?.revision ?? 0) !== input.expectedRevision)
        throw new ConflictException({
          code: 'FISCAL_SETTINGS_REVISION_CONFLICT',
          message:
            'La configuración cambió. Recargala antes de guardar para no sobrescribir otra edición.',
        });
      const values = {
        vatCondition: input.vatCondition,
        testPointOfSale: input.testPointOfSale,
      };
      const row = existing
        ? await tx.fiscalSettings.update({
            where: { companyId: ctx.companyId, tenantId: ctx.tenantId },
            data: {
              ...values,
              revision: { increment: 1 },
              updatedBy: ctx.userId,
            },
          })
        : await tx.fiscalSettings.create({
            data: {
              ...values,
              companyId: ctx.companyId,
              tenantId: ctx.tenantId,
              environment: 'HOMOLOGATION',
              createdBy: ctx.userId,
              updatedBy: ctx.userId,
            },
          });
      await this.audit.recordFromContext(
        ctx,
        {
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'FiscalSettings',
          entityId: ctx.companyId,
          after: {
            ...values,
            environment: 'HOMOLOGATION',
            revision: row.revision,
          },
        },
        tx,
      );
      return this.response(company, row);
    });
  }
}
