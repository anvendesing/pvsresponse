-- Add variantId to Bin so each bin can be tagged with a specific
-- ProductVariant (when the parent product has variants). Resolves
-- the long-standing ambiguity where two bins under the same parent
-- could each hold a different variant but ATP / Inventory Locations
-- couldn't disambiguate them.
ALTER TABLE "Bin" ADD COLUMN "variantId" TEXT REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Bin_variantId_idx" ON "Bin"("variantId");

-- Auto-backfill: for any bin whose parent product has variants and
-- whose qty matches exactly one variant's stockOnHand, tag that bin
-- with that variant. Ambiguous cases (qty matches no variant or
-- multiple variants) are left untagged for the operator to resolve
-- via the bin editor / a stock recount. This is intentionally
-- conservative — wrong auto-tagging would silently misroute future
-- picks, so we only act when the data is unambiguous.
UPDATE "Bin"
SET "variantId" = (
  SELECT pv."id"
  FROM "ProductVariant" pv
  WHERE pv."productId" = "Bin"."productId"
    AND pv."stockOnHand" = "Bin"."qty"
    AND pv."active" = 1
    AND (
      SELECT COUNT(*) FROM "ProductVariant" pv2
      WHERE pv2."productId" = "Bin"."productId"
        AND pv2."stockOnHand" = "Bin"."qty"
        AND pv2."active" = 1
    ) = 1
)
WHERE "Bin"."productId" IS NOT NULL
  AND "Bin"."qty" > 0
  AND EXISTS (
    SELECT 1 FROM "ProductVariant" pv
    WHERE pv."productId" = "Bin"."productId"
      AND pv."active" = 1
  );
