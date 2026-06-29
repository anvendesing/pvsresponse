-- CreateTable
CREATE TABLE "PickList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pickListNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "pickedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PickList_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PickListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pickListId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "binId" TEXT,
    "qtyToPick" REAL NOT NULL,
    "qtyPicked" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    CONSTRAINT "PickListItem_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickListItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PickListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PickListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PickListItem_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingSlip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packingSlipNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "pickListId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "packedAt" DATETIME,
    "invoicedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingSlip_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackingSlip_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingSlipItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packingSlipId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtyOrdered" REAL NOT NULL,
    "qtyPicked" REAL NOT NULL,
    "qtyPacked" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "notes" TEXT,
    CONSTRAINT "PackingSlipItem_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackingSlipItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackingSlipItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackingSlipItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "batch" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bin_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bin_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Bin" ("batch", "bin", "capacity", "createdAt", "id", "occupied", "productId", "qty", "rack", "shelf", "updatedAt", "warehouseId", "zone") SELECT "batch", "bin", "capacity", "createdAt", "id", "occupied", "productId", "qty", "rack", "shelf", "updatedAt", "warehouseId", "zone" FROM "Bin";
DROP TABLE "Bin";
ALTER TABLE "new_Bin" RENAME TO "Bin";
CREATE INDEX "Bin_productId_idx" ON "Bin"("productId");
CREATE UNIQUE INDEX "Bin_warehouseId_zone_rack_shelf_bin_key" ON "Bin"("warehouseId", "zone", "rack", "shelf", "bin");
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "packingSlipId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentMode" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amount", "createdAt", "customerId", "date", "id", "invoiceNo", "notes", "paymentMode", "salesOrderId", "status", "tax", "updatedAt") SELECT "amount", "createdAt", "customerId", "date", "id", "invoiceNo", "notes", "paymentMode", "salesOrderId", "status", "tax", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");
CREATE UNIQUE INDEX "Invoice_packingSlipId_key" ON "Invoice"("packingSlipId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");
CREATE TABLE "new_InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "salesOrderItemId" TEXT,
    "packingSlipItemId" TEXT,
    "qty" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InvoiceItem_packingSlipItemId_fkey" FOREIGN KEY ("packingSlipItemId") REFERENCES "PackingSlipItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InvoiceItem" ("amount", "id", "invoiceId", "productId", "qty", "rate", "salesOrderItemId", "variantId") SELECT "amount", "id", "invoiceId", "productId", "qty", "rate", "salesOrderItemId", "variantId" FROM "InvoiceItem";
DROP TABLE "InvoiceItem";
ALTER TABLE "new_InvoiceItem" RENAME TO "InvoiceItem";
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE INDEX "InvoiceItem_variantId_idx" ON "InvoiceItem"("variantId");
CREATE INDEX "InvoiceItem_salesOrderItemId_idx" ON "InvoiceItem"("salesOrderItemId");
CREATE INDEX "InvoiceItem_packingSlipItemId_idx" ON "InvoiceItem"("packingSlipItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PickList_pickListNo_key" ON "PickList"("pickListNo");

-- CreateIndex
CREATE INDEX "PickList_salesOrderId_idx" ON "PickList"("salesOrderId");

-- CreateIndex
CREATE INDEX "PickList_status_idx" ON "PickList"("status");

-- CreateIndex
CREATE INDEX "PickListItem_pickListId_idx" ON "PickListItem"("pickListId");

-- CreateIndex
CREATE INDEX "PickListItem_salesOrderItemId_idx" ON "PickListItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "PickListItem_productId_idx" ON "PickListItem"("productId");

-- CreateIndex
CREATE INDEX "PickListItem_binId_idx" ON "PickListItem"("binId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingSlip_packingSlipNo_key" ON "PackingSlip"("packingSlipNo");

-- CreateIndex
CREATE UNIQUE INDEX "PackingSlip_pickListId_key" ON "PackingSlip"("pickListId");

-- CreateIndex
CREATE INDEX "PackingSlip_salesOrderId_idx" ON "PackingSlip"("salesOrderId");

-- CreateIndex
CREATE INDEX "PackingSlip_status_idx" ON "PackingSlip"("status");

-- CreateIndex
CREATE INDEX "PackingSlipItem_packingSlipId_idx" ON "PackingSlipItem"("packingSlipId");

-- CreateIndex
CREATE INDEX "PackingSlipItem_salesOrderItemId_idx" ON "PackingSlipItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "PackingSlipItem_productId_idx" ON "PackingSlipItem"("productId");
