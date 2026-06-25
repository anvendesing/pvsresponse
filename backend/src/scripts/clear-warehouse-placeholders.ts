/**
 * Clean up the synthetic "placeholder" Bin rows the system used to
 * model stock held at warehouse / zone / shelf level before the
 * UI learned to render those levels natively.
 *
 *   zone  in ("_", "WH")   →  bin actually lives at warehouse level
 *   shelf == "00"          →  bin actually lives at zone level
 *   bin   == "00"          →  bin actually lives at shelf level
 *
 * SAFE BY DEFAULT — runs as dry run. Pass --apply to actually delete.
 *
 * The script ONLY deletes placeholder bins that are demonstrably
 * empty AND have no foreign-key references. Anything still holding
 * stock, reserved qty, open pick/transfer/lot references is listed
 * and skipped so the operator can rehome the stock manually first.
 *
 *   npx tsx src/scripts/clear-warehouse-placeholders.ts            # dry run
 *   npx tsx src/scripts/clear-warehouse-placeholders.ts --apply
 *   npx tsx src/scripts/clear-warehouse-placeholders.ts --apply --warehouse=STR
 */

import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const dryRun = !apply;
const whFilterArg = process.argv.find((a) => a.startsWith("--warehouse="));
const whFilter = whFilterArg
  ? whFilterArg.slice("--warehouse=".length).toUpperCase()
  : null;
// Force-delete specific bin CODES even if they still hold stock.
// Use to clean up stuck placeholder rows the operator has confirmed
// they want to discard. Each forced deletion zeroes the bin and
// writes an "Adjust" ledger row so the audit trail is intact.
const forceArg = process.argv.find((a) => a.startsWith("--force-codes="));
const forceCodes = new Set(
  forceArg
    ? forceArg
        .slice("--force-codes=".length)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : []
);

const PLACEHOLDER_ZONES = new Set(["_", "WH"]);
const PLACEHOLDER_SHELF = "00";
const PLACEHOLDER_BIN = "00";

const db = new PrismaClient();

const isPlaceholderRow = (b: { zone: string; shelf: string; bin: string }) =>
  PLACEHOLDER_ZONES.has(b.zone.toUpperCase()) ||
  b.shelf.toUpperCase() === PLACEHOLDER_SHELF ||
  b.bin.toUpperCase() === PLACEHOLDER_BIN;

interface Counter {
  empty: number;
  withStock: number;
  withReservation: number;
  withReferences: number;
  deleted: number;
}

