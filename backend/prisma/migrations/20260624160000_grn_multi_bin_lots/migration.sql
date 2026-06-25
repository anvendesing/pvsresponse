-- Allow multiple stock lots (multi-bin split) per GRN line

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_StockLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "batchNo" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" DATETIME,
    "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT NOT NULL,
    "binId" TEXT,
    "grnItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLot_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockLot_grnItemId_fkey" FOREIGN KEY ("grnItemId") REFERENCES "GrnItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_StockLot" SELECT * FROM "StockLot";

DROP TABLE "StockLot";
ALTER TABLE "new_StockLot" RENAME TO "StockLot";

CREATE INDEX "StockLot_grnItemId_idx" ON "StockLot"("grnItemId");
CREATE INDEX "StockLot_productId_receivedAt_idx" ON "StockLot"("productId", "receivedAt");
CREATE INDEX "StockLot_productId_qtyOnHand_idx" ON "StockLot"("productId", "qtyOnHand");
CREATE INDEX "StockLot_warehouseId_idx" ON "StockLot"("warehouseId");
CREATE INDEX "StockLot_binId_idx" ON "StockLot"("binId");
CREATE INDEX "StockLot_batchNo_idx" ON "StockLot"("batchNo");

PRAGMA foreign_keys=ON;
