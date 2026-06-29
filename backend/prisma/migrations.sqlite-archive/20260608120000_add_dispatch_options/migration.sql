-- Dispatch options master + transport charge fields on Quote / SO / Invoice.

CREATE TABLE "DispatchOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "defaultCharge" REAL NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "DispatchOption_code_key" ON "DispatchOption"("code");
CREATE INDEX "DispatchOption_category_idx" ON "DispatchOption"("category");
CREATE INDEX "DispatchOption_active_idx" ON "DispatchOption"("active");

ALTER TABLE "Quote" ADD COLUMN "transportCharge" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "transportTax" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "dispatchOptionId" TEXT;
CREATE INDEX "Quote_dispatchOptionId_idx" ON "Quote"("dispatchOptionId");

ALTER TABLE "SalesOrder" ADD COLUMN "transportCharge" REAL NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "transportTax" REAL NOT NULL DEFAULT 0;
ALTER TABLE "SalesOrder" ADD COLUMN "dispatchOptionId" TEXT;
CREATE INDEX "SalesOrder_dispatchOptionId_idx" ON "SalesOrder"("dispatchOptionId");

ALTER TABLE "Invoice" ADD COLUMN "transportCharge" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "transportTax" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "dispatchOptionId" TEXT;
CREATE INDEX "Invoice_dispatchOptionId_idx" ON "Invoice"("dispatchOptionId");
