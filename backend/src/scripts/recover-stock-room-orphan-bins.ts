/**
 * Reconstruct Stock Room (STR) bins that were accidentally deleted by an
 * over-eager run of prune-warehouse-zones.ts.
 *
 * StockLedger.bin is a string column (not FK), so all history survived
 * the Bin row deletion. For every (product, bin-code) in the ledger
 * whose bin no longer exists, this script:
 *   1. Recomputes the last-known on-hand qty by summing ledger rows.
 *   2. Re-creates the Bin row in STR with zone/shelf/bin parsed from
 *      the code and qty = computed balance.
 *
 * Only recreates bins in zones A, B, C (the kept zones). Bins in
 * zones outside A/B/C were intentionally pruned per ops request.
 *
 *   npm run db:recover-stock-room-bins:dev -- --dry-run
 *   npm run db:recover-stock-room-bins:dev
 */

import { PrismaClient } from "@prisma/client";

const dryRun = process.argv.includes("--dry-run");
const db = new PrismaClient();

const STR_CODE = "STR";
const KEEP_ZONES = new Set(["A", "B", "C"]);

// Parse a stored bin string. Stock Room codes look like:
//   "A/S001/01"   (zone/shelf/bin)
//   "AS001.01"    (zone+shelf.bin compact)
//   "STR.AS006.01" (warehouse.zone+shelf.bin) — strip the STR prefix
//   "B/S031/02"
// Returns null if we can't extract a valid (zone, shelf, bin) triple
// where zone is a single letter.
function parseBinCode(
  raw: string
): { zone: string; shelf: string; bin: string } | null {
  let s = raw.trim();
  if (!s) return null;
  // Strip warehouse prefix if present.
  if (s.toUpperCase().startsWith("STR.")) s = s.slice(4);
  if (s.toUpperCase().startsWith("STR/")) s = s.slice(4);

  // Slash-delimited variant: A/S001/01
  const slashParts = s.split("/").map((p) => p.trim()).filter(Boolean);
  if (slashParts.length === 3) {
    const [zone, shelf, bin] = slashParts as [string, string, string];
    if (zone.length === 1) {
      return {
        zone: zone.toUpperCase(),
        shelf: shelf.toUpperCase(),
        bin: bin.toUpperCase(),
      };
    }
  }

  // Compact variant: AS006.01 or A.S006.01
  const dotParts = s.split(".").map((p) => p.trim()).filter(Boolean);
  if (dotParts.length === 2) {
    const [zoneShelf, bin] = dotParts as [string, string];
    if (zoneShelf.length >= 2) {
      const zone = zoneShelf[0]!.toUpperCase();
      const shelf = zoneShelf.slice(1).toUpperCase();
      return { zone, shelf, bin: bin.toUpperCase() };
    }
  }
  if (dotParts.length === 3) {
    const [zone, shelf, bin] = dotParts as [string, string, string];
    if (zone.length === 1) {
      return {
        zone: zone.toUpperCase(),
        shelf: shelf.toUpperCase(),
        bin: bin.toUpperCase(),
      };
    }
  }

  return null;
}

