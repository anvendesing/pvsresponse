-- Catch-up migration that captures every schema change applied via
-- `prisma db push` since the last checked-in migration. Includes:
--   * Bin.code / scannable code
--   * Vendor address/email/paymentTerms
--   * Quote/Invoice/PurchaseOrder.shareToken
--   * Grn driver/truckNo/receivedBy + GrnItem
--   * UomCategory + Uom
--   * CustomerAccount (storefront login)
--   * WorkCenter + Machine + Bom defaults
--   * Trip + DispatchOrder.tripId
--   * BinCount + ScanEvent
--   * CompanyProfile (singleton)
--   * SalesOrder.source (internal | ecommerce)
--   * PackingSlip.awb / carrier / trackingUrl / dispatchedAt / deliveredAt
--   * PickList / PackingSlip assignedToId + claimedAt
--   * ProductVariant.uom + packSize
--   * Worker.userId

-- AlterTable
ALTER TABLE "Bin" ADD COLUMN "code" TEXT;

-- AlterTable
ALTER TABLE "Grn" ADD COLUMN "driver" TEXT;
ALTER TABLE "Grn" ADD COLUMN "receivedBy" TEXT;
ALTER TABLE "Grn" ADD COLUMN "truckNo" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "shareToken" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "shareToken" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "shareToken" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "address" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "email" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "paymentTerms" TEXT;

