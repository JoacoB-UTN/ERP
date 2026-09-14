-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_transfer_sequences" (
    "companyId" UUID NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stock_transfer_sequences_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "sourceWarehouseId" UUID NOT NULL,
    "destinationWarehouseId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "confirmedAt" TIMESTAMPTZ(6),
    "confirmedBy" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelledBy" UUID,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "stockTransferId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "quantity" DECIMAL(19,6) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_idx" ON "stock_transfers"("tenantId");

-- CreateIndex
CREATE INDEX "stock_transfers_companyId_status_idx" ON "stock_transfers"("companyId", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_sourceWarehouseId_idx" ON "stock_transfers"("sourceWarehouseId");

-- CreateIndex
CREATE INDEX "stock_transfers_destinationWarehouseId_idx" ON "stock_transfers"("destinationWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_companyId_number_key" ON "stock_transfers"("companyId", "number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_stockTransferId_idx" ON "stock_transfer_lines"("stockTransferId");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_productVariantId_idx" ON "stock_transfer_lines"("productVariantId");

-- AddForeignKey
ALTER TABLE "stock_transfer_sequences" ADD CONSTRAINT "stock_transfer_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_destinationWarehouseId_fkey" FOREIGN KEY ("destinationWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_stockTransferId_fkey" FOREIGN KEY ("stockTransferId") REFERENCES "stock_transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
