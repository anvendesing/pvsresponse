#!/usr/bin/env tsx
/**
 * Step 3 — Finished-goods putaway: one fixed bin per variant in Stock Room (STR).
 *
 * Layout: 4 bins per shelf; each shelf gets a pseudo-random zone (stable on re-run).
 *
 *   npm run ops:putaway-fg
 *   npm run ops:putaway-fg -- --dry-run
 */

import { EXISTING_FINISHED_GOODS_WH_CODE } from "./config/site-layout.js";
import { binCodeFromRow, db, dryRun, log } from "./lib/db.js";

const BINS_PER_SHELF = 4;
const ZONE_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXY".split("");

/** Deterministic shuffle so zones look random but re-runs stay stable. */
function shuffledZones(seed = 0x505653): string[] {
  const arr = [...ZONE_POOL];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (seed + i * 1103515245) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function slotForIndex(index: number) {
  const shelfIndex = Math.floor(index / BINS_PER_SHELF);
  const binOnShelf = String((index % BINS_PER_SHELF) + 1).padStart(2, "0");
  const shelf = `S${String(shelfIndex + 1).padStart(3, "0")}`;
  const zone = shuffledZones()[shelfIndex % ZONE_POOL.length];
  return { zone, shelf, bin: binOnShelf, shelfIndex };
}

type Target = {
  productId: string;
  variantId: string | null;
  label: string;
};

async function ensureFgBin(
  warehouseId: string,
  warehouseCode: string,
  zone: string,
  shelf: string,
  binLabel: string
) {
  const code = binCodeFromRow({ zone, shelf, bin: binLabel }, warehouseCode);
  const existing = await db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: {
        warehouseId,
        zone,
        shelf,
        bin: binLabel,
      },
    },
  });
  if (existing) {
    if (!dryRun && !existing.code) {
      await db.bin.update({ where: { id: existing.id }, data: { code } });
    }
    return existing;
  }
  if (dryRun) {
    log(`  [dry] bin ${warehouseCode} ${zone}/${shelf}/${binLabel}`);
    return null;
  }
  return db.bin.create({
    data: {
      warehouseId,
      zone,
      shelf,
      bin: binLabel,
      code,
      qty: 0,
      reservedQty: 0,
      capacity: 9999,
    },
  });
}

async function upsertPutawayRule(
  target: Target,
  warehouseId: string,
  binId: string | null
) {
  const data = {
    toWarehouseId: warehouseId,
    toBinId: binId,
    priority: 100,
    active: true,
    notes: "ops: FG variant bin (4 bins/shelf, random zone)",
  };

  const existing = await db.putawayRule.findFirst({
    where: {
      productId: target.productId,
      variantId: target.variantId,
    },
    orderBy: { createdAt: "desc" },
  });

  if (dryRun) {
    log(
      `  [dry] rule ${target.label} → ${binId ? "bin" : "WH only"} (${target.variantId ?? "product"})`
    );
    return;
  }

  if (existing) {
    await db.putawayRule.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await db.putawayRule.create({
    data: {
      productId: target.productId,
      variantId: target.variantId,
      ...data,
    },
  });
}

async function loadTargets(): Promise<Target[]> {
  const variants = await db.productVariant.findMany({
    where: {
      active: true,
      product: { state: "active" },
    },
    select: {
      id: true,
      sku: true,
      productId: true,
      product: { select: { sku: true } },
    },
    orderBy: [{ product: { sku: "asc" } }, { sku: "asc" }],
  });

  const targets: Target[] = variants.map((v) => ({
    productId: v.productId,
    variantId: v.id,
    label: `${v.product.sku} / ${v.sku}`,
  }));

  const bareProducts = await db.product.findMany({
    where: { state: "active", variants: { none: {} } },
    select: { id: true, sku: true },
    orderBy: { sku: "asc" },
  });

  for (const p of bareProducts) {
    targets.push({
      productId: p.id,
      variantId: null,
      label: p.sku,
    });
  }

  return targets;
}

async function main() {
  log(
    dryRun
      ? "03-putaway-fg (DRY RUN)"
      : "03-putaway-fg — variant bins + putaway rules in finished goods…"
  );

  const wh = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
  });
  if (!wh) {
    throw new Error(
      `Warehouse ${EXISTING_FINISHED_GOODS_WH_CODE} not found. Create finished-goods WH in Settings first.`
    );
  }
  if (!wh.active) {
    log(`  ⚠ ${wh.code} is inactive — activate before MO complete putaway.`);
  }

  const targets = await loadTargets();
  if (targets.length === 0) {
    log("  ⚠ No active variants or products — import catalog first.");
    return;
  }

  const shelvesNeeded = Math.ceil(targets.length / BINS_PER_SHELF);
  log(
    `  ${targets.length} target(s), ${shelvesNeeded} shelf row(s) (${BINS_PER_SHELF} bins/shelf), warehouse ${wh.code}`
  );

  let binsEnsured = 0;
  let rulesSet = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const { zone, shelf, bin } = slotForIndex(i);
    const row = await ensureFgBin(wh.id, wh.code, zone, shelf, bin);
    if (row) binsEnsured++;

    await upsertPutawayRule(t, wh.id, row?.id ?? null);
    if (!dryRun) rulesSet++;
  }

  log(
    `  ✓ ${dryRun ? "would configure" : "configured"} ${targets.length} putaway rule(s), ${binsEnsured} bin slot(s) in ${wh.code}`
  );
  if (!dryRun) {
    log(
      `  ℹ Layout: zone rotates pseudo-randomly per shelf; bins 01–04 on S001, S002, …`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
