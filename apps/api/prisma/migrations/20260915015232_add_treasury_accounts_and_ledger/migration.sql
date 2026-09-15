-- CreateEnum
CREATE TYPE "TreasuryAccountType" AS ENUM ('CASH_BOX', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "TreasuryMovementType" AS ENUM ('OPENING_BALANCE', 'COLLECTION', 'COLLECTION_REVERSAL', 'PAYMENT', 'PAYMENT_REVERSAL', 'TRANSFER_IN', 'TRANSFER_OUT', 'TRANSFER_IN_REVERSAL', 'TRANSFER_OUT_REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "treasury_accounts" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TreasuryAccountType" NOT NULL,
    "currencyId" UUID NOT NULL,
    "allowsNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "cbu" TEXT,
    "alias" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,

    CONSTRAINT "treasury_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "treasuryAccountId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "movementType" "TreasuryMovementType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "reversalOfId" UUID,
    "description" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "treasury_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_account_balances" (
    "companyId" UUID NOT NULL,
    "treasuryAccountId" UUID NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "treasury_account_balances_pkey" PRIMARY KEY ("companyId","treasuryAccountId")
);

-- CreateIndex
CREATE INDEX "treasury_accounts_tenantId_idx" ON "treasury_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "treasury_accounts_companyId_active_idx" ON "treasury_accounts"("companyId", "active");

-- CreateIndex
CREATE INDEX "treasury_accounts_branchId_idx" ON "treasury_accounts"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_accounts_companyId_code_key" ON "treasury_accounts"("companyId", "code");

-- CreateIndex
CREATE INDEX "treasury_movements_tenantId_idx" ON "treasury_movements"("tenantId");

-- CreateIndex
CREATE INDEX "treasury_movements_companyId_treasuryAccountId_occurredAt_idx" ON "treasury_movements"("companyId", "treasuryAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "treasury_movements_companyId_sourceType_sourceId_idx" ON "treasury_movements"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_movements_companyId_sourceType_sourceId_movementTy_key" ON "treasury_movements"("companyId", "sourceType", "sourceId", "movementType");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_account_balances_treasuryAccountId_key" ON "treasury_account_balances"("treasuryAccountId");

-- AddForeignKey
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_accounts" ADD CONSTRAINT "treasury_accounts_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_movements" ADD CONSTRAINT "treasury_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "treasury_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_account_balances" ADD CONSTRAINT "treasury_account_balances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_account_balances" ADD CONSTRAINT "treasury_account_balances_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
