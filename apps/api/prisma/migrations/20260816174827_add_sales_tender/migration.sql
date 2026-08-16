-- CreateEnum
CREATE TYPE "SalesTenderMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- CreateTable
CREATE TABLE "sales_tenders" (
    "id" UUID NOT NULL,
    "salesDocumentId" UUID NOT NULL,
    "method" "SalesTenderMethod" NOT NULL,
    "amountApplied" DECIMAL(19,4) NOT NULL,
    "amountReceived" DECIMAL(19,4),
    "reference" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "sales_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_tenders_salesDocumentId_key" ON "sales_tenders"("salesDocumentId");

-- AddForeignKey
ALTER TABLE "sales_tenders" ADD CONSTRAINT "sales_tenders_salesDocumentId_fkey" FOREIGN KEY ("salesDocumentId") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
