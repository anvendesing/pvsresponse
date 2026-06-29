-- Add ProductCategory master table and Product.categoryId FK column.
-- Legacy Product.category (free-text) is kept until backfill + follow-up migration.

PRAGMA foreign_keys=OFF;

CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ProductCategory_slug_key" ON "ProductCategory"("slug");

ALTER TABLE "Product" ADD COLUMN "categoryId" TEXT;

CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

PRAGMA foreign_keys=ON;
