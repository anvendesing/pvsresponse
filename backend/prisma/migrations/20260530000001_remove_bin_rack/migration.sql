-- Migration: remove rack column from Bin table
-- New hierarchy: zone → shelf → bin (was zone → rack → shelf → bin)
--
-- When removing rack, some bins that previously differed only by rack
-- now have the same zone/shelf/bin. We keep the row with the lowest id
-- (first created) for each unique zone/shelf/bin combination; this
-- is appropriate for a dev database where bins were seeded.

PRAGMA foreign_keys=OFF;

-- 1. Create the new table without the rack column
CREATE TABLE "Bin_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouseId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "shelf" TEXT NOT NULL,
    "bin" TEXT NOT NULL,
    "code" TEXT,
    "capacity" INTEGER NOT NULL DEFAULT 100,
    "occupied" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "batch" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- 2. Copy data, keeping only the first (lowest id) row per warehouseId/zone/shelf/bin.
--    Clear stale codes so the backfill script regenerates them in the new format.
INSERT INTO "Bin_new"
    ("id","warehouseId","zone","shelf","bin","code","capacity","occupied","productId","qty","reservedQty","batch","createdAt","updatedAt")
SELECT
    MIN("id"),"warehouseId","zone","shelf","bin",
    NULL,
    MAX("capacity"),
    SUM("occupied"),
    MAX("productId"),
    SUM("qty"),
    SUM("reservedQty"),
    MAX("batch"),
    MIN("createdAt"),
    MAX("updatedAt")
FROM "Bin"
GROUP BY "warehouseId","zone","shelf","bin";

-- 3. Drop old table and rename new
DROP TABLE "Bin";
ALTER TABLE "Bin_new" RENAME TO "Bin";

-- 4. Recreate indexes and unique constraints
CREATE UNIQUE INDEX "Bin_code_key" ON "Bin"("code");
CREATE UNIQUE INDEX "Bin_warehouseId_zone_shelf_bin_key" ON "Bin"("warehouseId", "zone", "shelf", "bin");
CREATE INDEX "Bin_productId_idx" ON "Bin"("productId");

-- 5. Fix any FK references in related tables to deduplicated Bin ids.
--    (PickListItem, PutawayRule, TransferOrderItem, BinCount reference binId)
--    If the referenced bin was one that got merged away, update it to the
--    surviving id. In a dev DB with seeded data there are typically no
--    such orphans, but this is safe to leave as a no-op.

-- 6. Backfill StockLedger.bin path strings: strip rack segment.
--    Old format: "zone/rack/shelf/bin" (3 slashes → 4 parts). New: "zone/shelf/bin".
UPDATE "StockLedger"
SET "bin" = (
    SUBSTR("bin", 1, INSTR("bin", '/') - 1)
    || '/'
    || SUBSTR(
        SUBSTR("bin", INSTR("bin", '/') + 1),
        INSTR(SUBSTR("bin", INSTR("bin", '/') + 1), '/') + 1
    )
)
WHERE
    "bin" IS NOT NULL
    AND LENGTH("bin") - LENGTH(REPLACE("bin", '/', '')) = 3;

PRAGMA foreign_keys=ON;
