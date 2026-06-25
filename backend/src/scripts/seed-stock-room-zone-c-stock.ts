/**
 * Assign opening stock to Stock Room zone C bins from floor-walk barcodes.
 *
 *   npm run db:seed-stock-room-zone-c:dev
 *   npm run db:seed-stock-room-zone-c:dev -- --dry-run
 *   npm run db:seed-stock-room-zone-c:dev -- --qty=1234
 */
import { PrismaClient, type Bin } from "@prisma/client";
import { applyBinReassign, recomputeStockOnHand } from "../lib/bin-stock-update.js";
import { binCodeFromRow } from "../lib/codes.js";
import { resolveProductScan } from "../lib/resolve-product-scan.js";
import {
  STOCK_ROOM_WAREHOUSE_CODE,
} from "../lib/stock-room-layout.js";
import {
  ZONE_C_BIN_ASSIGNMENTS,
  ZONE_C_STOCK_QTY,
  resolveZoneCBarcode,
} from "../lib/stock-room-zone-c-assignments.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const parseQty = (): number => {
  const arg = process.argv.find((a) => a.startsWith("--qty="));
  if (!arg) return ZONE_C_STOCK_QTY;
  const n = parseInt(arg.slice("--qty=".length), 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid --qty= value: ${arg}`);
  return n;
};

async function systemUserId(): Promise<string> {
  const user =
    (await db.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await db.user.findFirst({ select: { id: true } }));
  if (!user) throw new Error("No user found for bin count audit trail.");
  return user.id;
}

async function findLayoutBin(warehouseId: string, shelf: string, bin: string) {
  return db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: { warehouseId, zone: "C", shelf, bin },
    },
  });
}

async function ensureOverflowBin(
  warehouseId: string,
  warehouseCode: string,
  scanPrefix: string | null,
  shelf: string,
  baseBin: string,
  suffix: string
): Promise<Bin> {
  const binLabel = `${baseBin}${suffix}`;
  const existing = await db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: { warehouseId, zone: "C", shelf, bin: binLabel },
    },
  });
  if (existing) return existing;

  const code = binCodeFromRow(
    { zone: "C", shelf, bin: binLabel },
    { code: warehouseCode, scanPrefix }
  );

  if (dryRun) {
    return {
      id: `(new-${shelf}/${binLabel})`,
      warehouseId,
      zone: "C",
      shelf,
      bin: binLabel,
      code,
      capacity: 100,
      occupied: 0,
      productId: null,
      variantId: null,
      qty: 0,
      reservedQty: 0,
      batch: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return db.bin.create({
    data: {
      warehouseId,
      zone: "C",
      shelf,
      bin: binLabel,
      code,
      qty: 0,
      reservedQty: 0,
    },
  });
}

async function addSameProductVariantLot(
  bin: Bin,
  productId: string,
  variantId: string,
  barcode: string,
  qty: number
) {
  const batchNo = `OPEN-ZC-${barcode}`;
  const ref = `ZONE-C-${bin.zone}/${bin.shelf}/${bin.bin}`;

  if (dryRun) {
    console.log(`    [dry] +lot ${barcode} ×${qty} in ${bin.shelf}/${bin.bin}`);
    return;
  }

  await db.$transaction(async (tx) => {
    await tx.stockLot.create({
      data: {
        productId,
        variantId,
        batchNo,
        sourceType: "adjustment",
        sourceRef: ref,
        qtyOnHand: qty,
        warehouseId: bin.warehouseId,
        binId: bin.id,
      },
    });
    const updated = await tx.bin.update({
      where: { id: bin.id },
      data: { qty: { increment: qty } },
    });
    await tx.stockLedger.create({
      data: {
        productId,
        variantId,
        warehouseId: bin.warehouseId,
        bin: `${bin.zone}/${bin.shelf}/${bin.bin}`,
        batch: batchNo,
        txnType: "Adjust",
        ref,
        qty,
        balance: updated.qty,
      },
    });
    await recomputeStockOnHand(tx as unknown as typeof db, productId, variantId, qty);
  });
}

async function assignBarcodeToBin(
  targetBin: Bin,
  barcode: string,
  qty: number,
  userId: string
) {
  const resolved = await resolveProductScan(barcode);
  if (!resolved) {
    console.warn(`  ⚠ Unknown barcode ${barcode} (${targetBin.shelf}/${targetBin.bin}) — skipped`);
    return false;
  }

  const loc = `C/${targetBin.shelf}/${targetBin.bin}`;
  const empty = !targetBin.productId && (targetBin.qty ?? 0) === 0;
  const sameVariant =
    targetBin.productId === resolved.productId &&
    (targetBin.variantId ?? null) === resolved.variantId;
  const sameProductDifferentVariant =
    targetBin.productId === resolved.productId &&
    (targetBin.variantId ?? null) !== resolved.variantId &&
    resolved.variantId !== null;

  if (dryRun) {
    console.log(`  [dry] ${loc} ← ${barcode} ×${qty}`);
    return true;
  }

  if (empty || sameVariant) {
    await applyBinReassign(targetBin, {
      productId: resolved.productId,
      variantId: resolved.variantId,
      qty,
      reasonCode: "physical_match",
      remarks: `Zone C floor walk (${barcode})`,
      userId,
    });
    console.log(`  ✓ ${loc} ← ${barcode} ×${qty}`);
    return true;
  }

  if (sameProductDifferentVariant) {
    await addSameProductVariantLot(
      targetBin,
      resolved.productId,
      resolved.variantId!,
      barcode,
      qty
    );
    console.log(`  ✓ ${loc} +variant ${barcode} ×${qty} (same product)`);
    return true;
  }

  // Different product — should not happen when caller routes overflow bins.
  console.warn(
    `  ⚠ ${loc} already holds another product — cannot assign ${barcode}`
  );
  return false;
}

async function main() {
  const qty = parseQty();
  console.log(
    dryRun
      ? `DRY RUN — zone C stock assignments (qty=${qty})`
      : `Assigning zone C stock (qty=${qty})…`
  );

  const wh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
    select: { id: true, code: true, scanPrefix: true },
  });
  if (!wh) {
    throw new Error(`Warehouse ${STOCK_ROOM_WAREHOUSE_CODE} not found.`);
  }

  const userId = dryRun ? "dry-run" : await systemUserId();
  let applied = 0;
  let skipped = 0;

  for (const row of ZONE_C_BIN_ASSIGNMENTS) {
    const layoutBin = await findLayoutBin(wh.id, row.shelf, row.bin);
    if (!layoutBin) {
      console.warn(`  ⚠ Missing layout bin C/${row.shelf}/${row.bin} — skipped`);
      skipped += row.barcodes.length;
      continue;
    }

    const barcodes = row.barcodes.map(resolveZoneCBarcode);
    const resolved = [];
    for (const bc of barcodes) {
      const r = await resolveProductScan(bc);
      if (r) resolved.push({ barcode: bc, ...r });
      else {
        console.warn(`  ⚠ Unknown barcode ${bc} (C/${row.shelf}/${row.bin}) — skipped`);
        skipped++;
      }
    }
    if (resolved.length === 0) continue;

    const productIds = [...new Set(resolved.map((r) => r.productId))];
    const sameProduct = productIds.length === 1;

    if (sameProduct) {
      let bin = layoutBin;
      for (let i = 0; i < resolved.length; i++) {
        const ok = await assignBarcodeToBin(bin, resolved[i]!.barcode, qty, userId);
        if (ok) applied++;
        else skipped++;
        if (!dryRun && i === 0) {
          bin = (await db.bin.findUnique({ where: { id: layoutBin.id } })) ?? layoutBin;
        }
      }
      continue;
    }

    // Different products share one note line — primary bin + overflow suffix.
    for (let i = 0; i < resolved.length; i++) {
      const target =
        i === 0
          ? layoutBin
          : await ensureOverflowBin(
              wh.id,
              wh.code,
              wh.scanPrefix,
              row.shelf,
              row.bin,
              String.fromCharCode(65 + i - 1)
            );
      const ok = await assignBarcodeToBin(target, resolved[i]!.barcode, qty, userId);
      if (ok) applied++;
      else skipped++;
    }
  }

  console.log(`\nDone. applied=${applied} skipped=${skipped}`);
  if (!dryRun && applied > 0) {
    console.log("Run npm run db:sync-stock:dev to refresh product counters.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
