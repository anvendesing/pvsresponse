-- Hard reservations against bins for confirmed Sales Orders.
-- One row per (SO line, bin) split. Bin.reservedQty is the materialised
-- total of these plus pick-list reservations (after pick → picked).
-- See backend/src/lib/so-reservations.ts for the lifecycle.
CREATE TABLE "SalesOrderReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "salesOrderItemId" TEXT NOT NULL,
    "binId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesOrderReservation_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "SalesOrderItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SalesOrderReservation_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SalesOrderReservation_salesOrderItemId_idx" ON "SalesOrderReservation"("salesOrderItemId");
CREATE INDEX "SalesOrderReservation_binId_idx" ON "SalesOrderReservation"("binId");
