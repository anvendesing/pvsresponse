-- Multi-machine parallel runs inside a single WorkOrder.
-- A WO with zero runs keeps the legacy single-machine behavior.
-- A WO with >=1 run rolls its output up from sum(runs.goodQty) and can
-- be processed across multiple machines in parallel (e.g. two screw
-- presses sharing one extraction WO).

CREATE TABLE "WorkOrderRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workOrderId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "lineId" TEXT,
    "plannedQty" REAL,
    "inputQty" REAL NOT NULL DEFAULT 0,
    "goodQty" REAL NOT NULL DEFAULT 0,
    "scrapQty" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startTime" DATETIME,
    "endTime" DATETIME,
    "operator" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrderRun_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderRun_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkOrderRun_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "WorkOrderRun_workOrderId_idx" ON "WorkOrderRun"("workOrderId");
CREATE INDEX "WorkOrderRun_machineId_idx" ON "WorkOrderRun"("machineId");
CREATE INDEX "WorkOrderRun_status_idx" ON "WorkOrderRun"("status");