async function processWarehouse(whCode: string): Promise<Counter> {
  const wh = await db.warehouse.findUnique({ where: { code: whCode } });
  if (!wh) {
    console.log(`Skip ${whCode} (not found)`);
    return { empty: 0, withStock: 0, withReservation: 0, withReferences: 0, deleted: 0 };
  }

  const bins = await db.bin.findMany({
    where: { warehouseId: wh.id },
    select: {
      id: true,
      zone: true,
      shelf: true,
      bin: true,
      code: true,
      qty: true,
      reservedQty: true,
      productId: true,
    },
  });

  const placeholders = bins.filter(isPlaceholderRow);
  if (placeholders.length === 0) {
    console.log(`${whCode}: no placeholder bins.`);
    return { empty: 0, withStock: 0, withReservation: 0, withReferences: 0, deleted: 0 };
  }

  const placeholderIds = placeholders.map((b) => b.id);

  // Pre-flight: find every placeholder bin that has lingering FK
  // references so we don't get a 500 mid-transaction.
  const [
    pickListUses,
    salesOrderRes,
    putawayRules,
    stockRulesMonitor,
    stockRulesSource,
    stockRulesDest,
    binCounts,
    transferFrom,
    transferTo,
    stockLots,
  ] = await Promise.all([
    db.pickListItem.findMany({
      where: { binId: { in: placeholderIds } },
      select: { binId: true },
    }),
    db.salesOrderReservation.findMany({
      where: { binId: { in: placeholderIds } },
      select: { binId: true },
    }),
    db.putawayRule.findMany({
      where: { toBinId: { in: placeholderIds } },
      select: { id: true, toBinId: true },
    }),
    db.stockRule.findMany({
      where: { monitorBinId: { in: placeholderIds } },
      select: { id: true, monitorBinId: true },
    }),
    db.stockRule.findMany({
      where: { sourceBinId: { in: placeholderIds } },
      select: { id: true, sourceBinId: true },
    }),
    db.stockRule.findMany({
      where: { toBinId: { in: placeholderIds } },
      select: { id: true, toBinId: true },
    }),
    db.binCount.findMany({
      where: { binId: { in: placeholderIds } },
      select: { binId: true },
    }),
    db.transferOrderItem.findMany({
      where: { fromBinId: { in: placeholderIds } },
      select: { id: true, fromBinId: true },
    }),
    db.transferOrderItem.findMany({
      where: { toBinId: { in: placeholderIds } },
      select: { id: true, toBinId: true },
    }),
    db.stockLot.findMany({
      where: { binId: { in: placeholderIds } },
      select: { id: true, binId: true },
    }),
  ]);

  const refsByBin = new Map<string, string[]>();
  const addRef = (binId: string, label: string) => {
    const list = refsByBin.get(binId) ?? [];
    if (!list.includes(label)) list.push(label);
    refsByBin.set(binId, list);
  };
  for (const r of pickListUses) addRef(r.binId!, "pick-list");
  for (const r of salesOrderRes) addRef(r.binId!, "so-reservation");
  for (const r of binCounts) addRef(r.binId, "bin-count");
  for (const r of stockLots) if (r.binId) addRef(r.binId, "stock-lot");
  for (const r of transferFrom) if (r.fromBinId) addRef(r.fromBinId, "tx-from");
  for (const r of transferTo) if (r.toBinId) addRef(r.toBinId, "tx-to");
  // Rules referencing the placeholder bin can be cascade-deleted along
  // with the bin since they only apply to that physical slot; record
  // them so the report mentions the cleanup.
  const ruleIdsToDelete = new Set<string>();
  for (const r of putawayRules) ruleIdsToDelete.add(r.id);
  for (const r of stockRulesMonitor) ruleIdsToDelete.add(r.id);
  for (const r of stockRulesSource) ruleIdsToDelete.add(r.id);
  for (const r of stockRulesDest) ruleIdsToDelete.add(r.id);

  const c: Counter = { empty: 0, withStock: 0, withReservation: 0, withReferences: 0, deleted: 0 };
  const toDelete: typeof placeholders = [];
  const keepWithStock: typeof placeholders = [];
  const keepReferenced: typeof placeholders = [];

  for (const b of placeholders) {
    const codeUpper = (b.code ?? "").toUpperCase();
    const forced = forceCodes.has(codeUpper);

    if (refsByBin.has(b.id) && !forced) {
      c.withReferences++;
      keepReferenced.push(b);
      continue;
    }
    if (b.reservedQty > 0 && !forced) {
      c.withReservation++;
      keepWithStock.push(b);
      continue;
    }
    if (b.qty > 0 && !forced) {
      c.withStock++;
      keepWithStock.push(b);
      continue;
    }

    if (forced && (b.qty > 0 || b.reservedQty > 0 || refsByBin.has(b.id))) {
      console.log(
        `  FORCE DELETE ${b.code}  qty=${b.qty}  reserved=${b.reservedQty}` +
          (refsByBin.has(b.id) ? `  refs=${refsByBin.get(b.id)?.join(",")}` : "")
      );
    }
    c.empty++;
    toDelete.push(b);
  }

  console.log(
    `${whCode}: ${placeholders.length} placeholder bin(s) — ` +
      `${c.empty} empty (would delete), ${c.withStock} hold stock, ` +
      `${c.withReservation} reserved, ${c.withReferences} referenced (would keep).`
  );

  if (keepWithStock.length > 0) {
    console.log("  KEEP (still holds stock — rehome via Adjust Stock first):");
    for (const b of keepWithStock.slice(0, 10)) {
      console.log(
        `    ${b.code ?? `${b.zone}/${b.shelf}/${b.bin}`}  qty=${b.qty}  reserved=${b.reservedQty}  productId=${b.productId ?? "—"}`
      );
    }
    if (keepWithStock.length > 10)
      console.log(`    … and ${keepWithStock.length - 10} more`);
  }
  if (keepReferenced.length > 0) {
    console.log("  KEEP (open transfer/pick/lot references):");
    for (const b of keepReferenced.slice(0, 10)) {
      const refs = refsByBin.get(b.id)?.join(", ");
      console.log(
        `    ${b.code ?? `${b.zone}/${b.shelf}/${b.bin}`}  refs=${refs}`
      );
    }
    if (keepReferenced.length > 10)
      console.log(`    … and ${keepReferenced.length - 10} more`);
  }
  if (toDelete.length > 0 && toDelete.length <= 10) {
    console.log("  DELETE preview:");
    for (const b of toDelete) {
      console.log(`    ${b.code ?? `${b.zone}/${b.shelf}/${b.bin}`}`);
    }
  } else if (toDelete.length > 10) {
    console.log(`  DELETE preview (first 10 of ${toDelete.length}):`);
    for (const b of toDelete.slice(0, 10)) {
      console.log(`    ${b.code ?? `${b.zone}/${b.shelf}/${b.bin}`}`);
    }
  }

  if (dryRun || toDelete.length === 0) return c;

  // Delete in one transaction. Putaway + stock rules attached only to
  // the doomed bins are removed too so the cascade is clean.
  const deletedIds = toDelete.map((b) => b.id);
  await db.$transaction(async (tx) => {
    // Write an Adjust ledger row for each forced deletion that
    // actually carried stock - so the books reflect the write-off.
    for (const b of toDelete) {
      const codeUpper = (b.code ?? "").toUpperCase();
      if (!forceCodes.has(codeUpper)) continue;
      if (b.qty <= 0 || !b.productId) continue;
      await tx.stockLedger.create({
        data: {
          productId: b.productId,
          txnType: "Adjust",
          ref: `PLACEHOLDER-PURGE:${b.code}`,
          qty: -b.qty,
          balance: 0,
          warehouseId: wh.id,
          bin: b.code,
        },
      });
      await tx.product.update({
        where: { id: b.productId },
        data: { stockOnHand: { decrement: b.qty } },
      });
    }
    // For forced deletions, also detach FK references that block
    // the cascade — transfer items / pick items / lots / counts.
    if (forceCodes.size > 0) {
      const forcedIds = toDelete
        .filter((b) => forceCodes.has((b.code ?? "").toUpperCase()))
        .map((b) => b.id);
      if (forcedIds.length > 0) {
        await tx.transferOrderItem.updateMany({
          where: { fromBinId: { in: forcedIds } },
          data: { fromBinId: null },
        });
        await tx.transferOrderItem.updateMany({
          where: { toBinId: { in: forcedIds } },
          data: { toBinId: null },
        });
        await tx.salesOrderReservation.deleteMany({
          where: { binId: { in: forcedIds } },
        });
        await tx.binCount.deleteMany({ where: { binId: { in: forcedIds } } });
        await tx.stockLot.updateMany({
          where: { binId: { in: forcedIds } },
          data: { binId: null },
        });
        await tx.pickListItem.updateMany({
          where: { binId: { in: forcedIds } },
          data: { binId: null },
        });
      }
    }
    if (ruleIdsToDelete.size > 0) {
      // Only delete rules pointing exclusively to bins we're removing.
      // (A stock rule with monitor/source/dest all on this bin is
      // pointless once the bin is gone; we already filtered.)
      const ruleIds = Array.from(ruleIdsToDelete);
      const stockRulesOnDoomed = await tx.stockRule.findMany({
        where: {
          id: { in: ruleIds },
          OR: [
            { monitorBinId: { in: deletedIds } },
            { sourceBinId: { in: deletedIds } },
            { toBinId: { in: deletedIds } },
          ],
        },
        select: { id: true },
      });
      if (stockRulesOnDoomed.length > 0) {
        await tx.stockRule.deleteMany({
          where: { id: { in: stockRulesOnDoomed.map((r) => r.id) } },
        });
      }
      await tx.putawayRule.deleteMany({
        where: { toBinId: { in: deletedIds } },
      });
    }
    const res = await tx.bin.deleteMany({ where: { id: { in: deletedIds } } });
    c.deleted = res.count;
  });

  console.log(`  → Deleted ${c.deleted} empty placeholder bin(s).`);
  return c;
}

