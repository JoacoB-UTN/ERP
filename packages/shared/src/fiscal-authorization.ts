import { z } from 'zod';

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
