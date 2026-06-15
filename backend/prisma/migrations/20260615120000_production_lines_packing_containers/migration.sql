-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "weightKg" REAL;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN "scanPrefix" TEXT;

-- CreateTable
CREATE TABLE "ProductionLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "facilityId" TEXT NOT NULL,
    "capacityPerHour" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionLine_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContainerType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tareKg" REAL NOT NULL DEFAULT 0,
    "maxKg" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PackingContainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packingSlipId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "containerTypeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "estWeightKg" REAL NOT NULL DEFAULT 0,
    "actualWeightKg" REAL,
    "tareKgOverride" REAL,
    "notes" TEXT,
    "sealedAt" DATETIME,
    "sealedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingContainer_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackingContainer_containerTypeId_fkey" FOREIGN KEY ("containerTypeId") REFERENCES "ContainerType" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PackingContainerItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "containerId" TEXT NOT NULL,
    "packingSlipItemId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PackingContainerItem_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "PackingContainer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PackingContainerItem_packingSlipItemId_fkey" FOREIGN KEY ("packingSlipItemId") REFERENCES "PackingSlipItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "code" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "variantId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "batch" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bin_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bin_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bin_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Bin" ("batch", "bin", "capacity", "code", "createdAt", "id", "occupied", "productId", "qty", "reservedQty", "shelf", "updatedAt", "variantId", "warehouseId", "zone") SELECT "batch", "bin", "capacity", "code", "createdAt", "id", "occupied", "productId", "qty", "reservedQty", "shelf", "updatedAt", "variantId", "warehouseId", "zone" FROM "Bin";
