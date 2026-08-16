-- CreateEnum
CREATE TYPE "SalesDocumentType" AS ENUM ('SALE');

-- CreateEnum
CREATE TYPE "SalesDocumentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "sales_document_sequences" (
    "companyId" UUID NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sales_document_sequences_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "sales_documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "documentType" "SalesDocumentType" NOT NULL DEFAULT 'SALE',
    "number" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "status" "SalesDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "confirmedBy" UUID,
    "cancelledBy" UUID,

    CONSTRAINT "sales_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_document_lines" (
    "id" UUID NOT NULL,
    "salesDocumentId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "unitPrice" DECIMAL(19,4) NOT NULL,
    "discountPercentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_documents_tenantId_idx" ON "sales_documents"("tenantId");

-- CreateIndex
CREATE INDEX "sales_documents_companyId_status_idx" ON "sales_documents"("companyId", "status");

-- CreateIndex
CREATE INDEX "sales_documents_companyId_customerId_idx" ON "sales_documents"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "sales_documents_companyId_warehouseId_idx" ON "sales_documents"("companyId", "warehouseId");

-- CreateIndex
CREATE INDEX "sales_documents_companyId_occurredAt_idx" ON "sales_documents"("companyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "sales_documents_companyId_number_key" ON "sales_documents"("companyId", "number");

-- CreateIndex
CREATE INDEX "sales_document_lines_salesDocumentId_idx" ON "sales_document_lines"("salesDocumentId");

-- CreateIndex
CREATE INDEX "sales_document_lines_productVariantId_idx" ON "sales_document_lines"("productVariantId");

-- AddForeignKey
ALTER TABLE "sales_document_sequences" ADD CONSTRAINT "sales_document_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_documents" ADD CONSTRAINT "sales_documents_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_salesDocumentId_fkey" FOREIGN KEY ("salesDocumentId") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_document_lines" ADD CONSTRAINT "sales_document_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
