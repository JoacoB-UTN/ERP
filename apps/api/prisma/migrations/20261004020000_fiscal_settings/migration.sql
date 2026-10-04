CREATE TABLE "fiscal_settings" (
  "companyId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'HOMOLOGATION',
  "vatCondition" TEXT,
  "testPointOfSale" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" UUID NOT NULL,
  "updatedBy" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "fiscal_settings_pkey" PRIMARY KEY ("companyId"),
  CONSTRAINT "fiscal_settings_environment_check" CHECK ("environment" = 'HOMOLOGATION'),
  CONSTRAINT "fiscal_settings_vat_check" CHECK ("vatCondition" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO')),
  CONSTRAINT "fiscal_settings_pos_check" CHECK ("testPointOfSale" BETWEEN 1 AND 99999),
  CONSTRAINT "fiscal_settings_revision_check" CHECK ("revision" >= 1)
);
CREATE INDEX "fiscal_settings_tenantId_idx" ON "fiscal_settings"("tenantId");
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fiscal_settings" ADD CONSTRAINT "fiscal_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
