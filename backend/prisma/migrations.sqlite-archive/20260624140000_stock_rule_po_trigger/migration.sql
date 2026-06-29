-- Stock rules: global PO trigger (vendor-grouped auto purchase orders)

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_StockRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "monitorBinId" TEXT,
    "minQty" REAL NOT NULL,
    "triggerType" TEXT NOT NULL,
    "bomId" TEXT,
    "sourceBinId" TEXT,
    "toWarehouseId" TEXT,
    "toBinId" TEXT,
    "tags" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "vendorId" TEXT,
    "maxQty" REAL,
    "orderMultiple" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRule_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_monitorBinId_fkey" FOREIGN KEY ("monitorBinId") REFERENCES "Bin" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRule_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_sourceBinId_fkey" FOREIGN KEY ("sourceBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_StockRule" (
    "id", "productId", "variantId", "monitorBinId", "minQty", "triggerType",
    "bomId", "sourceBinId", "toWarehouseId", "toBinId", "tags", "active", "notes",
    "vendorId", "maxQty", "orderMultiple", "createdAt", "updatedAt"
)
SELECT
    "id", "productId", "variantId", "monitorBinId", "minQty", "triggerType",
    "bomId", "sourceBinId", "toWarehouseId", "toBinId", "tags", "active", "notes",
    NULL, NULL, NULL, "createdAt", "updatedAt"
FROM "StockRule";

DROP TABLE "StockRule";
ALTER TABLE "new_StockRule" RENAME TO "StockRule";

CREATE INDEX "StockRule_productId_idx" ON "StockRule"("productId");
CREATE INDEX "StockRule_variantId_idx" ON "StockRule"("variantId");
CREATE INDEX "StockRule_monitorBinId_idx" ON "StockRule"("monitorBinId");
CREATE INDEX "StockRule_active_idx" ON "StockRule"("active");
CREATE INDEX "StockRule_triggerType_idx" ON "StockRule"("triggerType");
CREATE INDEX "StockRule_vendorId_idx" ON "StockRule"("vendorId");

PRAGMA foreign_keys=ON;
