-- Vendor supplier catalog + PO line vendor-side snapshots

CREATE TABLE "VendorProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "vendorProductCode" TEXT,
    "vendorProductName" TEXT,
    "vendorUom" TEXT NOT NULL,
    "packSize" REAL NOT NULL DEFAULT 1,
    "price" REAL NOT NULL DEFAULT 0,
    "minOrderQty" REAL NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendorProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VendorProduct_vendorId_productId_variantId_key" ON "VendorProduct"("vendorId", "productId", "variantId");
CREATE INDEX "VendorProduct_vendorId_idx" ON "VendorProduct"("vendorId");
CREATE INDEX "VendorProduct_productId_idx" ON "VendorProduct"("productId");
CREATE INDEX "VendorProduct_variantId_idx" ON "VendorProduct"("variantId");

ALTER TABLE "PurchaseOrderItem" ADD COLUMN "vendorProductId" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "vendorQty" REAL;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "vendorUom" TEXT;
ALTER TABLE "PurchaseOrderItem" ADD COLUMN "vendorRate" REAL;

CREATE INDEX "PurchaseOrderItem_vendorProductId_idx" ON "PurchaseOrderItem"("vendorProductId");