DROP TABLE "Bin";
ALTER TABLE "new_Bin" RENAME TO "Bin";
CREATE UNIQUE INDEX "Bin_code_key" ON "Bin"("code");
CREATE INDEX "Bin_productId_idx" ON "Bin"("productId");
CREATE UNIQUE INDEX "Bin_warehouseId_zone_shelf_bin_key" ON "Bin"("warehouseId", "zone", "shelf", "bin");
CREATE TABLE "new_Bom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "revision" TEXT NOT NULL DEFAULT 'Rev-1.0',
    "outputQty" REAL NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultWorkCenterId" TEXT,
    "defaultFacilityId" TEXT,
    "defaultLineId" TEXT,
    "defaultMachineId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Bom_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultWorkCenterId_fkey" FOREIGN KEY ("defaultWorkCenterId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultFacilityId_fkey" FOREIGN KEY ("defaultFacilityId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultLineId_fkey" FOREIGN KEY ("defaultLineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Bom_defaultMachineId_fkey" FOREIGN KEY ("defaultMachineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Bom" ("active", "createdAt", "defaultMachineId", "defaultWorkCenterId", "id", "outputQty", "productId", "revision", "updatedAt", "variantId") SELECT "active", "createdAt", "defaultMachineId", "defaultWorkCenterId", "id", "outputQty", "productId", "revision", "updatedAt", "variantId" FROM "Bom";
DROP TABLE "Bom";
ALTER TABLE "new_Bom" RENAME TO "Bom";
CREATE INDEX "Bom_productId_idx" ON "Bom"("productId");
CREATE INDEX "Bom_variantId_idx" ON "Bom"("variantId");
CREATE INDEX "Bom_defaultWorkCenterId_idx" ON "Bom"("defaultWorkCenterId");
CREATE INDEX "Bom_defaultFacilityId_idx" ON "Bom"("defaultFacilityId");
CREATE INDEX "Bom_defaultLineId_idx" ON "Bom"("defaultLineId");
CREATE INDEX "Bom_defaultMachineId_idx" ON "Bom"("defaultMachineId");
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
    "packMultiContainerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "packRequireSealConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_CompanyProfile" ("addressLine", "bankAccountNo", "bankBranch", "bankIfsc", "bankName", "cin", "city", "country", "createdAt", "currency", "defaultTaxRate", "email", "fiscalYearStart", "gstin", "id", "industry", "invoicePrefix", "key", "legalName", "logoUrl", "pan", "phone", "pincode", "quotePrefix", "requireMoReleaseBeforeIssue", "state", "termsDefault", "tradeName", "updatedAt", "upi", "website") SELECT "addressLine", "bankAccountNo", "bankBranch", "bankIfsc", "bankName", "cin", "city", "country", "createdAt", "currency", "defaultTaxRate", "email", "fiscalYearStart", "gstin", "id", "industry", "invoicePrefix", "key", "legalName", "logoUrl", "pan", "phone", "pincode", "quotePrefix", "requireMoReleaseBeforeIssue", "state", "termsDefault", "tradeName", "updatedAt", "upi", "website" FROM "CompanyProfile";
DROP TABLE "CompanyProfile";
ALTER TABLE "new_CompanyProfile" RENAME TO "CompanyProfile";
CREATE UNIQUE INDEX "CompanyProfile_key_key" ON "CompanyProfile"("key");
CREATE TABLE "new_Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "customerId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "packingSlipId" TEXT,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "transportCharge" REAL NOT NULL DEFAULT 0,
    "transportTax" REAL NOT NULL DEFAULT 0,
    "totalWeightKg" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentMode" TEXT NOT NULL,
    "dispatchOptionId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Invoice" ("amount", "createdAt", "customerId", "date", "dispatchOptionId", "id", "invoiceNo", "notes", "packingSlipId", "paymentMode", "salesOrderId", "shareToken", "status", "tax", "transportCharge", "transportTax", "updatedAt") SELECT "amount", "createdAt", "customerId", "date", "dispatchOptionId", "id", "invoiceNo", "notes", "packingSlipId", "paymentMode", "salesOrderId", "shareToken", "status", "tax", "transportCharge", "transportTax", "updatedAt" FROM "Invoice";
DROP TABLE "Invoice";
ALTER TABLE "new_Invoice" RENAME TO "Invoice";
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");
CREATE UNIQUE INDEX "Invoice_shareToken_key" ON "Invoice"("shareToken");
CREATE UNIQUE INDEX "Invoice_packingSlipId_key" ON "Invoice"("packingSlipId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");
CREATE INDEX "Invoice_dispatchOptionId_idx" ON "Invoice"("dispatchOptionId");
CREATE TABLE "new_Machine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT,
    "productionLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Machine_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Machine_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Machine" ("active", "code", "createdAt", "description", "id", "name", "status", "updatedAt", "workCenterId") SELECT "active", "code", "createdAt", "description", "id", "name", "status", "updatedAt", "workCenterId" FROM "Machine";
DROP TABLE "Machine";
ALTER TABLE "new_Machine" RENAME TO "Machine";
CREATE UNIQUE INDEX "Machine_code_key" ON "Machine"("code");
CREATE INDEX "Machine_workCenterId_idx" ON "Machine"("workCenterId");
CREATE INDEX "Machine_productionLineId_idx" ON "Machine"("productionLineId");
CREATE INDEX "Machine_active_idx" ON "Machine"("active");
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
    "totalEstWeightKg" REAL NOT NULL DEFAULT 0,
    "totalActualWeightKg" REAL,
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
INSERT INTO "new_PackingSlip" ("assignedToId", "awb", "cancelledAt", "carrier", "claimedAt", "createdAt", "createdById", "deliveredAt", "dispatchedAt", "id", "invoicedAt", "notes", "packedAt", "packingSlipNo", "pickListId", "salesOrderId", "shareToken", "status", "trackingUrl", "updatedAt") SELECT "assignedToId", "awb", "cancelledAt", "carrier", "claimedAt", "createdAt", "createdById", "deliveredAt", "dispatchedAt", "id", "invoicedAt", "notes", "packedAt", "packingSlipNo", "pickListId", "salesOrderId", "shareToken", "status", "trackingUrl", "updatedAt" FROM "PackingSlip";
DROP TABLE "PackingSlip";
ALTER TABLE "new_PackingSlip" RENAME TO "PackingSlip";
CREATE UNIQUE INDEX "PackingSlip_packingSlipNo_key" ON "PackingSlip"("packingSlipNo");
CREATE UNIQUE INDEX "PackingSlip_shareToken_key" ON "PackingSlip"("shareToken");
CREATE UNIQUE INDEX "PackingSlip_pickListId_key" ON "PackingSlip"("pickListId");
CREATE INDEX "PackingSlip_salesOrderId_idx" ON "PackingSlip"("salesOrderId");
CREATE INDEX "PackingSlip_status_idx" ON "PackingSlip"("status");
CREATE INDEX "PackingSlip_assignedToId_idx" ON "PackingSlip"("assignedToId");
CREATE TABLE "new_Product" (
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
    "weightKg" REAL,
    "description" TEXT,
    "ingredients" TEXT,
    "tags" TEXT,
    "imageHint" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Product" ("barcode", "batchTracked", "categoryId", "costPrice", "createdAt", "description", "gstRate", "hsn", "id", "imageHint", "imageUrl", "ingredients", "name", "reorderLevel", "sellingPrice", "sku", "state", "stockOnHand", "tags", "type", "uom", "updatedAt") SELECT "barcode", "batchTracked", "categoryId", "costPrice", "createdAt", "description", "gstRate", "hsn", "id", "imageHint", "imageUrl", "ingredients", "name", "reorderLevel", "sellingPrice", "sku", "state", "stockOnHand", "tags", "type", "uom", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE TABLE "new_ProductionOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNo" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "facilityId" TEXT,
    "lineId" TEXT,
    "plannedQty" REAL NOT NULL,
    "actualQty" REAL NOT NULL DEFAULT 0,
    "scrapQty" REAL NOT NULL DEFAULT 0,
    "reworkQty" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "efficiency" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductionOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProductionOrder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ProductionOrder" ("actualQty", "bomId", "createdAt", "dueDate", "efficiency", "id", "orderNo", "plannedQty", "reworkQty", "scrapQty", "startDate", "station", "status", "updatedAt") SELECT "actualQty", "bomId", "createdAt", "dueDate", "efficiency", "id", "orderNo", "plannedQty", "reworkQty", "scrapQty", "startDate", "station", "status", "updatedAt" FROM "ProductionOrder";
DROP TABLE "ProductionOrder";
ALTER TABLE "new_ProductionOrder" RENAME TO "ProductionOrder";
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");
CREATE INDEX "ProductionOrder_bomId_idx" ON "ProductionOrder"("bomId");
CREATE INDEX "ProductionOrder_facilityId_idx" ON "ProductionOrder"("facilityId");
CREATE INDEX "ProductionOrder_lineId_idx" ON "ProductionOrder"("lineId");
CREATE TABLE "new_Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" DATETIME NOT NULL,
    "subTotal" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "transportCharge" REAL NOT NULL DEFAULT 0,
    "transportTax" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "totalWeightKg" REAL NOT NULL DEFAULT 0,
    "dispatchOptionId" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "acceptedAt" DATETIME,
    "rejectedAt" DATETIME,
    "convertedSalesOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Quote_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Quote" ("acceptedAt", "convertedSalesOrderId", "createdAt", "createdById", "customerId", "dispatchOptionId", "id", "notes", "paymentTerms", "quoteNo", "rejectedAt", "revision", "shareToken", "status", "subTotal", "tax", "total", "transportCharge", "transportTax", "updatedAt", "validUntil") SELECT "acceptedAt", "convertedSalesOrderId", "createdAt", "createdById", "customerId", "dispatchOptionId", "id", "notes", "paymentTerms", "quoteNo", "rejectedAt", "revision", "shareToken", "status", "subTotal", "tax", "total", "transportCharge", "transportTax", "updatedAt", "validUntil" FROM "Quote";
DROP TABLE "Quote";
ALTER TABLE "new_Quote" RENAME TO "Quote";
CREATE UNIQUE INDEX "Quote_quoteNo_key" ON "Quote"("quoteNo");
CREATE UNIQUE INDEX "Quote_shareToken_key" ON "Quote"("shareToken");
CREATE UNIQUE INDEX "Quote_convertedSalesOrderId_key" ON "Quote"("convertedSalesOrderId");
CREATE INDEX "Quote_status_idx" ON "Quote"("status");
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");
CREATE INDEX "Quote_dispatchOptionId_idx" ON "Quote"("dispatchOptionId");
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
    "transportCharge" REAL NOT NULL DEFAULT 0,
    "transportTax" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "totalWeightKg" REAL NOT NULL DEFAULT 0,
    "dispatchOptionId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesOrder_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesOrder" ("createdAt", "customerId", "dispatchOptionId", "id", "notes", "orderDate", "quoteId", "shareToken", "soNo", "source", "status", "subTotal", "tax", "total", "transportCharge", "transportTax", "updatedAt") SELECT "createdAt", "customerId", "dispatchOptionId", "id", "notes", "orderDate", "quoteId", "shareToken", "soNo", "source", "status", "subTotal", "tax", "total", "transportCharge", "transportTax", "updatedAt" FROM "SalesOrder";
DROP TABLE "SalesOrder";
ALTER TABLE "new_SalesOrder" RENAME TO "SalesOrder";
CREATE UNIQUE INDEX "SalesOrder_soNo_key" ON "SalesOrder"("soNo");
CREATE UNIQUE INDEX "SalesOrder_shareToken_key" ON "SalesOrder"("shareToken");
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");
CREATE INDEX "SalesOrder_source_idx" ON "SalesOrder"("source");
CREATE INDEX "SalesOrder_dispatchOptionId_idx" ON "SalesOrder"("dispatchOptionId");
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
    "balance" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "StockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StockLedger_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_StockLedger" ("balance", "bin", "date", "id", "productId", "qty", "ref", "txnType", "variantId", "warehouseId") SELECT "balance", "bin", "date", "id", "productId", "qty", "ref", "txnType", "variantId", "warehouseId" FROM "StockLedger";
DROP TABLE "StockLedger";
ALTER TABLE "new_StockLedger" RENAME TO "StockLedger";
CREATE INDEX "StockLedger_productId_idx" ON "StockLedger"("productId");
CREATE INDEX "StockLedger_variantId_idx" ON "StockLedger"("variantId");
CREATE INDEX "StockLedger_warehouseId_idx" ON "StockLedger"("warehouseId");
CREATE INDEX "StockLedger_txnType_idx" ON "StockLedger"("txnType");
CREATE INDEX "StockLedger_date_idx" ON "StockLedger"("date");
CREATE TABLE "new_WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderNo" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "workers" TEXT NOT NULL,
    "output" REAL NOT NULL DEFAULT 0,
    "target" REAL NOT NULL,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "lineId" TEXT,
    "machineId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WorkOrder" ("createdAt", "endTime", "id", "machine", "output", "productionOrderId", "startTime", "station", "status", "target", "updatedAt", "workOrderNo", "workers") SELECT "createdAt", "endTime", "id", "machine", "output", "productionOrderId", "startTime", "station", "status", "target", "updatedAt", "workOrderNo", "workers" FROM "WorkOrder";
DROP TABLE "WorkOrder";
ALTER TABLE "new_WorkOrder" RENAME TO "WorkOrder";
CREATE UNIQUE INDEX "WorkOrder_workOrderNo_key" ON "WorkOrder"("workOrderNo");
CREATE INDEX "WorkOrder_productionOrderId_idx" ON "WorkOrder"("productionOrderId");
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");
CREATE INDEX "WorkOrder_lineId_idx" ON "WorkOrder"("lineId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProductionLine_code_key" ON "ProductionLine"("code");

-- CreateIndex
CREATE INDEX "ProductionLine_facilityId_idx" ON "ProductionLine"("facilityId");

-- CreateIndex
CREATE INDEX "ProductionLine_active_idx" ON "ProductionLine"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ContainerType_code_key" ON "ContainerType"("code");

-- CreateIndex
CREATE INDEX "ContainerType_active_idx" ON "ContainerType"("active");

-- CreateIndex
CREATE INDEX "PackingContainer_packingSlipId_idx" ON "PackingContainer"("packingSlipId");

-- CreateIndex
CREATE INDEX "PackingContainer_status_idx" ON "PackingContainer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PackingContainer_packingSlipId_seq_key" ON "PackingContainer"("packingSlipId", "seq");

-- CreateIndex
CREATE INDEX "PackingContainerItem_containerId_idx" ON "PackingContainerItem"("containerId");

-- CreateIndex
CREATE INDEX "PackingContainerItem_packingSlipItemId_idx" ON "PackingContainerItem"("packingSlipItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PackingContainerItem_containerId_packingSlipItemId_key" ON "PackingContainerItem"("containerId", "packingSlipItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_scanPrefix_key" ON "Warehouse"("scanPrefix");

