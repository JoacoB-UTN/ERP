-- Brand becomes ProductLine.
--
-- Written by hand as a pure rename rather than let Prisma diff it: a
-- generated diff for a renamed model is DROP TABLE "brands" + CREATE TABLE
-- "product_lines", which silently discards every row and nulls
-- products."brandId" on the way out. Everything below is metadata-only --
-- no row is read or rewritten -- so it is also instant on a large catalog.
--
-- Every product in this catalog is the same brand, so a brand column
-- classified nothing; the line (ORO, PLATA, DUAL DUTY, ...) is the axis
-- that actually varies. Same columns, same company-scoped unique name,
-- same optional relation to products -- only the name changes, so whatever
-- a customer had already classified survives.

ALTER TABLE "brands" RENAME TO "product_lines";

ALTER TABLE "product_lines" RENAME CONSTRAINT "brands_pkey" TO "product_lines_pkey";
ALTER TABLE "product_lines" RENAME CONSTRAINT "brands_tenantId_fkey" TO "product_lines_tenantId_fkey";
ALTER TABLE "product_lines" RENAME CONSTRAINT "brands_companyId_fkey" TO "product_lines_companyId_fkey";

ALTER INDEX "brands_tenantId_idx" RENAME TO "product_lines_tenantId_idx";
ALTER INDEX "brands_companyId_idx" RENAME TO "product_lines_companyId_idx";
ALTER INDEX "brands_companyId_normalizedName_key" RENAME TO "product_lines_companyId_normalizedName_key";

ALTER TABLE "products" RENAME COLUMN "brandId" TO "lineId";
ALTER TABLE "products" RENAME CONSTRAINT "products_brandId_fkey" TO "products_lineId_fkey";
ALTER INDEX "products_brandId_idx" RENAME TO "products_lineId_idx";
