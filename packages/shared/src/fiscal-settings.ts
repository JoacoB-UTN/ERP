import { z } from 'zod';

export const fiscalIssuerVatConditionSchema = z.enum(['RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO']);
export type FiscalIssuerVatCondition = z.infer<typeof fiscalIssuerVatConditionSchema>;
export const saveFiscalSettingsSchema = z
  .object({
    vatCondition: fiscalIssuerVatConditionSchema.nullable(),
    testPointOfSale: z.number().int().min(1).max(99999).nullable(),
    expectedRevision: z.number().int().min(0).max(2147483646),
  })
  .strict();
export type SaveFiscalSettingsInput = z.infer<typeof saveFiscalSettingsSchema>;
export interface FiscalSettings {
  environment: 'HOMOLOGATION';
  issuer: { legalName: string; taxId: string; taxIdFormatValid: boolean };
  vatCondition: FiscalIssuerVatCondition | null;
  testPointOfSale: number | null;
  revision: number;
  updatedAt: string | null;
  authorizationAvailable: false;
  pendingRequirements: string[];
}
export interface FiscalSettingsResponse {
  settings: FiscalSettings;
}
export interface FiscalConnectivityResponse {
  environment: 'HOMOLOGATION';
  checkedAt: string;
  status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  services: {
    application: 'OK' | 'UNAVAILABLE';
    database: 'OK' | 'UNAVAILABLE';
    authentication: 'OK' | 'UNAVAILABLE';
  } | null;
  message: string;
  authorizationAvailable: false;
}
export const FISCAL_ISSUER_VAT_LABELS: Record<FiscalIssuerVatCondition, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable inscripto',
  MONOTRIBUTO: 'Monotributista',
  EXENTO: 'Exento',
};
