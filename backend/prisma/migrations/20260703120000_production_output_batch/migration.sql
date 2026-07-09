-- CreateTable
CREATE TABLE "ProductionOutputBatch" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "batchSeq" INTEGER NOT NULL,
    "inputQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "goodQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scrapQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reworkQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "byproducts" JSONB NOT NULL DEFAULT '[]',
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loggedBy" TEXT,

    CONSTRAINT "ProductionOutputBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionOutputBatch_productionOrderId_idx" ON "ProductionOutputBatch"("productionOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOutputBatch_productionOrderId_batchSeq_key" ON "ProductionOutputBatch"("productionOrderId", "batchSeq");

-- AddForeignKey
ALTER TABLE "ProductionOutputBatch" ADD CONSTRAINT "ProductionOutputBatch_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
