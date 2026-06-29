-- StockLedger.variantId — optional pointer to the ProductVariant a
-- ledger row applies to. Populated by variant-scoped flows (e.g.
-- producing the 250ml CAOL variant from a variant-scoped BOM) so the
-- ledger UI can distinguish parent / bulk movements from variant
-- movements that previously all rendered as just the parent SKU.
ALTER TABLE "StockLedger" ADD COLUMN "variantId" TEXT;

CREATE INDEX "StockLedger_variantId_idx" ON "StockLedger"("variantId");
