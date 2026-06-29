-- Sequential batches on machine runs + per-run by-product yields.
ALTER TABLE "WorkOrderRun" ADD COLUMN "batchSeq" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "WorkOrderRunByproduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderRunId" TEXT NOT NULL,
    "bomByproductId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkOrderRunByproduct_workOrderRunId_fkey" FOREIGN KEY ("workOrderRunId") REFERENCES "WorkOrderRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderRunByproduct_bomByproductId_fkey" FOREIGN KEY ("bomByproductId") REFERENCES "BomByproduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkOrderRunByproduct_workOrderRunId_bomByproductId_key" ON "WorkOrderRunByproduct"("workOrderRunId", "bomByproductId");
CREATE INDEX "WorkOrderRunByproduct_workOrderRunId_idx" ON "WorkOrderRunByproduct"("workOrderRunId");
