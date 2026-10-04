CREATE UNIQUE INDEX "fiscal_authorizations_companyId_id_key" ON "fiscal_authorizations"("companyId", "id");
CREATE TABLE "fiscal_credit_note_drafts" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "originalAuthorizationId" UUID NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'HOMOLOGATION', "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "revision" INTEGER NOT NULL DEFAULT 1, "reason" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "createdBy" UUID NOT NULL, "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "fiscal_credit_note_drafts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fiscal_credit_note_drafts_preparation_check" CHECK ("environment" = 'HOMOLOGATION' AND "status" = 'DRAFT' AND "revision" > 0),
  CONSTRAINT "fiscal_credit_note_drafts_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 5 AND 500)
);
CREATE UNIQUE INDEX "fiscal_credit_note_drafts_companyId_originalAuthorizationId_key" ON "fiscal_credit_note_drafts"("companyId", "originalAuthorizationId");
CREATE INDEX "fiscal_credit_note_drafts_tenantId_idx" ON "fiscal_credit_note_drafts"("tenantId");
ALTER TABLE "fiscal_credit_note_drafts" ADD CONSTRAINT "fiscal_credit_note_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_credit_note_drafts" ADD CONSTRAINT "fiscal_credit_note_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_credit_note_drafts" ADD CONSTRAINT "fiscal_credit_note_drafts_companyId_originalAuthorizationI_fkey" FOREIGN KEY ("companyId", "originalAuthorizationId") REFERENCES "fiscal_authorizations"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
