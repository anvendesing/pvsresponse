-- CreateTable
CREATE TABLE "PutawayRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "toWarehouseId" TEXT NOT NULL,
    "toBinId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PutawayRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PutawayRule_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PutawayRule_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PutawayRule_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "productionOrderId" TEXT,
    "assignedToId" TEXT,
    "claimedAt" DATETIME,
    "pickedById" TEXT,
    "pickedAt" DATETIME,
    "droppedById" TEXT,
    "droppedAt" DATETIME,
    "cancelledAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransferOrder_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferOrder_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferOrder_pickedById_fkey" FOREIGN KEY ("pickedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferOrder_droppedById_fkey" FOREIGN KEY ("droppedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransferOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtyRequested" REAL NOT NULL,
    "qtyPicked" REAL NOT NULL DEFAULT 0,
    "qtyDropped" REAL NOT NULL DEFAULT 0,
    "fromBinId" TEXT,
    "toBinId" TEXT,
    "notes" TEXT,
    CONSTRAINT "TransferOrderItem_transferOrderId_fkey" FOREIGN KEY ("transferOrderId") REFERENCES "TransferOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransferOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransferOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferOrderItem_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransferOrderItem_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CompanyProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL DEFAULT 'default',
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "cin" TEXT,
    "industry" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoUrl" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "quotePrefix" TEXT NOT NULL DEFAULT 'Q',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "fiscalYearStart" TEXT NOT NULL DEFAULT '04-01',
    "defaultTaxRate" REAL NOT NULL DEFAULT 18,
    "termsDefault" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "bankBranch" TEXT,
    "upi" TEXT,
    "requireMoReleaseBeforeIssue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CompanyProfile" ("addressLine", "bankAccountNo", "bankBranch", "bankIfsc", "bankName", "cin", "city", "country", "createdAt", "currency", "defaultTaxRate", "email", "fiscalYearStart", "gstin", "id", "industry", "invoicePrefix", "key", "legalName", "logoUrl", "pan", "phone", "pincode", "quotePrefix", "state", "termsDefault", "tradeName", "updatedAt", "upi", "website") SELECT "addressLine", "bankAccountNo", "bankBranch", "bankIfsc", "bankName", "cin", "city", "country", "createdAt", "currency", "defaultTaxRate", "email", "fiscalYearStart", "gstin", "id", "industry", "invoicePrefix", "key", "legalName", "logoUrl", "pan", "phone", "pincode", "quotePrefix", "state", "termsDefault", "tradeName", "updatedAt", "upi", "website" FROM "CompanyProfile";
DROP TABLE "CompanyProfile";
ALTER TABLE "new_CompanyProfile" RENAME TO "CompanyProfile";
CREATE UNIQUE INDEX "CompanyProfile_key_key" ON "CompanyProfile"("key");
CREATE TABLE "new_Warehouse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'storage',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Warehouse" ("active", "city", "code", "createdAt", "id", "name", "updatedAt") SELECT "active", "city", "code", "createdAt", "id", "name", "updatedAt" FROM "Warehouse";
DROP TABLE "Warehouse";
ALTER TABLE "new_Warehouse" RENAME TO "Warehouse";
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");
CREATE TABLE "new_WorkCenter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacityPerHour" REAL,
    "productionLineWarehouseId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkCenter_productionLineWarehouseId_fkey" FOREIGN KEY ("productionLineWarehouseId") REFERENCES "Warehouse" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkCenter" ("active", "capacityPerHour", "code", "createdAt", "description", "id", "name", "updatedAt") SELECT "active", "capacityPerHour", "code", "createdAt", "description", "id", "name", "updatedAt" FROM "WorkCenter";
DROP TABLE "WorkCenter";
ALTER TABLE "new_WorkCenter" RENAME TO "WorkCenter";
CREATE UNIQUE INDEX "WorkCenter_code_key" ON "WorkCenter"("code");
CREATE UNIQUE INDEX "WorkCenter_productionLineWarehouseId_key" ON "WorkCenter"("productionLineWarehouseId");
CREATE INDEX "WorkCenter_active_idx" ON "WorkCenter"("active");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PutawayRule_productId_idx" ON "PutawayRule"("productId");

-- CreateIndex
CREATE INDEX "PutawayRule_variantId_idx" ON "PutawayRule"("variantId");

-- CreateIndex
CREATE INDEX "PutawayRule_toWarehouseId_idx" ON "PutawayRule"("toWarehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferOrder_transferNo_key" ON "TransferOrder"("transferNo");

-- CreateIndex
CREATE INDEX "TransferOrder_status_idx" ON "TransferOrder"("status");

-- CreateIndex
CREATE INDEX "TransferOrder_kind_idx" ON "TransferOrder"("kind");

-- CreateIndex
CREATE INDEX "TransferOrder_productionOrderId_idx" ON "TransferOrder"("productionOrderId");

-- CreateIndex
CREATE INDEX "TransferOrder_fromWarehouseId_idx" ON "TransferOrder"("fromWarehouseId");

-- CreateIndex
CREATE INDEX "TransferOrder_toWarehouseId_idx" ON "TransferOrder"("toWarehouseId");

-- CreateIndex
CREATE INDEX "TransferOrder_assignedToId_idx" ON "TransferOrder"("assignedToId");

-- CreateIndex
CREATE INDEX "TransferOrderItem_transferOrderId_idx" ON "TransferOrderItem"("transferOrderId");

-- CreateIndex
CREATE INDEX "TransferOrderItem_productId_idx" ON "TransferOrderItem"("productId");
