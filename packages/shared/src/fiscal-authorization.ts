import { z } from 'zod';
import type { PaginationMeta } from './api';

export const fiscalAuthorizationHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type FiscalAuthorizationHistoryQuery = z.infer<typeof fiscalAuthorizationHistoryQuerySchema>;
export type FiscalAuthorizationHistoryKind = 'invoice' | 'credit-note';
export interface FiscalAuthorizationHistoryResponse {
  items: FiscalAuthorizationDto[];
  latestAuthorizationId: string | null;
  pagination: PaginationMeta;
}

export const authorizeFiscalDraftSchema = z
  .object({
    expectedRevision: z.number().int().min(1).max(2147483646),
    confirmHomologation: z.literal(true),
    exclusivePointOfSale: z.literal(true),
  })
  .strict();
export type AuthorizeFiscalDraftInput = z.infer<typeof authorizeFiscalDraftSchema>;
export interface FiscalAuthorizationDto {
  id: string;
  draftId: string;
  draftRevision: number;
  environment: 'HOMOLOGATION';
  status: 'SENDING' | 'UNKNOWN' | 'AUTHORIZED' | 'REJECTED';
  pointOfSale: number;
  voucherType: number;
  voucherNumber: number;
  cae: string | null;
  expiresAt: string | null;
  message: string;
  createdAt: string;
  updatedAt: string;
}
export interface FiscalAuthorizationResponse {
  authorization: FiscalAuthorizationDto;
}
export interface FiscalLatestAuthorizationResponse {
  authorization: FiscalAuthorizationDto | null;
}
export interface FiscalAuthenticationResponse {
  environment: 'HOMOLOGATION';
  status: 'READY' | 'UNAVAILABLE';
  expiresAt: string | null;
  message: string;
}
