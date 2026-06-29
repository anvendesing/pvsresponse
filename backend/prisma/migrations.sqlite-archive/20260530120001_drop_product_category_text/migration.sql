-- Remove legacy Product.category free-text column; use categoryId FK only.

PRAGMA foreign_keys=OFF;

CREATE TABLE "Product_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "categoryId" TEXT,
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
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "Product_new" (
    "id","sku","name","type","uom","barcode","state","categoryId","hsn","gstRate",
    "costPrice","sellingPrice","reorderLevel","stockOnHand","batchTracked",
    "description","ingredients","tags","imageHint","imageUrl","createdAt","updatedAt"
)
SELECT
    "id","sku","name","type","uom","barcode","state","categoryId","hsn","gstRate",
    "costPrice","sellingPrice","reorderLevel","stockOnHand","batchTracked",
    "description","ingredients","tags","imageHint","imageUrl","createdAt","updatedAt"
FROM "Product";

DROP TABLE "Product";
ALTER TABLE "Product_new" RENAME TO "Product";

CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

PRAGMA foreign_keys=ON;
