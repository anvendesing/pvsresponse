-- CreateTable
CREATE TABLE "DocumentSeries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "documentType" TEXT NOT NULL DEFAULT 'invoice',
    "prefix" TEXT NOT NULL DEFAULT 'INV',
    "pattern" TEXT NOT NULL DEFAULT '{PREFIX}-{YYYY}-{SEQ}',
    "padWidth" INTEGER NOT NULL DEFAULT 4,
    "startNumber" INTEGER NOT NULL DEFAULT 1,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "resetPeriod" TEXT NOT NULL DEFAULT 'yearly',
    "lastPeriodKey" TEXT,
    "channelSource" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSeries_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "documentSeriesId" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "documentSeriesId" TEXT,
ADD COLUMN "seriesSeq" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSeries_code_key" ON "DocumentSeries"("code");

-- CreateIndex
CREATE INDEX "DocumentSeries_documentType_active_idx" ON "DocumentSeries"("documentType", "active");

-- CreateIndex
CREATE INDEX "DocumentSeries_channelSource_idx" ON "DocumentSeries"("channelSource");

-- CreateIndex
CREATE INDEX "Customer_documentSeriesId_idx" ON "Customer"("documentSeriesId");

-- CreateIndex
CREATE INDEX "Invoice_documentSeriesId_idx" ON "Invoice"("documentSeriesId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_documentSeriesId_fkey" FOREIGN KEY ("documentSeriesId") REFERENCES "DocumentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_documentSeriesId_fkey" FOREIGN KEY ("documentSeriesId") REFERENCES "DocumentSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default schemes: B2B (shared by internal/ecommerce/POS until overridden) + PDF import
INSERT INTO "DocumentSeries" ("id", "code", "name", "documentType", "prefix", "pattern", "padWidth", "startNumber", "nextNumber", "resetPeriod", "channelSource", "isDefault", "active", "updatedAt")
VALUES
  ('docseries_b2b_default', 'B2B', 'B2B / Standard Invoices', 'invoice', 'INV', '{PREFIX}-{YYYY}-{SEQ}', 4, 5501, 5501, 'yearly', NULL, true, true, NOW()),
  ('docseries_import', 'IMPORT', 'PDF Import Invoices', 'invoice', 'IMP-INV', '{PREFIX}-{YYYY}-{SEQ}', 4, 1, 1, 'yearly', 'imported', false, true, NOW());
