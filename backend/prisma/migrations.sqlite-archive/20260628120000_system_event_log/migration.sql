-- Structured operational logs for admin debugging (storefront, Shiprocket, payments, OTP).
CREATE TABLE "SystemEventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SystemEventLog_source_createdAt_idx" ON "SystemEventLog"("source", "createdAt");
CREATE INDEX "SystemEventLog_level_createdAt_idx" ON "SystemEventLog"("level", "createdAt");
CREATE INDEX "SystemEventLog_createdAt_idx" ON "SystemEventLog"("createdAt");