-- CreateTable
CREATE TABLE "UomCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Uom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factor" REAL NOT NULL DEFAULT 1.0,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rounding" REAL NOT NULL DEFAULT 0.001,
    "categoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Uom_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UomCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grnId" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "receivedQty" REAL NOT NULL,
    "rejectedQty" REAL NOT NULL DEFAULT 0,
    "remarks" TEXT,
    CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GrnItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacityPerHour" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Machine_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripNo" TEXT NOT NULL,
    "scheduledDate" DATETIME NOT NULL,
    "vehicle" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "route" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "capacityKg" REAL NOT NULL DEFAULT 1000,
    "notes" TEXT,
    "createdById" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "rolledOverFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BinCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "binId" TEXT NOT NULL,
    "productIdBefore" TEXT,
    "productIdAfter" TEXT,
    "qtyBefore" REAL NOT NULL,
    "qtyAfter" REAL NOT NULL,
    "delta" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "countedById" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BinCount_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BinCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "context" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScanEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "revision" TEXT NOT NULL DEFAULT 'Rev-1.0',
    "outputQty" REAL NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultWorkCenterId" TEXT,
    "defaultMachineId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bom_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultWorkCenterId_fkey" FOREIGN KEY ("defaultWorkCenterId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultMachineId_fkey" FOREIGN KEY ("defaultMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Bom" ("active", "createdAt", "id", "outputQty", "productId", "revision", "updatedAt") SELECT "active", "createdAt", "id", "outputQty", "productId", "revision", "updatedAt" FROM "Bom";
DROP TABLE "Bom";
ALTER TABLE "new_Bom" RENAME TO "Bom";
CREATE INDEX "Bom_productId_idx" ON "Bom"("productId");
CREATE INDEX "Bom_variantId_idx" ON "Bom"("variantId");
CREATE INDEX "Bom_defaultWorkCenterId_idx" ON "Bom"("defaultWorkCenterId");
CREATE INDEX "Bom_defaultMachineId_idx" ON "Bom"("defaultMachineId");
CREATE TABLE "new_DispatchOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dispatchNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "vehicle" TEXT,
    "driver" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "etaHours" INTEGER NOT NULL DEFAULT 0,
    "weightKg" REAL NOT NULL DEFAULT 0,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" DATETIME,
    "photoUrl" TEXT,
    "tripId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DispatchOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DispatchOrder_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DispatchOrder" ("createdAt", "destination", "dispatchNo", "driver", "etaHours", "id", "invoiceId", "otpVerified", "photoUrl", "signedAt", "status", "updatedAt", "vehicle", "weightKg") SELECT "createdAt", "destination", "dispatchNo", "driver", "etaHours", "id", "invoiceId", "otpVerified", "photoUrl", "signedAt", "status", "updatedAt", "vehicle", "weightKg" FROM "DispatchOrder";
DROP TABLE "DispatchOrder";
ALTER TABLE "new_DispatchOrder" RENAME TO "DispatchOrder";
CREATE UNIQUE INDEX "DispatchOrder_dispatchNo_key" ON "DispatchOrder"("dispatchNo");
CREATE INDEX "DispatchOrder_invoiceId_idx" ON "DispatchOrder"("invoiceId");
CREATE INDEX "DispatchOrder_status_idx" ON "DispatchOrder"("status");
CREATE INDEX "DispatchOrder_tripId_idx" ON "DispatchOrder"("tripId");
CREATE TABLE "new_PackingSlip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packingSlipNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "salesOrderId" TEXT NOT NULL,
    "pickListId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "claimedAt" DATETIME,
    "awb" TEXT,
    "carrier" TEXT,
    "trackingUrl" TEXT,
    "dispatchedAt" DATETIME,
    "deliveredAt" DATETIME,
    "packedAt" DATETIME,
    "invoicedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingSlip_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PackingSlip_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PackingSlip_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PackingSlip" ("cancelledAt", "createdAt", "createdById", "id", "invoicedAt", "notes", "packedAt", "packingSlipNo", "pickListId", "salesOrderId", "status", "updatedAt") SELECT "cancelledAt", "createdAt", "createdById", "id", "invoicedAt", "notes", "packedAt", "packingSlipNo", "pickListId", "salesOrderId", "status", "updatedAt" FROM "PackingSlip";
DROP TABLE "PackingSlip";
ALTER TABLE "new_PackingSlip" RENAME TO "PackingSlip";
CREATE UNIQUE INDEX "PackingSlip_packingSlipNo_key" ON "PackingSlip"("packingSlipNo");
CREATE UNIQUE INDEX "PackingSlip_shareToken_key" ON "PackingSlip"("shareToken");
CREATE UNIQUE INDEX "PackingSlip_pickListId_key" ON "PackingSlip"("pickListId");
CREATE INDEX "PackingSlip_salesOrderId_idx" ON "PackingSlip"("salesOrderId");
CREATE INDEX "PackingSlip_status_idx" ON "PackingSlip"("status");
CREATE INDEX "PackingSlip_assignedToId_idx" ON "PackingSlip"("assignedToId");
CREATE TABLE "new_PickList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pickListNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "claimedAt" DATETIME,
    "pickedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PickList_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PickList_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PickList" ("cancelledAt", "createdAt", "createdById", "id", "notes", "pickListNo", "pickedAt", "salesOrderId", "status", "updatedAt") SELECT "cancelledAt", "createdAt", "createdById", "id", "notes", "pickListNo", "pickedAt", "salesOrderId", "status", "updatedAt" FROM "PickList";
DROP TABLE "PickList";
ALTER TABLE "new_PickList" RENAME TO "PickList";
CREATE UNIQUE INDEX "PickList_pickListNo_key" ON "PickList"("pickListNo");
CREATE INDEX "PickList_salesOrderId_idx" ON "PickList"("salesOrderId");
CREATE INDEX "PickList_status_idx" ON "PickList"("status");
CREATE INDEX "PickList_assignedToId_idx" ON "PickList"("assignedToId");
CREATE TABLE "new_ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "size" TEXT,
    "color" TEXT,
    "grade" TEXT,
    "uom" TEXT,
    "packSize" REAL NOT NULL DEFAULT 1,
    "costPriceOverride" REAL,
    "sellingPriceOverride" REAL,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductVariant" ("active", "barcode", "color", "costPriceOverride", "createdAt", "grade", "id", "productId", "sellingPriceOverride", "size", "sku", "stockOnHand", "updatedAt") SELECT "active", "barcode", "color", "costPriceOverride", "createdAt", "grade", "id", "productId", "sellingPriceOverride", "size", "sku", "stockOnHand", "updatedAt" FROM "ProductVariant";
DROP TABLE "ProductVariant";
ALTER TABLE "new_ProductVariant" RENAME TO "ProductVariant";
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE TABLE "new_SalesOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "soNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "quoteId" TEXT,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT 'internal',
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subTotal" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesOrder" ("createdAt", "customerId", "id", "notes", "orderDate", "quoteId", "soNo", "status", "subTotal", "tax", "total", "updatedAt") SELECT "createdAt", "customerId", "id", "notes", "orderDate", "quoteId", "soNo", "status", "subTotal", "tax", "total", "updatedAt" FROM "SalesOrder";
DROP TABLE "SalesOrder";
ALTER TABLE "new_SalesOrder" RENAME TO "SalesOrder";
CREATE UNIQUE INDEX "SalesOrder_soNo_key" ON "SalesOrder"("soNo");
CREATE UNIQUE INDEX "SalesOrder_shareToken_key" ON "SalesOrder"("shareToken");
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");
CREATE INDEX "SalesOrder_source_idx" ON "SalesOrder"("source");
CREATE TABLE "new_Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "empNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'A',
    "status" TEXT NOT NULL DEFAULT 'out',
    "unitsToday" REAL NOT NULL DEFAULT 0,
    "targetToday" REAL NOT NULL DEFAULT 0,
    "efficiency" REAL NOT NULL DEFAULT 0,
    "rejectionRate" REAL NOT NULL DEFAULT 0,
    "hoursToday" REAL NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Worker" ("active", "createdAt", "efficiency", "empNo", "hoursToday", "id", "name", "rejectionRate", "shift", "station", "status", "targetToday", "unitsToday", "updatedAt") SELECT "active", "createdAt", "efficiency", "empNo", "hoursToday", "id", "name", "rejectionRate", "shift", "station", "status", "targetToday", "unitsToday", "updatedAt" FROM "Worker";
DROP TABLE "Worker";
ALTER TABLE "new_Worker" RENAME TO "Worker";
CREATE UNIQUE INDEX "Worker_empNo_key" ON "Worker"("empNo");
CREATE UNIQUE INDEX "Worker_userId_key" ON "Worker"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "UomCategory_code_key" ON "UomCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Uom_code_key" ON "Uom"("code");

-- CreateIndex
CREATE INDEX "Uom_categoryId_idx" ON "Uom"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_email_key" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "CustomerAccount_email_idx" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "GrnItem_poItemId_idx" ON "GrnItem"("poItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_code_key" ON "WorkCenter"("code");

-- CreateIndex
CREATE INDEX "WorkCenter_active_idx" ON "WorkCenter"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_code_key" ON "Machine"("code");

-- CreateIndex
CREATE INDEX "Machine_workCenterId_idx" ON "Machine"("workCenterId");

-- CreateIndex
CREATE INDEX "Machine_active_idx" ON "Machine"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tripNo_key" ON "Trip"("tripNo");

-- CreateIndex
CREATE INDEX "Trip_scheduledDate_idx" ON "Trip"("scheduledDate");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE INDEX "BinCount_binId_idx" ON "BinCount"("binId");

-- CreateIndex
CREATE INDEX "BinCount_flagged_idx" ON "BinCount"("flagged");

-- CreateIndex
CREATE INDEX "BinCount_createdAt_idx" ON "BinCount"("createdAt");

-- CreateIndex
CREATE INDEX "ScanEvent_userId_createdAt_idx" ON "ScanEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanEvent_code_idx" ON "ScanEvent"("code");

-- CreateIndex
CREATE INDEX "ScanEvent_createdAt_idx" ON "ScanEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_key_key" ON "CompanyProfile"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_code_key" ON "Bin"("code");

-- CreateIndex
CREATE INDEX "Grn_qcStatus_idx" ON "Grn"("qcStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shareToken_key" ON "Invoice"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_shareToken_key" ON "PurchaseOrder"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_shareToken_key" ON "Quote"("shareToken");
