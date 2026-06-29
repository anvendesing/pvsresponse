-- CreateTable
CREATE TABLE "CustomerReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnNo" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "source" TEXT NOT NULL DEFAULT 'excel',
    "notes" TEXT,
    "subTotal" REAL NOT NULL DEFAULT 0,
    "tax" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "importedById" TEXT NOT NULL,
    "finalizedById" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerReturn_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerReturn_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerReturnItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerReturnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "invoiceItemId" TEXT,
    "qty" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "reasonNotes" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decisionNotes" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    CONSTRAINT "CustomerReturnItem_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "CustomerReturn" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerReturnItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerReturnItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creditNoteNo" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerReturnId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "customerPaymentId" TEXT,
    "subTotal" REAL NOT NULL,
    "tax" REAL NOT NULL,
    "total" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CreditNote_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "CustomerReturn" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditNoteItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "creditNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "qty" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "returnItemId" TEXT,
    CONSTRAINT "CreditNoteItem_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditNoteItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CreditNoteItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
