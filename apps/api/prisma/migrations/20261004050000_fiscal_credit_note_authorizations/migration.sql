-- CreateTable
CREATE TABLE "fiscal_credit_note_authorizations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "creditNoteDraftId" UUID NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGATION',
    "issuerCuit" TEXT NOT NULL,
    "pointOfSale" INTEGER NOT NULL,
    "voucherType" INTEGER NOT NULL,
    "voucherNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "request" JSONB NOT NULL,
    "cae" TEXT,
    "expiresAt" TEXT,
    "message" TEXT NOT NULL,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fiscal_credit_note_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fiscal_credit_note_authorizations_companyId_creditNoteDraft_idx" ON "fiscal_credit_note_authorizations"("companyId", "creditNoteDraftId", "createdAt");

-- CreateIndex
CREATE INDEX "fiscal_credit_note_authorizations_issuerCuit_pointOfSale_vo_idx" ON "fiscal_credit_note_authorizations"("issuerCuit", "pointOfSale", "voucherType", "status");

-- CreateIndex
CREATE INDEX "fiscal_credit_note_authorizations_tenantId_idx" ON "fiscal_credit_note_authorizations"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_credit_note_drafts_companyId_id_key" ON "fiscal_credit_note_drafts"("companyId", "id");

-- AddForeignKey
ALTER TABLE "fiscal_credit_note_authorizations" ADD CONSTRAINT "fiscal_credit_note_authorizations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_credit_note_authorizations" ADD CONSTRAINT "fiscal_credit_note_authorizations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_credit_note_authorizations" ADD CONSTRAINT "fiscal_credit_note_authorizations_companyId_creditNoteDraf_fkey" FOREIGN KEY ("companyId", "creditNoteDraftId") REFERENCES "fiscal_credit_note_drafts"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fiscal_credit_note_authorizations"
 ADD CONSTRAINT "fiscal_nc_authorizations_state_check" CHECK ("status" IN ('SENDING','UNKNOWN','AUTHORIZED','REJECTED')),
 ADD CONSTRAINT "fiscal_nc_authorizations_environment_check" CHECK ("environment" = 'HOMOLOGATION'),
 ADD CONSTRAINT "fiscal_nc_authorizations_number_check" CHECK ("voucherNumber" BETWEEN 1 AND 99999999 AND "pointOfSale" BETWEEN 1 AND 99999 AND "voucherType" IN (3,8,13) AND "draftRevision" > 0),
 ADD CONSTRAINT "fiscal_nc_authorizations_cae_check" CHECK (("status" = 'AUTHORIZED' AND "cae" IS NOT NULL AND "expiresAt" IS NOT NULL AND "cae" ~ '^[0-9]{14}$' AND "expiresAt" ~ '^[0-9]{8}$') OR ("status" <> 'AUTHORIZED' AND "cae" IS NULL AND "expiresAt" IS NULL));
CREATE UNIQUE INDEX "fiscal_nc_authorizations_pending_series" ON "fiscal_credit_note_authorizations"("issuerCuit","pointOfSale","voucherType") WHERE "status" IN ('SENDING','UNKNOWN');
CREATE UNIQUE INDEX "fiscal_nc_authorizations_active_draft" ON "fiscal_credit_note_authorizations"("companyId","creditNoteDraftId") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "fiscal_nc_authorizations_active_number" ON "fiscal_credit_note_authorizations"("issuerCuit","pointOfSale","voucherType","voucherNumber") WHERE "status" <> 'REJECTED';
