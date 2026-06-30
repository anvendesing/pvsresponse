-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pin" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UomCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UomCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Uom" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "factor" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rounding" DOUBLE PRECISION NOT NULL DEFAULT 0.001,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "scanPrefix" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'storage',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConcern" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConcernLink" (
    "productId" TEXT NOT NULL,
    "concernId" TEXT NOT NULL,

    CONSTRAINT "ProductConcernLink_pkey" PRIMARY KEY ("productId","concernId")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',
    "categoryId" TEXT,
    "hsn" TEXT NOT NULL,
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "costPrice" DOUBLE PRECISION NOT NULL,
    "sellingPrice" DOUBLE PRECISION NOT NULL,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "weightKg" DOUBLE PRECISION,
    "description" TEXT,
    "ingredients" TEXT,
    "tags" TEXT,
    "imageHint" TEXT,
    "imageUrl" TEXT,
    "ecommerceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceListEnabled" BOOLEAN NOT NULL DEFAULT true,
    "bestSellerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "hsn" TEXT,
    "gstRate" DOUBLE PRECISION,
    "size" TEXT,
    "color" TEXT,
    "grade" TEXT,
    "uom" TEXT,
    "packSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "weightKg" DOUBLE PRECISION,
    "costPriceOverride" DOUBLE PRECISION,
    "sellingPriceOverride" DOUBLE PRECISION,
    "stockOnHand" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ecommerceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "priceListEnabled" BOOLEAN NOT NULL DEFAULT true,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gst" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "city" TEXT NOT NULL,
    "paymentTerms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorProduct" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "vendorProductCode" TEXT,
    "vendorProductName" TEXT,
    "vendorUom" TEXT NOT NULL,
    "packSize" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "minOrderQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "leadTimeDays" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gst" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "distanceKm" DOUBLE PRECISION,
    "dispatchPincode" TEXT,
    "contact" TEXT,
    "creditLimit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceListId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "enquiryNo" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'product',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT NOT NULL DEFAULT 'walk_in',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "contactName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "city" TEXT,
    "subject" TEXT NOT NULL,
    "requirement" TEXT,
    "estimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedCloseDate" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "customerId" TEXT,
    "assignedToId" TEXT,
    "createdById" TEXT,
    "convertedQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryItem" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "description" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,

    CONSTRAINT "EnquiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryActivity" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "outcome" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnquiryActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "paymentNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "gateway" TEXT,
    "gatewayPaymentId" TEXT,
    "gatewayOrderId" TEXT,
    "notes" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phoneVerifiedAt" TIMESTAMP(3),
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "state" TEXT,
    "pincode" TEXT NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "dispatchPincode" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpToken" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsProviderConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL DEFAULT 'smsidea',
    "mode" TEXT NOT NULL DEFAULT 'test',
    "username" TEXT,
    "password" TEXT,
    "senderId" TEXT,
    "templateId" TEXT,
    "templateText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShiprocketConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "email" TEXT,
    "password" TEXT,
    "pickupPincode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShiprocketConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevOtpLog" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevOtpLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayOrderId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "email" TEXT,
    "phone" TEXT,
    "cartSnapshot" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'test',
    "keyId" TEXT,
    "keySecret" TEXT,
    "webhookSecret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "basis" TEXT NOT NULL DEFAULT 'selling',
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "minQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "receivedPct" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "received" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vendorProductId" TEXT,
    "vendorQty" DOUBLE PRECISION,
    "vendorUom" TEXT,
    "vendorRate" DOUBLE PRECISION,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grn" (
    "id" TEXT NOT NULL,
    "grnNo" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qcStatus" TEXT NOT NULL DEFAULT 'pending',
    "truckNo" TEXT,
    "driver" TEXT,
    "notes" TEXT,
    "receivedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrnItem" (
    "id" TEXT NOT NULL,
    "grnId" TEXT NOT NULL,
    "poItemId" TEXT NOT NULL,
    "receivedQty" DOUBLE PRECISION NOT NULL,
    "rejectedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remarks" TEXT,
    "batchNo" TEXT,
    "expiryDate" TIMESTAMP(3),

    CONSTRAINT "GrnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "batchNo" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
    "warehouseId" TEXT NOT NULL,
    "binId" TEXT,
    "grnItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bom" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "revision" TEXT NOT NULL DEFAULT 'Rev-1.0',
    "outputQty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultWorkCenterId" TEXT,
    "defaultFacilityId" TEXT,
    "defaultLineId" TEXT,
    "defaultMachineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "operationDependencies" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Bom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomItem" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "bomOperationId" TEXT,
    "productId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL,
    "scrapPct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "BomItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomOperation" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "facilityId" TEXT,
    "lineId" TEXT,
    "machineId" TEXT,
    "durationMinutes" DOUBLE PRECISION,
    "requiresQa" BOOLEAN NOT NULL DEFAULT true,
    "blockedByOperationId" TEXT,

    CONSTRAINT "BomOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomOperationLine" (
    "id" TEXT NOT NULL,
    "bomOperationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,

    CONSTRAINT "BomOperationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomByproduct" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL,
    "costShare" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "BomByproduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "facilityId" TEXT,
    "lineId" TEXT,
    "plannedQty" DOUBLE PRECISION NOT NULL,
    "actualQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reworkQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "startDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "workOrderNo" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "machine" TEXT NOT NULL,
    "workers" TEXT NOT NULL,
    "output" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "target" DOUBLE PRECISION NOT NULL,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'queued',
    "bomOperationId" TEXT,
    "splitSeq" INTEGER NOT NULL DEFAULT 0,
    "plannedSplitQty" DOUBLE PRECISION,
    "blockedByWorkOrderId" TEXT,
    "qaStatus" TEXT,
    "qaNotes" TEXT,
    "lineId" TEXT,
    "machineId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderRun" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "lineId" TEXT,
    "batchSeq" INTEGER NOT NULL DEFAULT 1,
    "plannedQty" DOUBLE PRECISION,
    "inputQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "operator" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderRunByproduct" (
    "id" TEXT NOT NULL,
    "workOrderRunId" TEXT NOT NULL,
    "bomByproductId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WorkOrderRunByproduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkCenter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacityPerHour" DOUBLE PRECISION,
    "productionLineWarehouseId" TEXT,
    "productionZone" TEXT,
    "replenishWarehouseCodes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "facilityId" TEXT NOT NULL,
    "capacityPerHour" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workCenterId" TEXT,
    "productionLineId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "empNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'A',
    "status" TEXT NOT NULL DEFAULT 'out',
    "unitsToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rejectionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hoursToday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "inAt" TIMESTAMP(3),
    "outAt" TIMESTAMP(3),
    "shift" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PutawayRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "toWarehouseId" TEXT NOT NULL,
    "toZone" TEXT,
    "toBinId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PutawayRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockRule" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "monitorBinId" TEXT,
    "minQty" DOUBLE PRECISION NOT NULL,
    "maxQty" DOUBLE PRECISION,
    "orderMultiple" DOUBLE PRECISION,
    "triggerType" TEXT NOT NULL,
    "vendorId" TEXT,
    "bomId" TEXT,
    "sourceBinId" TEXT,
    "toWarehouseId" TEXT,
    "toBinId" TEXT,
    "tags" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOrder" (
    "id" TEXT NOT NULL,
    "transferNo" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "fromWarehouseId" TEXT NOT NULL,
    "toWarehouseId" TEXT NOT NULL,
    "productionOrderId" TEXT,
    "assignedToId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "pickedById" TEXT,
    "pickedAt" TIMESTAMP(3),
    "droppedById" TEXT,
    "droppedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "notes" TEXT,
    "tags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferOrderItem" (
    "id" TEXT NOT NULL,
    "transferOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtyRequested" DOUBLE PRECISION NOT NULL,
    "qtyPicked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtyDropped" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fromBinId" TEXT,
    "toBinId" TEXT,
    "notes" TEXT,

    CONSTRAINT "TransferOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "txnType" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "bin" TEXT,
    "batch" TEXT,
    "lotId" TEXT,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "customerId" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "packingSlipId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxKind" TEXT NOT NULL DEFAULT 'intra',
    "placeOfSupplyState" TEXT,
    "sellerState" TEXT,
    "pricingInclusive" BOOLEAN NOT NULL DEFAULT false,
    "transportCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transportTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentMode" TEXT NOT NULL,
    "dispatchOptionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "salesOrderItemId" TEXT,
    "packingSlipItemId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxableValue" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION DEFAULT 18,
    "taxAmount" DOUBLE PRECISION,
    "cgstAmount" DOUBLE PRECISION,
    "sgstAmount" DOUBLE PRECISION,
    "igstAmount" DOUBLE PRECISION,

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOrder" (
    "id" TEXT NOT NULL,
    "dispatchNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "vehicle" TEXT,
    "driver" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "etaHours" INTEGER NOT NULL DEFAULT 0,
    "weightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "signedAt" TIMESTAMP(3),
    "photoUrl" TEXT,
    "tripId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "tripNo" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "vehicle" TEXT NOT NULL,
    "driver" TEXT NOT NULL,
    "route" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "capacityKg" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "notes" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rolledOverFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchOption" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "defaultCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMapping" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "internalSku" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "validUntil" TIMESTAMP(3) NOT NULL,
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxKind" TEXT NOT NULL DEFAULT 'intra',
    "placeOfSupplyState" TEXT,
    "sellerState" TEXT,
    "pricingInclusive" BOOLEAN NOT NULL DEFAULT false,
    "transportCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transportTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dispatchOptionId" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "convertedSalesOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteItem" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxableValue" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION,
    "cgstAmount" DOUBLE PRECISION,
    "sgstAmount" DOUBLE PRECISION,
    "igstAmount" DOUBLE PRECISION,
    "requiredBy" TIMESTAMP(3),

    CONSTRAINT "QuoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteRevision" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "soNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "quoteId" TEXT,
    "customerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "source" TEXT NOT NULL DEFAULT 'internal',
    "externalChannel" TEXT,
    "externalRef" TEXT,
    "externalAwb" TEXT,
    "externalInvoiceNo" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxKind" TEXT NOT NULL DEFAULT 'intra',
    "placeOfSupplyState" TEXT,
    "sellerState" TEXT,
    "pricingInclusive" BOOLEAN NOT NULL DEFAULT false,
    "transportCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transportTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dispatchOptionId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderItem" (
    "id" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtyOrdered" DOUBLE PRECISION NOT NULL,
    "qtyInvoiced" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qtyCancelled" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxableValue" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION,
    "cgstAmount" DOUBLE PRECISION,
    "sgstAmount" DOUBLE PRECISION,
    "igstAmount" DOUBLE PRECISION,

    CONSTRAINT "SalesOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderReservation" (
    "id" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickList" (
    "id" TEXT NOT NULL,
    "pickListNo" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "pickedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PickList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickListItem" (
    "id" TEXT NOT NULL,
    "pickListId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "binId" TEXT,
    "qtyToPick" DOUBLE PRECISION NOT NULL,
    "qtyPicked" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "PickListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingSlip" (
    "id" TEXT NOT NULL,
    "packingSlipNo" TEXT NOT NULL,
    "shareToken" TEXT,
    "salesOrderId" TEXT NOT NULL,
    "pickListId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "awb" TEXT,
    "carrier" TEXT,
    "trackingUrl" TEXT,
    "totalEstWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalActualWeightKg" DOUBLE PRECISION,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "packedAt" TIMESTAMP(3),
    "invoicedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingSlipItem" (
    "id" TEXT NOT NULL,
    "packingSlipId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qtyOrdered" DOUBLE PRECISION NOT NULL,
    "qtyPicked" DOUBLE PRECISION NOT NULL,
    "qtyPacked" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PackingSlipItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContainerType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tareKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxKg" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainerType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingContainer" (
    "id" TEXT NOT NULL,
    "packingSlipId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "containerTypeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "estWeightKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualWeightKg" DOUBLE PRECISION,
    "tareKgOverride" DOUBLE PRECISION,
    "notes" TEXT,
    "sealedAt" TIMESTAMP(3),
    "sealedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingContainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackingContainerItem" (
    "id" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "packingSlipItemId" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackingContainerItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'med',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BinCount" (
    "id" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "productIdBefore" TEXT,
    "productIdAfter" TEXT,
    "qtyBefore" DOUBLE PRECISION NOT NULL,
    "qtyAfter" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "remarks" TEXT,
    "countedById" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BinCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "context" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerActivity" (
    "id" TEXT NOT NULL,
    "anonId" TEXT NOT NULL,
    "customerId" TEXT,
    "sessionId" TEXT,
    "event" TEXT NOT NULL,
    "path" TEXT,
    "referer" TEXT,
    "productId" TEXT,
    "meta" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEventLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origin" TEXT NOT NULL DEFAULT 'server',

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tombstone" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tombstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT,
    "lastPulledAt" TIMESTAMP(3),
    "lastPushedAt" TIMESTAMP(3),
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "clientPayload" TEXT NOT NULL,
    "serverPayload" TEXT NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'server-wins',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
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
    "defaultTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "pricingIncludesGst" BOOLEAN NOT NULL DEFAULT false,
    "termsDefault" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankIfsc" TEXT,
    "bankBranch" TEXT,
    "upi" TEXT,
    "requireMoReleaseBeforeIssue" BOOLEAN NOT NULL DEFAULT false,
    "packMultiContainerEnabled" BOOLEAN NOT NULL DEFAULT true,
    "packRequireSealConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "pickSortByBinEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReturn" (
    "id" TEXT NOT NULL,
    "returnNo" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "source" TEXT NOT NULL DEFAULT 'excel',
    "notes" TEXT,
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerReturnItem" (
    "id" TEXT NOT NULL,
    "customerReturnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "invoiceItemId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonNotes" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerReturnId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "customerPaymentId" TEXT,
    "subTotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "cgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxKind" TEXT NOT NULL DEFAULT 'intra',
    "placeOfSupplyState" TEXT,
    "sellerState" TEXT,
    "pricingInclusive" BOOLEAN NOT NULL DEFAULT false,
    "total" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteItem" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qty" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "taxableValue" DOUBLE PRECISION,
    "gstRate" DOUBLE PRECISION DEFAULT 18,
    "taxAmount" DOUBLE PRECISION,
    "cgstAmount" DOUBLE PRECISION,
    "sgstAmount" DOUBLE PRECISION,
    "igstAmount" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "returnItemId" TEXT,

    CONSTRAINT "CreditNoteItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UomCategory_code_key" ON "UomCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Uom_code_key" ON "Uom"("code");

-- CreateIndex
CREATE INDEX "Uom_categoryId_idx" ON "Uom"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_scanPrefix_key" ON "Warehouse"("scanPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_code_key" ON "Bin"("code");

-- CreateIndex
CREATE INDEX "Bin_productId_idx" ON "Bin"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_warehouseId_zone_shelf_bin_key" ON "Bin"("warehouseId", "zone", "shelf", "bin");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_slug_key" ON "ProductCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ProductConcern_slug_key" ON "ProductConcern"("slug");

-- CreateIndex
CREATE INDEX "ProductConcernLink_concernId_idx" ON "ProductConcernLink"("concernId");

-- CreateIndex
CREATE INDEX "ProductConcernLink_productId_idx" ON "ProductConcernLink"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

-- CreateIndex
CREATE INDEX "VendorProduct_vendorId_idx" ON "VendorProduct"("vendorId");

-- CreateIndex
CREATE INDEX "VendorProduct_productId_idx" ON "VendorProduct"("productId");

-- CreateIndex
CREATE INDEX "VendorProduct_variantId_idx" ON "VendorProduct"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorProduct_vendorId_productId_variantId_key" ON "VendorProduct"("vendorId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_priceListId_idx" ON "Customer"("priceListId");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_enquiryNo_key" ON "Enquiry"("enquiryNo");

-- CreateIndex
CREATE INDEX "Enquiry_stage_idx" ON "Enquiry"("stage");

-- CreateIndex
CREATE INDEX "Enquiry_type_idx" ON "Enquiry"("type");

-- CreateIndex
CREATE INDEX "Enquiry_assignedToId_idx" ON "Enquiry"("assignedToId");

-- CreateIndex
CREATE INDEX "Enquiry_customerId_idx" ON "Enquiry"("customerId");

-- CreateIndex
CREATE INDEX "Enquiry_nextFollowUpAt_idx" ON "Enquiry"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "EnquiryItem_enquiryId_idx" ON "EnquiryItem"("enquiryId");

-- CreateIndex
CREATE INDEX "EnquiryActivity_enquiryId_idx" ON "EnquiryActivity"("enquiryId");

-- CreateIndex
CREATE INDEX "EnquiryActivity_dueAt_idx" ON "EnquiryActivity"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_paymentNo_key" ON "CustomerPayment"("paymentNo");

-- CreateIndex
CREATE INDEX "CustomerPayment_customerId_idx" ON "CustomerPayment"("customerId");

-- CreateIndex
CREATE INDEX "CustomerPayment_paymentDate_idx" ON "CustomerPayment"("paymentDate");

-- CreateIndex
CREATE INDEX "CustomerPaymentAllocation_invoiceId_idx" ON "CustomerPaymentAllocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentAllocation_paymentId_invoiceId_key" ON "CustomerPaymentAllocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_customerId_key" ON "CustomerAccount"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerAccount_phone_key" ON "CustomerAccount"("phone");

-- CreateIndex
CREATE INDEX "CustomerAccount_email_idx" ON "CustomerAccount"("email");

-- CreateIndex
CREATE INDEX "CustomerAccount_phone_idx" ON "CustomerAccount"("phone");

-- CreateIndex
CREATE INDEX "CustomerAddress_customerId_idx" ON "CustomerAddress"("customerId");

-- CreateIndex
CREATE INDEX "OtpToken_phone_purpose_expiresAt_idx" ON "OtpToken"("phone", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "DevOtpLog_phone_createdAt_idx" ON "DevOtpLog"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_gatewayOrderId_key" ON "PaymentIntent"("gatewayOrderId");

-- CreateIndex
CREATE INDEX "PaymentIntent_email_idx" ON "PaymentIntent"("email");

-- CreateIndex
CREATE INDEX "PaymentIntent_status_idx" ON "PaymentIntent"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayConfig_gateway_key" ON "PaymentGatewayConfig"("gateway");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_code_key" ON "PriceList"("code");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_productId_variantId_minQty_idx" ON "PriceListItem"("priceListId", "productId", "variantId", "minQty");

-- CreateIndex
CREATE INDEX "PriceListItem_priceListId_idx" ON "PriceListItem"("priceListId");

-- CreateIndex
CREATE INDEX "PriceListItem_productId_idx" ON "PriceListItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNo_key" ON "PurchaseOrder"("poNo");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_shareToken_key" ON "PurchaseOrder"("shareToken");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_idx" ON "PurchaseOrder"("vendorId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_poId_idx" ON "PurchaseOrderItem"("poId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_vendorProductId_idx" ON "PurchaseOrderItem"("vendorProductId");

-- CreateIndex
CREATE UNIQUE INDEX "Grn_grnNo_key" ON "Grn"("grnNo");

-- CreateIndex
CREATE INDEX "Grn_poId_idx" ON "Grn"("poId");

-- CreateIndex
CREATE INDEX "Grn_qcStatus_idx" ON "Grn"("qcStatus");

-- CreateIndex
CREATE INDEX "GrnItem_grnId_idx" ON "GrnItem"("grnId");

-- CreateIndex
CREATE INDEX "GrnItem_poItemId_idx" ON "GrnItem"("poItemId");

-- CreateIndex
CREATE INDEX "StockLot_grnItemId_idx" ON "StockLot"("grnItemId");

-- CreateIndex
CREATE INDEX "StockLot_productId_receivedAt_idx" ON "StockLot"("productId", "receivedAt");

-- CreateIndex
CREATE INDEX "StockLot_productId_qtyOnHand_idx" ON "StockLot"("productId", "qtyOnHand");

-- CreateIndex
CREATE INDEX "StockLot_warehouseId_idx" ON "StockLot"("warehouseId");

-- CreateIndex
CREATE INDEX "StockLot_binId_idx" ON "StockLot"("binId");

-- CreateIndex
CREATE INDEX "StockLot_batchNo_idx" ON "StockLot"("batchNo");

-- CreateIndex
CREATE INDEX "Bom_productId_idx" ON "Bom"("productId");

-- CreateIndex
CREATE INDEX "Bom_variantId_idx" ON "Bom"("variantId");

-- CreateIndex
CREATE INDEX "Bom_defaultWorkCenterId_idx" ON "Bom"("defaultWorkCenterId");

-- CreateIndex
CREATE INDEX "Bom_defaultFacilityId_idx" ON "Bom"("defaultFacilityId");

-- CreateIndex
CREATE INDEX "Bom_defaultLineId_idx" ON "Bom"("defaultLineId");

-- CreateIndex
CREATE INDEX "Bom_defaultMachineId_idx" ON "Bom"("defaultMachineId");

-- CreateIndex
CREATE INDEX "BomItem_bomId_idx" ON "BomItem"("bomId");

-- CreateIndex
CREATE INDEX "BomItem_bomOperationId_idx" ON "BomItem"("bomOperationId");

-- CreateIndex
CREATE INDEX "BomOperation_bomId_idx" ON "BomOperation"("bomId");

-- CreateIndex
CREATE INDEX "BomOperation_blockedByOperationId_idx" ON "BomOperation"("blockedByOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "BomOperation_bomId_seq_key" ON "BomOperation"("bomId", "seq");

-- CreateIndex
CREATE INDEX "BomOperationLine_lineId_idx" ON "BomOperationLine"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "BomOperationLine_bomOperationId_lineId_key" ON "BomOperationLine"("bomOperationId", "lineId");

-- CreateIndex
CREATE INDEX "BomByproduct_bomId_idx" ON "BomByproduct"("bomId");

-- CreateIndex
CREATE INDEX "BomByproduct_productId_idx" ON "BomByproduct"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_orderNo_key" ON "ProductionOrder"("orderNo");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");

-- CreateIndex
CREATE INDEX "ProductionOrder_bomId_idx" ON "ProductionOrder"("bomId");

-- CreateIndex
CREATE INDEX "ProductionOrder_facilityId_idx" ON "ProductionOrder"("facilityId");

-- CreateIndex
CREATE INDEX "ProductionOrder_lineId_idx" ON "ProductionOrder"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_workOrderNo_key" ON "WorkOrder"("workOrderNo");

-- CreateIndex
CREATE INDEX "WorkOrder_productionOrderId_idx" ON "WorkOrder"("productionOrderId");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrder_lineId_idx" ON "WorkOrder"("lineId");

-- CreateIndex
CREATE INDEX "WorkOrder_bomOperationId_idx" ON "WorkOrder"("bomOperationId");

-- CreateIndex
CREATE INDEX "WorkOrder_blockedByWorkOrderId_idx" ON "WorkOrder"("blockedByWorkOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderRun_workOrderId_idx" ON "WorkOrderRun"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderRun_machineId_idx" ON "WorkOrderRun"("machineId");

-- CreateIndex
CREATE INDEX "WorkOrderRun_status_idx" ON "WorkOrderRun"("status");

-- CreateIndex
CREATE INDEX "WorkOrderRunByproduct_workOrderRunId_idx" ON "WorkOrderRunByproduct"("workOrderRunId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrderRunByproduct_workOrderRunId_bomByproductId_key" ON "WorkOrderRunByproduct"("workOrderRunId", "bomByproductId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_code_key" ON "WorkCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkCenter_productionLineWarehouseId_key" ON "WorkCenter"("productionLineWarehouseId");

-- CreateIndex
CREATE INDEX "WorkCenter_active_idx" ON "WorkCenter"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionLine_code_key" ON "ProductionLine"("code");

-- CreateIndex
CREATE INDEX "ProductionLine_facilityId_idx" ON "ProductionLine"("facilityId");

-- CreateIndex
CREATE INDEX "ProductionLine_active_idx" ON "ProductionLine"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_code_key" ON "Machine"("code");

-- CreateIndex
CREATE INDEX "Machine_workCenterId_idx" ON "Machine"("workCenterId");

-- CreateIndex
CREATE INDEX "Machine_productionLineId_idx" ON "Machine"("productionLineId");

-- CreateIndex
CREATE INDEX "Machine_active_idx" ON "Machine"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_empNo_key" ON "Worker"("empNo");

-- CreateIndex
CREATE UNIQUE INDEX "Worker_userId_key" ON "Worker"("userId");

-- CreateIndex
CREATE INDEX "Attendance_workerId_date_idx" ON "Attendance"("workerId", "date");

-- CreateIndex
CREATE INDEX "PutawayRule_productId_idx" ON "PutawayRule"("productId");

-- CreateIndex
CREATE INDEX "PutawayRule_variantId_idx" ON "PutawayRule"("variantId");

-- CreateIndex
CREATE INDEX "PutawayRule_toWarehouseId_idx" ON "PutawayRule"("toWarehouseId");

-- CreateIndex
CREATE INDEX "StockRule_productId_idx" ON "StockRule"("productId");

-- CreateIndex
CREATE INDEX "StockRule_variantId_idx" ON "StockRule"("variantId");

-- CreateIndex
CREATE INDEX "StockRule_monitorBinId_idx" ON "StockRule"("monitorBinId");

-- CreateIndex
CREATE INDEX "StockRule_active_idx" ON "StockRule"("active");

-- CreateIndex
CREATE INDEX "StockRule_triggerType_idx" ON "StockRule"("triggerType");

-- CreateIndex
CREATE INDEX "StockRule_vendorId_idx" ON "StockRule"("vendorId");

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

-- CreateIndex
CREATE INDEX "StockLedger_productId_idx" ON "StockLedger"("productId");

-- CreateIndex
CREATE INDEX "StockLedger_variantId_idx" ON "StockLedger"("variantId");

-- CreateIndex
CREATE INDEX "StockLedger_warehouseId_idx" ON "StockLedger"("warehouseId");

-- CreateIndex
CREATE INDEX "StockLedger_txnType_idx" ON "StockLedger"("txnType");

-- CreateIndex
CREATE INDEX "StockLedger_date_idx" ON "StockLedger"("date");

-- CreateIndex
CREATE INDEX "StockLedger_lotId_idx" ON "StockLedger"("lotId");

-- CreateIndex
CREATE INDEX "StockLedger_batch_idx" ON "StockLedger"("batch");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shareToken_key" ON "Invoice"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_packingSlipId_key" ON "Invoice"("packingSlipId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE INDEX "Invoice_salesOrderId_idx" ON "Invoice"("salesOrderId");

-- CreateIndex
CREATE INDEX "Invoice_dispatchOptionId_idx" ON "Invoice"("dispatchOptionId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_variantId_idx" ON "InvoiceItem"("variantId");

-- CreateIndex
CREATE INDEX "InvoiceItem_salesOrderItemId_idx" ON "InvoiceItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "InvoiceItem_packingSlipItemId_idx" ON "InvoiceItem"("packingSlipItemId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOrder_dispatchNo_key" ON "DispatchOrder"("dispatchNo");

-- CreateIndex
CREATE INDEX "DispatchOrder_invoiceId_idx" ON "DispatchOrder"("invoiceId");

-- CreateIndex
CREATE INDEX "DispatchOrder_status_idx" ON "DispatchOrder"("status");

-- CreateIndex
CREATE INDEX "DispatchOrder_tripId_idx" ON "DispatchOrder"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_tripNo_key" ON "Trip"("tripNo");

-- CreateIndex
CREATE INDEX "Trip_scheduledDate_idx" ON "Trip"("scheduledDate");

-- CreateIndex
CREATE INDEX "Trip_status_idx" ON "Trip"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOption_code_key" ON "DispatchOption"("code");

-- CreateIndex
CREATE INDEX "DispatchOption_category_idx" ON "DispatchOption"("category");

-- CreateIndex
CREATE INDEX "DispatchOption_active_idx" ON "DispatchOption"("active");

-- CreateIndex
CREATE INDEX "ChannelMapping_internalSku_idx" ON "ChannelMapping"("internalSku");

-- CreateIndex
CREATE INDEX "ChannelMapping_channel_idx" ON "ChannelMapping"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMapping_channel_externalCode_key" ON "ChannelMapping"("channel", "externalCode");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNo_key" ON "Quote"("quoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_shareToken_key" ON "Quote"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_convertedSalesOrderId_key" ON "Quote"("convertedSalesOrderId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_dispatchOptionId_idx" ON "Quote"("dispatchOptionId");

-- CreateIndex
CREATE INDEX "QuoteItem_quoteId_idx" ON "QuoteItem"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteRevision_quoteId_idx" ON "QuoteRevision"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRevision_quoteId_revision_key" ON "QuoteRevision"("quoteId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_soNo_key" ON "SalesOrder"("soNo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_shareToken_key" ON "SalesOrder"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_quoteId_key" ON "SalesOrder"("quoteId");

-- CreateIndex
CREATE INDEX "SalesOrder_status_idx" ON "SalesOrder"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_customerId_idx" ON "SalesOrder"("customerId");

-- CreateIndex
CREATE INDEX "SalesOrder_source_idx" ON "SalesOrder"("source");

-- CreateIndex
CREATE INDEX "SalesOrder_dispatchOptionId_idx" ON "SalesOrder"("dispatchOptionId");

-- CreateIndex
CREATE INDEX "SalesOrder_externalRef_idx" ON "SalesOrder"("externalRef");

-- CreateIndex
CREATE INDEX "SalesOrderItem_salesOrderId_idx" ON "SalesOrderItem"("salesOrderId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");

-- CreateIndex
CREATE INDEX "SalesOrderItem_variantId_idx" ON "SalesOrderItem"("variantId");

-- CreateIndex
CREATE INDEX "SalesOrderReservation_salesOrderItemId_idx" ON "SalesOrderReservation"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "SalesOrderReservation_binId_idx" ON "SalesOrderReservation"("binId");

-- CreateIndex
CREATE UNIQUE INDEX "PickList_pickListNo_key" ON "PickList"("pickListNo");

-- CreateIndex
CREATE INDEX "PickList_salesOrderId_idx" ON "PickList"("salesOrderId");

-- CreateIndex
CREATE INDEX "PickList_status_idx" ON "PickList"("status");

-- CreateIndex
CREATE INDEX "PickList_assignedToId_idx" ON "PickList"("assignedToId");

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
CREATE UNIQUE INDEX "PackingSlip_shareToken_key" ON "PackingSlip"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "PackingSlip_pickListId_key" ON "PackingSlip"("pickListId");

-- CreateIndex
CREATE INDEX "PackingSlip_salesOrderId_idx" ON "PackingSlip"("salesOrderId");

-- CreateIndex
CREATE INDEX "PackingSlip_status_idx" ON "PackingSlip"("status");

-- CreateIndex
CREATE INDEX "PackingSlip_assignedToId_idx" ON "PackingSlip"("assignedToId");

-- CreateIndex
CREATE INDEX "PackingSlipItem_packingSlipId_idx" ON "PackingSlipItem"("packingSlipId");

-- CreateIndex
CREATE INDEX "PackingSlipItem_salesOrderItemId_idx" ON "PackingSlipItem"("salesOrderItemId");

-- CreateIndex
CREATE INDEX "PackingSlipItem_productId_idx" ON "PackingSlipItem"("productId");

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
CREATE INDEX "Approval_status_idx" ON "Approval"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

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
CREATE INDEX "CustomerActivity_anonId_createdAt_idx" ON "CustomerActivity"("anonId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_customerId_createdAt_idx" ON "CustomerActivity"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_event_createdAt_idx" ON "CustomerActivity"("event", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerActivity_createdAt_idx" ON "CustomerActivity"("createdAt");

-- CreateIndex
CREATE INDEX "SystemEventLog_source_createdAt_idx" ON "SystemEventLog"("source", "createdAt");

-- CreateIndex
CREATE INDEX "SystemEventLog_level_createdAt_idx" ON "SystemEventLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemEventLog_createdAt_idx" ON "SystemEventLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChangeLog_serverTime_idx" ON "ChangeLog"("serverTime");

-- CreateIndex
CREATE INDEX "ChangeLog_entity_entityId_idx" ON "ChangeLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Tombstone_serverTime_idx" ON "Tombstone"("serverTime");

-- CreateIndex
CREATE UNIQUE INDEX "Tombstone_entity_entityId_key" ON "Tombstone"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_deviceId_key" ON "SyncState"("deviceId");

-- CreateIndex
CREATE INDEX "SyncConflict_deviceId_idx" ON "SyncConflict"("deviceId");

-- CreateIndex
CREATE INDEX "SyncConflict_entity_entityId_idx" ON "SyncConflict"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_key_key" ON "CompanyProfile"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReturn_returnNo_key" ON "CustomerReturn"("returnNo");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReturn_shareToken_key" ON "CustomerReturn"("shareToken");

-- CreateIndex
CREATE INDEX "CustomerReturn_customerId_idx" ON "CustomerReturn"("customerId");

-- CreateIndex
CREATE INDEX "CustomerReturn_status_idx" ON "CustomerReturn"("status");

-- CreateIndex
CREATE INDEX "CustomerReturnItem_customerReturnId_idx" ON "CustomerReturnItem"("customerReturnId");

-- CreateIndex
CREATE INDEX "CustomerReturnItem_productId_idx" ON "CustomerReturnItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_key" ON "CreditNote"("creditNoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_shareToken_key" ON "CreditNote"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_customerReturnId_key" ON "CreditNote"("customerReturnId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_customerPaymentId_key" ON "CreditNote"("customerPaymentId");

-- CreateIndex
CREATE INDEX "CreditNote_customerId_idx" ON "CreditNote"("customerId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNoteItem_creditNoteId_idx" ON "CreditNoteItem"("creditNoteId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Uom" ADD CONSTRAINT "Uom_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "UomCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConcernLink" ADD CONSTRAINT "ProductConcernLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConcernLink" ADD CONSTRAINT "ProductConcernLink_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "ProductConcern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryItem" ADD CONSTRAINT "EnquiryItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryActivity" ADD CONSTRAINT "EnquiryActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryActivity" ADD CONSTRAINT "EnquiryActivity_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_vendorProductId_fkey" FOREIGN KEY ("vendorProductId") REFERENCES "VendorProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grn" ADD CONSTRAINT "Grn_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_grnId_fkey" FOREIGN KEY ("grnId") REFERENCES "Grn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrnItem" ADD CONSTRAINT "GrnItem_poItemId_fkey" FOREIGN KEY ("poItemId") REFERENCES "PurchaseOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLot" ADD CONSTRAINT "StockLot_grnItemId_fkey" FOREIGN KEY ("grnItemId") REFERENCES "GrnItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_defaultWorkCenterId_fkey" FOREIGN KEY ("defaultWorkCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_defaultFacilityId_fkey" FOREIGN KEY ("defaultFacilityId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_defaultLineId_fkey" FOREIGN KEY ("defaultLineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bom" ADD CONSTRAINT "Bom_defaultMachineId_fkey" FOREIGN KEY ("defaultMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_bomOperationId_fkey" FOREIGN KEY ("bomOperationId") REFERENCES "BomOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomItem" ADD CONSTRAINT "BomItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperation" ADD CONSTRAINT "BomOperation_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperation" ADD CONSTRAINT "BomOperation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperation" ADD CONSTRAINT "BomOperation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperation" ADD CONSTRAINT "BomOperation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperation" ADD CONSTRAINT "BomOperation_blockedByOperationId_fkey" FOREIGN KEY ("blockedByOperationId") REFERENCES "BomOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperationLine" ADD CONSTRAINT "BomOperationLine_bomOperationId_fkey" FOREIGN KEY ("bomOperationId") REFERENCES "BomOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomOperationLine" ADD CONSTRAINT "BomOperationLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomByproduct" ADD CONSTRAINT "BomByproduct_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomByproduct" ADD CONSTRAINT "BomByproduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomByproduct" ADD CONSTRAINT "BomByproduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_bomOperationId_fkey" FOREIGN KEY ("bomOperationId") REFERENCES "BomOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_blockedByWorkOrderId_fkey" FOREIGN KEY ("blockedByWorkOrderId") REFERENCES "WorkOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRun" ADD CONSTRAINT "WorkOrderRun_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRun" ADD CONSTRAINT "WorkOrderRun_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRun" ADD CONSTRAINT "WorkOrderRun_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRunByproduct" ADD CONSTRAINT "WorkOrderRunByproduct_workOrderRunId_fkey" FOREIGN KEY ("workOrderRunId") REFERENCES "WorkOrderRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderRunByproduct" ADD CONSTRAINT "WorkOrderRunByproduct_bomByproductId_fkey" FOREIGN KEY ("bomByproductId") REFERENCES "BomByproduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkCenter" ADD CONSTRAINT "WorkCenter_productionLineWarehouseId_fkey" FOREIGN KEY ("productionLineWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "WorkCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "ProductionLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worker" ADD CONSTRAINT "Worker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayRule" ADD CONSTRAINT "PutawayRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayRule" ADD CONSTRAINT "PutawayRule_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayRule" ADD CONSTRAINT "PutawayRule_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PutawayRule" ADD CONSTRAINT "PutawayRule_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_monitorBinId_fkey" FOREIGN KEY ("monitorBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_sourceBinId_fkey" FOREIGN KEY ("sourceBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockRule" ADD CONSTRAINT "StockRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_pickedById_fkey" FOREIGN KEY ("pickedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrder" ADD CONSTRAINT "TransferOrder_droppedById_fkey" FOREIGN KEY ("droppedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_transferOrderId_fkey" FOREIGN KEY ("transferOrderId") REFERENCES "TransferOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_fromBinId_fkey" FOREIGN KEY ("fromBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferOrderItem" ADD CONSTRAINT "TransferOrderItem_toBinId_fkey" FOREIGN KEY ("toBinId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "StockLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_packingSlipItemId_fkey" FOREIGN KEY ("packingSlipItemId") REFERENCES "PackingSlipItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteItem" ADD CONSTRAINT "QuoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteRevision" ADD CONSTRAINT "QuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_dispatchOptionId_fkey" FOREIGN KEY ("dispatchOptionId") REFERENCES "DispatchOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderReservation" ADD CONSTRAINT "SalesOrderReservation_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderReservation" ADD CONSTRAINT "SalesOrderReservation_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickList" ADD CONSTRAINT "PickList_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickListItem" ADD CONSTRAINT "PickListItem_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlip" ADD CONSTRAINT "PackingSlip_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlip" ADD CONSTRAINT "PackingSlip_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlip" ADD CONSTRAINT "PackingSlip_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlipItem" ADD CONSTRAINT "PackingSlipItem_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlipItem" ADD CONSTRAINT "PackingSlipItem_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlipItem" ADD CONSTRAINT "PackingSlipItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingSlipItem" ADD CONSTRAINT "PackingSlipItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingContainer" ADD CONSTRAINT "PackingContainer_packingSlipId_fkey" FOREIGN KEY ("packingSlipId") REFERENCES "PackingSlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingContainer" ADD CONSTRAINT "PackingContainer_containerTypeId_fkey" FOREIGN KEY ("containerTypeId") REFERENCES "ContainerType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingContainerItem" ADD CONSTRAINT "PackingContainerItem_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "PackingContainer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackingContainerItem" ADD CONSTRAINT "PackingContainerItem_packingSlipItemId_fkey" FOREIGN KEY ("packingSlipItemId") REFERENCES "PackingSlipItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinCount" ADD CONSTRAINT "BinCount_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BinCount" ADD CONSTRAINT "BinCount_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturnItem" ADD CONSTRAINT "CustomerReturnItem_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "CustomerReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturnItem" ADD CONSTRAINT "CustomerReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturnItem" ADD CONSTRAINT "CustomerReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "CustomerReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteItem" ADD CONSTRAINT "CreditNoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

