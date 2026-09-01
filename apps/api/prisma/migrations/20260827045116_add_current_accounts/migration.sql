-- CreateEnum
CREATE TYPE "CustomerAccountMovementType" AS ENUM ('SALE_CHARGE', 'TENDER_SETTLEMENT', 'COLLECTION', 'COLLECTION_REVERSAL', 'CREDIT_NOTE', 'DEBIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "SupplierAccountMovementType" AS ENUM ('PURCHASE_RECEIPT_ACCRUAL', 'PURCHASE_RECEIPT_REVERSAL', 'SUPPLIER_PAYMENT', 'SUPPLIER_PAYMENT_REVERSAL', 'PURCHASE_INVOICE', 'PURCHASE_CREDIT_NOTE', 'OPENING_BALANCE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CustomerCollectionStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_account_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "movementType" "CustomerAccountMovementType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "reversalOfId" UUID,
    "description" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_account_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_account_movements" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "movementType" "SupplierAccountMovementType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "reversalOfId" UUID,
    "description" TEXT,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_account_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_collection_sequences" (
    "companyId" UUID NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customer_collection_sequences_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "customer_collections" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentMethod" "SalesTenderMethod" NOT NULL,
    "externalReference" TEXT,
    "notes" TEXT,
    "status" "CustomerCollectionStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "confirmedBy" UUID,
    "cancelledBy" UUID,

    CONSTRAINT "customer_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_collection_applications" (
    "id" UUID NOT NULL,
    "customerCollectionId" UUID NOT NULL,
    "salesDocumentId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_collection_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_sequences" (
    "companyId" UUID NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_payment_sequences_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "currencyId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "paymentMethod" "SalesTenderMethod" NOT NULL,
    "externalReference" TEXT,
    "notes" TEXT,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'DRAFT',
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdBy" UUID,
    "confirmedBy" UUID,
    "cancelledBy" UUID,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_applications" (
    "id" UUID NOT NULL,
    "supplierPaymentId" UUID NOT NULL,
    "purchaseReceiptId" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_account_movements_tenantId_idx" ON "customer_account_movements"("tenantId");

-- CreateIndex
CREATE INDEX "customer_account_movements_companyId_customerId_currencyId_idx" ON "customer_account_movements"("companyId", "customerId", "currencyId");

-- CreateIndex
CREATE INDEX "customer_account_movements_companyId_customerId_currencyId__idx" ON "customer_account_movements"("companyId", "customerId", "currencyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_movements_companyId_sourceType_sourceId_mo_key" ON "customer_account_movements"("companyId", "sourceType", "sourceId", "movementType");

-- CreateIndex
CREATE INDEX "supplier_account_movements_tenantId_idx" ON "supplier_account_movements"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_account_movements_companyId_supplierId_currencyId_idx" ON "supplier_account_movements"("companyId", "supplierId", "currencyId");

-- CreateIndex
CREATE INDEX "supplier_account_movements_companyId_supplierId_currencyId__idx" ON "supplier_account_movements"("companyId", "supplierId", "currencyId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_account_movements_companyId_sourceType_sourceId_mo_key" ON "supplier_account_movements"("companyId", "sourceType", "sourceId", "movementType");

-- CreateIndex
CREATE INDEX "customer_collections_tenantId_idx" ON "customer_collections"("tenantId");

-- CreateIndex
CREATE INDEX "customer_collections_companyId_status_idx" ON "customer_collections"("companyId", "status");

-- CreateIndex
CREATE INDEX "customer_collections_companyId_customerId_idx" ON "customer_collections"("companyId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_collections_companyId_number_key" ON "customer_collections"("companyId", "number");

-- CreateIndex
CREATE INDEX "customer_collection_applications_customerCollectionId_idx" ON "customer_collection_applications"("customerCollectionId");

-- CreateIndex
CREATE INDEX "customer_collection_applications_salesDocumentId_idx" ON "customer_collection_applications"("salesDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_collection_applications_customerCollectionId_sales_key" ON "customer_collection_applications"("customerCollectionId", "salesDocumentId");

-- CreateIndex
CREATE INDEX "supplier_payments_tenantId_idx" ON "supplier_payments"("tenantId");

-- CreateIndex
CREATE INDEX "supplier_payments_companyId_status_idx" ON "supplier_payments"("companyId", "status");

-- CreateIndex
CREATE INDEX "supplier_payments_companyId_supplierId_idx" ON "supplier_payments"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_companyId_number_key" ON "supplier_payments"("companyId", "number");

-- CreateIndex
CREATE INDEX "supplier_payment_applications_supplierPaymentId_idx" ON "supplier_payment_applications"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "supplier_payment_applications_purchaseReceiptId_idx" ON "supplier_payment_applications"("purchaseReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_applications_supplierPaymentId_purchaseRec_key" ON "supplier_payment_applications"("supplierPaymentId", "purchaseReceiptId");

-- AddForeignKey
ALTER TABLE "customer_account_movements" ADD CONSTRAINT "customer_account_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_account_movements" ADD CONSTRAINT "customer_account_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_account_movements" ADD CONSTRAINT "customer_account_movements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_account_movements" ADD CONSTRAINT "customer_account_movements_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_account_movements" ADD CONSTRAINT "customer_account_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "customer_account_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_account_movements" ADD CONSTRAINT "supplier_account_movements_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "supplier_account_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collection_sequences" ADD CONSTRAINT "customer_collection_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collection_applications" ADD CONSTRAINT "customer_collection_applications_customerCollectionId_fkey" FOREIGN KEY ("customerCollectionId") REFERENCES "customer_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_collection_applications" ADD CONSTRAINT "customer_collection_applications_salesDocumentId_fkey" FOREIGN KEY ("salesDocumentId") REFERENCES "sales_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_sequences" ADD CONSTRAINT "supplier_payment_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_applications" ADD CONSTRAINT "supplier_payment_applications_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_applications" ADD CONSTRAINT "supplier_payment_applications_purchaseReceiptId_fkey" FOREIGN KEY ("purchaseReceiptId") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
