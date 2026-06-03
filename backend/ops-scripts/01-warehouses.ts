#!/usr/bin/env tsx
/**
 * Step 1 — Create / update site warehouses + default bins.
 * Does NOT touch the existing finished-goods warehouse (see site-layout.ts).
 *
 *   npm run ops:warehouses
 *   npm run ops:warehouses -- --dry-run
 */

import {
  EXISTING_FINISHED_GOODS_WH_CODE,
  allWarehouses,
} from "./config/site-layout.js";
import { db, dryRun, ensureDefaultBin, log, upsertWarehouse } from "./lib/db.js";
import { removeObsoleteAncillaryWarehouses } from "./lib/remove-ancillary.js";

async function main() {
  log(dryRun ? "01-warehouses (DRY RUN)" : "01-warehouses — upserting site warehouses…");

  log("  Removing obsolete ancillary warehouses (WH-ANC-*)…");
  await removeObsoleteAncillaryWarehouses();

  const fg = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
    select: { code: true, name: true, kind: true },
  });
  if (fg) {
    log(
      `  ℹ Existing finished-goods WH: ${fg.code} (${fg.name}, kind=${fg.kind}) — not modified`
    );
  } else {
    log(
      `  ⚠ Warehouse ${EXISTING_FINISHED_GOODS_WH_CODE} not found — create it in Settings first, then add putaway rules.`
    );
  }

  const specs = allWarehouses();
  let whCount = 0;
  let binCount = 0;

  for (const spec of specs) {
    await upsertWarehouse(spec);
    whCount++;

    if (spec.kind === "production") {
      // Floor bin: issue, WIP, temporary FG before putaway TO → WH-FG.
      await ensureDefaultBin({
        warehouseCode: spec.code,
        zone: "LINE",
        shelf: "01",
        bin: "01",
      });
      await ensureDefaultBin({
        warehouseCode: spec.code,
        zone: "FG",
        shelf: "01",
        bin: "01",
      });
      binCount += 2;
      continue;
    }

    await ensureDefaultBin({
      warehouseCode: spec.code,
      zone: "STG",
      shelf: "01",
      bin: "01",
    });
    binCount++;
  }

  log(`  ✓ ${whCount} warehouses upserted, ${binCount} bin slot(s) ensured`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
