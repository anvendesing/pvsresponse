-- ChannelMapping: per-channel external code → internal SKU translation
CREATE TABLE "ChannelMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "externalCode" TEXT NOT NULL,
    "internalSku" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "ChannelMapping_channel_externalCode_key" ON "ChannelMapping"("channel", "externalCode");
CREATE INDEX "ChannelMapping_internalSku_idx" ON "ChannelMapping"("internalSku");
CREATE INDEX "ChannelMapping_channel_idx" ON "ChannelMapping"("channel");

-- SalesOrder: external-channel reference fields (populated only when source="imported")
ALTER TABLE "SalesOrder" ADD COLUMN "externalChannel" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "externalAwb" TEXT;
ALTER TABLE "SalesOrder" ADD COLUMN "externalInvoiceNo" TEXT;
CREATE INDEX "SalesOrder_externalRef_idx" ON "SalesOrder"("externalRef");
