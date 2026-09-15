-- CreateEnum
CREATE TYPE "TreasuryTransferStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "treasury_transfer_sequences" (
    "companyId" UUID NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "treasury_transfer_sequences_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "treasury_transfers" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "sourceAccountId" UUID NOT NULL,
    "destinationAccountId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "notes" TEXT,
    "status" "TreasuryTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "confirmedBy" UUID,
    "cancelledBy" UUID,

    CONSTRAINT "treasury_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "treasury_transfers_tenantId_idx" ON "treasury_transfers"("tenantId");

-- CreateIndex
CREATE INDEX "treasury_transfers_companyId_status_idx" ON "treasury_transfers"("companyId", "status");

-- CreateIndex
CREATE INDEX "treasury_transfers_companyId_sourceAccountId_idx" ON "treasury_transfers"("companyId", "sourceAccountId");

-- CreateIndex
CREATE INDEX "treasury_transfers_companyId_destinationAccountId_idx" ON "treasury_transfers"("companyId", "destinationAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_transfers_companyId_number_key" ON "treasury_transfers"("companyId", "number");

-- AddForeignKey
ALTER TABLE "treasury_transfer_sequences" ADD CONSTRAINT "treasury_transfer_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "treasury_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "treasury_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_transfers" ADD CONSTRAINT "treasury_transfers_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
