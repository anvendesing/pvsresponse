-- Add date-bound pricing revision columns to PriceListItem.
--
-- Revisions intentionally stack: multiple rows with the same
-- (priceListId, productId, variantId, minQty) can exist with different
-- validFrom/validUntil windows.  The resolver picks the row whose window
-- covers "now" with the newest validFrom.
--
-- Steps:
--   1. Add nullable validFrom / validUntil columns.
--   2. Drop the old UNIQUE constraint (revisions must be able to share the
--      same composite key).
--   3. Create a plain (non-unique) index for the same columns so queries
--      that filter by (priceList, product, variant, minQty) stay fast.

-- AlterTable
ALTER TABLE "PriceListItem" ADD COLUMN "validFrom" DATETIME;
ALTER TABLE "PriceListItem" ADD COLUMN "validUntil" DATETIME;

-- DropIndex (was UNIQUE — revisions must share the composite key)
DROP INDEX "PriceListItem_priceListId_productId_variantId_minQty_key";

-- CreateIndex (non-unique replacement)
CREATE INDEX "PriceListItem_priceListId_productId_variantId_minQty_idx" ON "PriceListItem"("priceListId", "productId", "variantId", "minQty");
