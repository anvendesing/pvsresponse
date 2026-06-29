-- StockRule: min-qty triggers for auto-MO and auto-transfer
-- TransferOrder.tags: team routing on transfer tasks

ALTER TABLE "TransferOrder" ADD COLUMN "tags" TEXT;

CREATE TABLE "StockRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "monitorBinId" TEXT NOT NULL,
    "minQty" REAL NOT NULL,
    "triggerType" TEXT NOT NULL,
    "bomId" TEXT,
    "sourceBinId" TEXT,
    "toWarehouseId" TEXT,
    "toBinId" TEXT,
    "tags" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRule_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_monitorBinId_fkey" FOREIGN KEY ("monitorBinId") REFERENCES "Bin" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockRule_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_sourceBinId_fkey" FOREIGN KEY ("sourceBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockRule_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "StockRule_productId_idx" ON "StockRule"("productId");
CREATE INDEX "StockRule_variantId_idx" ON "StockRule"("variantId");
CREATE INDEX "StockRule_monitorBinId_idx" ON "StockRule"("monitorBinId");
CREATE INDEX "StockRule_active_idx" ON "StockRule"("active");
CREATE INDEX "StockRule_triggerType_idx" ON "StockRule"("triggerType");