async function main() {
  console.log(dryRun ? "=== DRY RUN ===" : "=== Recover STR bins ===");

  const wh = await db.warehouse.findUnique({ where: { code: STR_CODE } });
  if (!wh) {
    console.error(`Warehouse ${STR_CODE} not found.`);
    process.exit(1);
  }

  // Map of every (productId, variantId, binString) -> sum of ledger qty.
  // This is the authoritative on-hand at that bin.
  const rows = await db.stockLedger.groupBy({
    by: ["productId", "variantId", "bin"],
    where: { warehouseId: wh.id, bin: { not: null } },
    _sum: { qty: true },
  });

  // Existing bin codes still in DB - we won't touch these.
  const existing = await db.bin.findMany({
    where: { warehouseId: wh.id },
    select: { code: true, zone: true, shelf: true, bin: true },
  });
  const existingCodes = new Set<string>();
  for (const b of existing) {
    if (b.code) existingCodes.add(b.code.toUpperCase());
    existingCodes.add(`${b.zone}/${b.shelf}/${b.bin}`.toUpperCase());
    existingCodes.add(`${b.zone}${b.shelf}.${b.bin}`.toUpperCase());
    existingCodes.add(`STR.${b.zone}${b.shelf}.${b.bin}`.toUpperCase());
  }

  type Lost = {
    binRaw: string;
    parsed: { zone: string; shelf: string; bin: string };
    productId: string;
    variantId: string | null;
    qty: number;
  };
  const lost: Lost[] = [];
  const unparseable: string[] = [];
  const droppedZones: string[] = [];

  for (const r of rows) {
    const binRaw = r.bin ?? "";
    const qty = r._sum.qty ?? 0;
    if (qty <= 0) continue; // only care about positive balances
    if (!binRaw || binRaw === "—") continue;
    if (existingCodes.has(binRaw.toUpperCase())) continue;

    const parsed = parseBinCode(binRaw);
    if (!parsed) {
      unparseable.push(binRaw);
      continue;
    }
    if (existingCodes.has(`${parsed.zone}/${parsed.shelf}/${parsed.bin}`)) {
      continue;
    }
    if (!KEEP_ZONES.has(parsed.zone)) {
      droppedZones.push(`${binRaw} (zone ${parsed.zone})`);
      continue;
    }
    lost.push({
      binRaw,
      parsed,
      productId: r.productId,
      variantId: r.variantId,
      qty,
    });
  }

  // De-duplicate ledger rows for the same product+bin (different variants
  // can legitimately appear; product+variant+bin is the natural key).
  const grouped = new Map<string, Lost>();
  for (const l of lost) {
    const k = `${l.productId}|${l.variantId ?? ""}|${l.parsed.zone}/${l.parsed.shelf}/${l.parsed.bin}`;
    const existing = grouped.get(k);
    if (existing) existing.qty += l.qty;
    else grouped.set(k, { ...l });
  }
  const final = Array.from(grouped.values()).sort((a, b) =>
    `${a.parsed.zone}/${a.parsed.shelf}/${a.parsed.bin}`.localeCompare(
      `${b.parsed.zone}/${b.parsed.shelf}/${b.parsed.bin}`
    )
  );

  console.log(`\nFound ${final.length} (product × bin) entries to recover.`);
  if (unparseable.length > 0) {
    console.log(`Unparseable bin strings (skipped): ${unparseable.length}`);
    for (const s of [...new Set(unparseable)].slice(0, 10)) console.log(`  ${s}`);
  }
  if (droppedZones.length > 0) {
    console.log(
      `Skipped (zone outside A/B/C): ${droppedZones.length} entries — these zones were intentionally removed.`
    );
  }

  // Unique bin codes to recreate.
  const binsToCreate = new Map<
    string,
    { zone: string; shelf: string; bin: string; code: string }
  >();
  for (const l of final) {
    const code = `${l.parsed.zone}${l.parsed.shelf}.${l.parsed.bin}`;
    binsToCreate.set(code, { ...l.parsed, code });
  }

  console.log(`\nUnique bins to recreate: ${binsToCreate.size}`);
  const totalQty = final.reduce((s, l) => s + l.qty, 0);
  console.log(`Total qty to restore:    ${totalQty.toFixed(2)}`);

  // Preview first 15 lines.
  console.log("\nPreview (first 15):");
  for (const l of final.slice(0, 15)) {
    console.log(
      `  ${l.parsed.zone}/${l.parsed.shelf}/${l.parsed.bin}  product=${l.productId}  qty=${l.qty}`
    );
  }
  if (final.length > 15) console.log(`  … and ${final.length - 15} more`);

  if (dryRun) {
    console.log("\nDry run — no DB writes.");
    return;
  }

  // Apply.
  console.log("\nApplying...");
  let createdBins = 0;
  let createdLedger = 0;
  await db.$transaction(async (tx) => {
    // 1) Recreate Bin rows (one per unique zone/shelf/bin).
    const binIdByCode = new Map<string, string>();
    for (const b of binsToCreate.values()) {
      // Defensive: if someone re-created the same bin between dry-run
      // and apply, skip it instead of throwing.
      const existing = await tx.bin.findFirst({
        where: {
          warehouseId: wh.id,
          zone: b.zone,
          shelf: b.shelf,
          bin: b.bin,
        },
      });
      if (existing) {
        binIdByCode.set(b.code, existing.id);
        continue;
      }
      const created = await tx.bin.create({
        data: {
          warehouseId: wh.id,
          zone: b.zone,
          shelf: b.shelf,
          bin: b.bin,
          code: b.code,
          qty: 0,
        },
      });
      binIdByCode.set(b.code, created.id);
      createdBins++;
    }

    // 2) For each (product, bin), set the bin qty to the computed
    //    balance. Because Prisma's Bin uses a unique-by-warehouse+zone+
    //    shelf+bin, but Bin.productId is per-bin, we'll create one
    //    bin row per (bin, productId) only if necessary. The legacy
    //    layout used product-agnostic bins, so we update qty in place
    //    and assign productId if not yet set.
    for (const l of final) {
      const code = `${l.parsed.zone}${l.parsed.shelf}.${l.parsed.bin}`;
      const binId = binIdByCode.get(code);
      if (!binId) continue;
      // If the bin already has a different product, we need a sibling
      // row in the same physical location. The Bin schema may or may
      // not support this; cheapest is to update with the productId
      // only when blank.
      const cur = await tx.bin.findUnique({ where: { id: binId } });
      if (!cur) continue;
      if (cur.productId && cur.productId !== l.productId) {
        // Shouldn't normally happen, but log so the operator can sort
        // it out manually.
        console.warn(
          `  WARNING: bin ${code} already pinned to product ${cur.productId}; recovery row for ${l.productId} skipped.`
        );
        continue;
      }
      await tx.bin.update({
        where: { id: binId },
        data: {
          productId: l.productId,
          qty: { increment: l.qty },
        },
      });

      // 3) Audit row in the ledger so the balance has a paper trail.
      await tx.stockLedger.create({
        data: {
          productId: l.productId,
          variantId: l.variantId,
          txnType: "Adjust",
          ref: "RECOVERY-BIN-PRUNE",
          qty: 0,
          balance: l.qty,
          warehouseId: wh.id,
          bin: code,
        },
      });
      createdLedger++;
    }
  });

  console.log(
    `\nDone. Created ${createdBins} bin(s) and wrote ${createdLedger} audit ledger row(s).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
