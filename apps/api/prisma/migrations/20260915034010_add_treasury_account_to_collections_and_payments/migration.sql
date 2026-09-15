-- AlterTable
ALTER TABLE "customer_collections" ADD COLUMN     "treasuryAccountId" UUID;

-- AlterTable
ALTER TABLE "supplier_payments" ADD COLUMN     "treasuryAccountId" UUID;

-- AddForeignKey
ALTER TABLE "customer_collections" ADD CONSTRAINT "customer_collections_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "treasury_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