async function main() {
  console.log(
    dryRun
      ? "=== DRY RUN === (pass --apply to delete)"
      : "=== Clear warehouse placeholders === APPLYING"
  );
  if (forceCodes.size > 0) {
    console.log(`Force-delete codes (${forceCodes.size}):`);
    for (const c of forceCodes) console.log(`  ${c}`);
  }

  const whs = await db.warehouse.findMany({
    where: whFilter ? { code: whFilter } : {},
    select: { code: true },
    orderBy: { code: "asc" },
  });

  const totals: Counter = { empty: 0, withStock: 0, withReservation: 0, withReferences: 0, deleted: 0 };
  for (const w of whs) {
    const c = await processWarehouse(w.code);
    totals.empty += c.empty;
    totals.withStock += c.withStock;
    totals.withReservation += c.withReservation;
    totals.withReferences += c.withReferences;
    totals.deleted += c.deleted;
    console.log("");
  }

  console.log("=== Summary ===");
  console.log(`  ${totals.empty} placeholder bin(s) safe to delete`);
  console.log(`  ${totals.withStock} still hold stock (kept)`);
  console.log(`  ${totals.withReservation} are reserved (kept)`);
  console.log(`  ${totals.withReferences} have FK references (kept)`);
  if (apply) console.log(`  ${totals.deleted} actually deleted`);
  else console.log(`  (dry run — pass --apply to delete)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
