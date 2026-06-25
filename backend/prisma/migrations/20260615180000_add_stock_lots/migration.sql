-- Stock lots for GRN traceability + FIFO raw-material issue.

-- AlterTable GrnItem
ALTER TABLE "GrnItem" ADD COLUMN "batchNo" TEXT;
ALTER TABLE "GrnItem" ADD COLUMN "expiryDate" DATETIME;

-- AlterTable StockLedger
ALTER TABLE "StockLedger" ADD COLUMN "batch" TEXT;
ALTER TABLE "StockLedger" ADD COLUMN "lotId" TEXT;

-- CreateTable StockLot
CREATE TABLE "StockLot" (
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

CREATE UNIQUE INDEX "StockLot_grnItemId_key" ON "StockLot"("grnItemId");
CREATE INDEX "StockLot_productId_receivedAt_idx" ON "StockLot"("productId", "receivedAt");
CREATE INDEX "StockLot_productId_qtyOnHand_idx" ON "StockLot"("productId", "qtyOnHand");
CREATE INDEX "StockLot_warehouseId_idx" ON "StockLot"("warehouseId");
CREATE INDEX "StockLot_binId_idx" ON "StockLot"("binId");
CREATE INDEX "StockLot_batchNo_idx" ON "StockLot"("batchNo");

CREATE INDEX "StockLedger_lotId_idx" ON "StockLedger"("lotId");
CREATE INDEX "StockLedger_batch_idx" ON "StockLedger"("batch");

-- RedefineTables (StockLedger lot FK)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_StockLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "txnType" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "bin" TEXT,
    "batch" TEXT,
    "lotId" TEXT,
    "balance" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "StockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_StockLedger" ("id", "date", "productId", "variantId", "txnType", "ref", "qty", "warehouseId", "bin", "batch", "lotId", "balance") SELECT "id", "date", "productId", "variantId", "txnType", "ref", "qty", "warehouseId", "bin", NULL, NULL, "balance" FROM "StockLedger";
DROP TABLE "StockLedger";
ALTER TABLE "new_StockLedger" RENAME TO "StockLedger";
CREATE INDEX "StockLedger_productId_idx" ON "StockLedger"("productId");
CREATE INDEX "StockLedger_variantId_idx" ON "StockLedger"("variantId");
CREATE INDEX "StockLedger_warehouseId_idx" ON "StockLedger"("warehouseId");
CREATE INDEX "StockLedger_txnType_idx" ON "StockLedger"("txnType");
CREATE INDEX "StockLedger_date_idx" ON "StockLedger"("date");
CREATE INDEX "StockLedger_lotId_idx" ON "StockLedger"("lotId");
CREATE INDEX "StockLedger_batch_idx" ON "StockLedger"("batch");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
