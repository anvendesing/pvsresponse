-- CreateTable
CREATE TABLE "BomByproduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qty" REAL NOT NULL,
    "uom" TEXT NOT NULL,
    "costShare" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "BomByproduct_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BomByproduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BomByproduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BomByproduct_bomId_idx" ON "BomByproduct"("bomId");
CREATE INDEX "BomByproduct_productId_idx" ON "BomByproduct"("productId");
