-- Additive draft preparation; no fiscal issuance or rewrite of commercial data.
CREATE UNIQUE INDEX "sales_documents_companyId_id_key" ON "sales_documents"("companyId", "id");
CREATE TABLE "fiscal_drafts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "salesDocumentId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB NOT NULL,
    "createdBy" UUID NOT NULL,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "fiscal_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fiscal_drafts_status_check" CHECK ("status" = 'DRAFT'),
    CONSTRAINT "fiscal_drafts_revision_check" CHECK ("revision" >= 1)
);
CREATE UNIQUE INDEX "fiscal_drafts_companyId_salesDocumentId_key" ON "fiscal_drafts"("companyId", "salesDocumentId");
CREATE INDEX "fiscal_drafts_companyId_createdAt_idx" ON "fiscal_drafts"("companyId", "createdAt");
CREATE INDEX "fiscal_drafts_tenantId_idx" ON "fiscal_drafts"("tenantId");
ALTER TABLE "fiscal_drafts" ADD CONSTRAINT "fiscal_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_drafts" ADD CONSTRAINT "fiscal_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_drafts" ADD CONSTRAINT "fiscal_drafts_companyId_salesDocumentId_fkey" FOREIGN KEY ("companyId", "salesDocumentId") REFERENCES "sales_documents"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
