CREATE UNIQUE INDEX "fiscal_drafts_companyId_id_key" ON "fiscal_drafts"("companyId", "id");
CREATE TABLE "fiscal_authorizations" (
 "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
 "draftId" UUID NOT NULL, "draftRevision" INTEGER NOT NULL,
 "environment" TEXT NOT NULL DEFAULT 'HOMOLOGATION', "issuerCuit" TEXT NOT NULL,
 "pointOfSale" INTEGER NOT NULL, "voucherType" INTEGER NOT NULL, "voucherNumber" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'SENDING', "request" JSONB NOT NULL,
 "cae" TEXT, "expiresAt" TEXT, "message" TEXT NOT NULL,
 "createdBy" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "fiscal_authorizations_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "fiscal_authorizations_state_check" CHECK ("status" IN ('SENDING','UNKNOWN','AUTHORIZED','REJECTED')),
 CONSTRAINT "fiscal_authorizations_environment_check" CHECK ("environment" = 'HOMOLOGATION'),
 CONSTRAINT "fiscal_authorizations_number_check" CHECK ("voucherNumber" BETWEEN 1 AND 99999999 AND "pointOfSale" BETWEEN 1 AND 99999 AND "voucherType" IN (1,6,11) AND "draftRevision" > 0),
 CONSTRAINT "fiscal_authorizations_cae_check" CHECK (("status" = 'AUTHORIZED' AND "cae" IS NOT NULL AND "expiresAt" IS NOT NULL AND "cae" ~ '^[0-9]{14}$' AND "expiresAt" ~ '^[0-9]{8}$') OR ("status" <> 'AUTHORIZED' AND "cae" IS NULL AND "expiresAt" IS NULL))
);
CREATE INDEX "fiscal_authorizations_companyId_draftId_createdAt_idx" ON "fiscal_authorizations"("companyId","draftId","createdAt");
CREATE INDEX "fiscal_authorizations_issuerCuit_pointOfSale_voucherType_st_idx" ON "fiscal_authorizations"("issuerCuit","pointOfSale","voucherType","status");
CREATE INDEX "fiscal_authorizations_tenantId_idx" ON "fiscal_authorizations"("tenantId");
-- One uncertain send per legal issuer's series, even if multiple ERP companies share a CUIT.
CREATE UNIQUE INDEX "fiscal_authorizations_pending_series" ON "fiscal_authorizations"("issuerCuit","pointOfSale","voucherType") WHERE "status" IN ('SENDING','UNKNOWN');
CREATE UNIQUE INDEX "fiscal_authorizations_active_draft" ON "fiscal_authorizations"("companyId","draftId") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "fiscal_authorizations_active_number" ON "fiscal_authorizations"("issuerCuit","pointOfSale","voucherType","voucherNumber") WHERE "status" <> 'REJECTED';
ALTER TABLE "fiscal_authorizations" ADD CONSTRAINT "fiscal_authorizations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_authorizations" ADD CONSTRAINT "fiscal_authorizations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_authorizations" ADD CONSTRAINT "fiscal_authorizations_companyId_draftId_fkey" FOREIGN KEY ("companyId","draftId") REFERENCES "fiscal_drafts"("companyId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
