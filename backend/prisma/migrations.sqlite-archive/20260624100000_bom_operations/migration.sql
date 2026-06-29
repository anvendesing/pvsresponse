-- Multi-step BOMs (Odoo mrp.bom.operation reference).

ALTER TABLE "Bom" ADD COLUMN "operationDependencies" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "BomItem" ADD COLUMN "bomOperationId" TEXT;

CREATE TABLE "BomOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bomId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "facilityId" TEXT,
    "lineId" TEXT,
    "machineId" TEXT,
    "durationMinutes" REAL,
    "requiresQa" BOOLEAN NOT NULL DEFAULT true,
    "blockedByOperationId" TEXT,
    CONSTRAINT "BomOperation_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "Bom" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BomOperation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "WorkCenter" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BomOperation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BomOperation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BomOperation_blockedByOperationId_fkey" FOREIGN KEY ("blockedByOperationId") REFERENCES "BomOperation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BomOperation_bomId_seq_key" ON "BomOperation"("bomId", "seq");
CREATE INDEX "BomOperation_bomId_idx" ON "BomOperation"("bomId");
CREATE INDEX "BomOperation_blockedByOperationId_idx" ON "BomOperation"("blockedByOperationId");

CREATE TABLE "BomOperationLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bomOperationId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    CONSTRAINT "BomOperationLine_bomOperationId_fkey" FOREIGN KEY ("bomOperationId") REFERENCES "BomOperation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BomOperationLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProductionLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BomOperationLine_bomOperationId_lineId_key" ON "BomOperationLine"("bomOperationId", "lineId");
CREATE INDEX "BomOperationLine_lineId_idx" ON "BomOperationLine"("lineId");

CREATE INDEX "BomItem_bomOperationId_idx" ON "BomItem"("bomOperationId");

ALTER TABLE "WorkOrder" ADD COLUMN "bomOperationId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "splitSeq" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WorkOrder" ADD COLUMN "plannedSplitQty" REAL;
ALTER TABLE "WorkOrder" ADD COLUMN "blockedByWorkOrderId" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "qaStatus" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN "qaNotes" TEXT;

CREATE INDEX "WorkOrder_bomOperationId_idx" ON "WorkOrder"("bomOperationId");
CREATE INDEX "WorkOrder_blockedByWorkOrderId_idx" ON "WorkOrder"("blockedByWorkOrderId");

-- NOTE: SQLite does not support `ALTER TABLE ... ADD CONSTRAINT`. The FK
-- declarations for BomItem.bomOperationId, WorkOrder.bomOperationId, and
-- WorkOrder.blockedByWorkOrderId live only in prisma/schema.prisma (and
-- are therefore enforced by Prisma client at the app layer, not the DB).
-- The Postgres-style ADD CONSTRAINT lines that originally followed the
-- ADD COLUMN block were removed because they crashed `migrate deploy`
-- on a fresh SQLite database. Run `prisma migrate dev` again only when
-- migrating to a database engine that supports adding FKs after the
-- fact (Postgres / MySQL).
