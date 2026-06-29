-- AlterTable
ALTER TABLE "CreditNoteItem" ADD COLUMN "gstRate" REAL DEFAULT 18;
ALTER TABLE "CreditNoteItem" ADD COLUMN "taxAmount" REAL;

-- AlterTable
ALTER TABLE "InvoiceItem" ADD COLUMN "gstRate" REAL DEFAULT 18;
ALTER TABLE "InvoiceItem" ADD COLUMN "taxAmount" REAL;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "gstRate" REAL;
ALTER TABLE "ProductVariant" ADD COLUMN "hsn" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "category" TEXT NOT NULL,
    "hsn" TEXT NOT NULL,
    "gstRate" REAL NOT NULL DEFAULT 18,
    "costPrice" REAL NOT NULL,
    "sellingPrice" REAL NOT NULL,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "ingredients" TEXT,
    "tags" TEXT,
    "imageHint" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Product" ("barcode", "batchTracked", "category", "costPrice", "createdAt", "description", "hsn", "id", "imageHint", "imageUrl", "ingredients", "name", "reorderLevel", "sellingPrice", "sku", "state", "stockOnHand", "tags", "type", "uom", "updatedAt") SELECT "barcode", "batchTracked", "category", "costPrice", "createdAt", "description", "hsn", "id", "imageHint", "imageUrl", "ingredients", "name", "reorderLevel", "sellingPrice", "sku", "state", "stockOnHand", "tags", "type", "uom", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
