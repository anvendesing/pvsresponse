-- Storefront customer activity log (pageviews, add-to-cart, orders, etc.)
CREATE TABLE "CustomerActivity" (
  "id"         TEXT NOT NULL PRIMARY KEY,
  "anonId"     TEXT NOT NULL,
  "customerId" TEXT,
  "sessionId"  TEXT,
  "event"      TEXT NOT NULL,
  "path"       TEXT,
  "referer"    TEXT,
  "productId"  TEXT,
  "meta"       TEXT,
  "userAgent"  TEXT,
  "ip"         TEXT,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "CustomerActivity_anonId_createdAt_idx"    ON "CustomerActivity"("anonId", "createdAt");
CREATE INDEX "CustomerActivity_customerId_createdAt_idx" ON "CustomerActivity"("customerId", "createdAt");
CREATE INDEX "CustomerActivity_event_createdAt_idx"     ON "CustomerActivity"("event", "createdAt");
CREATE INDEX "CustomerActivity_createdAt_idx"           ON "CustomerActivity"("createdAt");
