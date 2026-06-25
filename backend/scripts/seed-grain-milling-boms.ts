#!/usr/bin/env tsx
/**
 * Grain / millet manufacturing chain:
 *   1. Mill BOM (Rev-Grain-Mill-1.0)   — raw @ Big Godown → semi @ Milling WH
 *   2. Clean BOM (Rev-Grain-Clean-1.0) — semi → bulk FG @ Manual Cleaning WH
 *   3. Pack BOM (existing Rev-Pack)    — bulk @ STR → retail variants
 *
 * Stock rules (kg from variant ROP × pack size, e.g. 50×1kg + 40×500g = 70kg):
 *   • Mill MO when semi staging low
 *   • Clean MO when manual-clean semi staging low
 *   • Transfers: Big Godown raw → Mill, Mill semi → Manual Clean, Clean bulk → STR
 *
 *   npm run db:seed-grain-milling:dev
 *   npm run db:seed-grain-milling:dev -- --dry-run
 *   npm run db:seed-grain-milling:dev -- --sku BYMT
 */
import { PrismaClient } from "@prisma/client";
import {
  BIG_GODOWN_CODE,
  CLEAN_BOM_REVISION,
  CLEAN_OPERATION,
  DEFAULT_BROKEN_KG,
  DEFAULT_RAW_KG,
  DEFAULT_SEMI_KG,
  DEFAULT_WASTE_KG,
  MANUAL_CLEAN_FACILITY_CODE,
  MANUAL_CLEAN_LINE_CODE,
  MANUAL_CLEAN_WH_CODE,
  MILL_BOM_REVISION,
  MILL_BROKEN_SKU,
  MILL_FACILITY_CODE,
  MILL_LINE_CODE,
  MILL_OPERATIONS,
  MILL_WASTE_SKU,
  MILL_WH_CODE,
  STOCK_ROOM_CODE,
  WH_BIN,
  rawProductSku,
  semiProductSku,
} from "./config/grain-milling-recipes.js";
import {
  aggregateVariantDemandKg,
  mergeMissingVariantDemand,
} from "../src/lib/grain-milling-demand.js";
import { isFlourProduct, resolvePackLineKind } from "../src/lib/pack-bom.js";
import { EXISTING_FINISHED_GOODS_WH_CODE } from "../ops-scripts/config/site-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const skuFilter = process.argv.find((a) => a.startsWith("--sku="))?.slice(6)?.toUpperCase();

type OpDef = {
  seq: number;
  name: string;
  description: string;
  durationMinutes: number;
  requiresQa: boolean;
  blockedBySeq?: number;
};

async function ensureFacility(code: string, name: string, whCode: string, whName: string, description: string) {
  let wh = await db.warehouse.findUnique({ where: { code: whCode } });
  if (!wh && !dryRun) {
    wh = await db.warehouse.create({
      data: { code: whCode, name: whName, kind: "production", active: true },
    });
    for (const slot of [WH_BIN.lineStaging, WH_BIN.fgStaging]) {
      await db.bin.create({
        data: {
          warehouseId: wh.id,
          zone: slot.zone,
          shelf: slot.shelf,
          bin: slot.bin,
          code: `${whCode}.${slot.zone}${slot.shelf}.${slot.bin}`,
          qty: 0,
          reservedQty: 0,
          capacity: 9999,
        },
      });
    }
  }

  let facility = await db.productionFacility.findUnique({ where: { code } });
  if (!facility && wh && !dryRun) {
    facility = await db.productionFacility.create({
      data: {
        code,
        name,
        description,
        active: true,
        productionLineWarehouseId: wh.id,
        replenishWarehouseCodes: code === MANUAL_CLEAN_FACILITY_CODE ? MILL_WH_CODE : BIG_GODOWN_CODE,
      },
    });
  } else if (facility && wh && !dryRun) {
    await db.productionFacility.update({
      where: { id: facility.id },
      data: { productionLineWarehouseId: wh.id, description, active: true },
    });
  }

  return { facility, wh };
}

async function ensureLine(facilityId: string, lineCode: string, lineName: string) {
  let line = await db.productionLine.findUnique({ where: { code: lineCode } });
  if (!line && !dryRun) {
    line = await db.productionLine.create({
      data: { code: lineCode, name: lineName, facilityId, active: true },
    });
  } else if (line && !dryRun) {
    await db.productionLine.update({
      where: { id: line.id },
      data: { facilityId, active: true },
    });
  }
  return line;
}

async function findBin(warehouseId: string, slot: typeof WH_BIN.lineStaging) {
  return db.bin.findUnique({
    where: {
      warehouseId_zone_shelf_bin: {
        warehouseId,
        zone: slot.zone,
        shelf: slot.shelf,
        bin: slot.bin,
      },
    },
  });
}

async function ensureProduct(
  sku: string,
  init: { name: string; type: string; uom: string; categoryId: string; ecommerceEnabled?: boolean }
) {
  const existing = await db.product.findUnique({ where: { sku } });
  if (existing) return existing;
  if (dryRun) return { id: `dry-${sku}`, sku, name: init.name };
  return db.product.create({
    data: {
      sku,
      name: init.name,
      type: init.type,
      uom: init.uom,
      categoryId: init.categoryId,
      barcode: sku,
      hsn: "1008",
      state: "active",
      costPrice: 0,
      sellingPrice: 0,
      ecommerceEnabled: init.ecommerceEnabled ?? false,
      priceListEnabled: false,
    },
  });
}

async function persistBomOperations(
  bomId: string,
  facilityId: string,
  lineId: string,
  operations: readonly OpDef[]
) {
  if (dryRun) return new Map<number, string>();
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });
  const seqToId = new Map<number, string>();
  for (const op of operations) {
    const blockedByOperationId = op.blockedBySeq
      ? (seqToId.get(op.blockedBySeq) ?? null)
      : null;
    const row = await db.bomOperation.create({
      data: {
        bomId,
        seq: op.seq,
        name: op.name,
        description: op.description,
        facilityId,
        lineId,
        durationMinutes: op.durationMinutes,
        requiresQa: op.requiresQa,
        blockedByOperationId,
      },
    });
    seqToId.set(op.seq, row.id);
  }
  return seqToId;
}

async function upsertBom(opts: {
  productId: string;
  variantId: string | null;
  revision: string;
  outputQty: number;
  facilityId: string;
  lineId: string;
  operationDependencies: boolean;
  operations: readonly OpDef[];
  items: Array<{ productId: string; qty: number; uom: string; operationSeq: number }>;
  byproducts?: Array<{ productId: string; qty: number; uom: string }>;
}) {
  if (dryRun) {
    console.log(`    [dry] ${opts.revision} out=${opts.outputQty} items=${opts.items.length} ops=${opts.operations.length}`);
    return null;
  }

  await db.bom.updateMany({
    where: { productId: opts.productId, variantId: opts.variantId, revision: opts.revision, active: true },
    data: { active: false },
  });

  let bom = await db.bom.findFirst({
    where: { productId: opts.productId, variantId: opts.variantId, revision: opts.revision },
  });

  const bomData = {
    outputQty: opts.outputQty,
    active: true,
    defaultFacilityId: opts.facilityId,
    defaultLineId: opts.lineId,
    operationDependencies: opts.operationDependencies,
  };

  if (bom) {
    await db.bomItem.deleteMany({ where: { bomId: bom.id } });
    await db.bomByproduct.deleteMany({ where: { bomId: bom.id } });
    bom = await db.bom.update({ where: { id: bom.id }, data: bomData });
  } else {
    bom = await db.bom.create({
      data: { productId: opts.productId, variantId: opts.variantId, revision: opts.revision, ...bomData },
    });
  }

  const seqToOp = await persistBomOperations(bom.id, opts.facilityId, opts.lineId, opts.operations);
  await db.bomItem.createMany({
    data: opts.items.map((it) => ({
      bomId: bom!.id,
      productId: it.productId,
      qty: it.qty,
      uom: it.uom,
      scrapPct: 0,
      bomOperationId: seqToOp.get(it.operationSeq) ?? null,
    })),
  });
  for (const bp of opts.byproducts ?? []) {
    await db.bomByproduct.create({
      data: { bomId: bom.id, productId: bp.productId, qty: bp.qty, uom: bp.uom, costShare: 0 },
    });
  }
  return bom;
}

async function upsertStockRule(data: {
  productId: string;
  variantId?: string | null;
  monitorBinId: string;
  minQty: number;
  maxQty?: number | null;
  triggerType: "mo" | "transfer";
  bomId?: string | null;
  sourceBinId?: string | null;
  toBinId?: string | null;
  tags: string;
  notes: string;
}) {
  if (dryRun) return;
  const existing = await db.stockRule.findFirst({
    where: {
      productId: data.productId,
      variantId: data.variantId ?? null,
      monitorBinId: data.monitorBinId,
      triggerType: data.triggerType,
      tags: { contains: "grain-milling" },
      active: true,
    },
  });
  const payload = {
    minQty: data.minQty,
    maxQty: data.maxQty ?? null,
    bomId: data.bomId ?? null,
    sourceBinId: data.sourceBinId ?? null,
    toBinId: data.toBinId ?? data.monitorBinId,
    tags: data.tags,
    notes: data.notes,
    active: true,
  };
  if (existing) {
    await db.stockRule.update({ where: { id: existing.id }, data: payload });
  } else {
    await db.stockRule.create({
      data: {
        productId: data.productId,
        variantId: data.variantId ?? null,
        monitorBinId: data.monitorBinId,
        triggerType: data.triggerType,
        ...payload,
      },
    });
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — grain milling BOMs + rules\n" : "Seeding grain milling chain…\n");

  const { facility: millFac, wh: millWh } = await ensureFacility(
    MILL_FACILITY_CODE,
    "Milling Room",
    MILL_WH_CODE,
    "Milling Room — Production WH",
    "Multi-step raw → semi; raw from Big Godown."
  );
  const { facility: cleanFac, wh: cleanWh } = await ensureFacility(
    MANUAL_CLEAN_FACILITY_CODE,
    "Manual Cleaning Room",
    MANUAL_CLEAN_WH_CODE,
    "Manual Cleaning — Production WH",
    "Semi → bulk FG; TO to Stock Room."
  );

  if (!millFac || !cleanFac || !millWh || !cleanWh) {
    throw new Error("Facilities/warehouses missing — run ops:site-setup first.");
  }

  const millLine = await ensureLine(millFac.id, MILL_LINE_CODE, "Main Line");
  const cleanLine = await ensureLine(cleanFac.id, MANUAL_CLEAN_LINE_CODE, "Manual Cleaning Line");
  if (!millLine || !cleanLine) throw new Error("Production lines missing.");

  const bigGodown = await db.warehouse.findUnique({ where: { code: BIG_GODOWN_CODE } });
  const strWh = await db.warehouse.findUnique({ where: { code: STOCK_ROOM_CODE } });
  if (!bigGodown || !strWh) throw new Error("WH-STOR or STR not found.");

  const millRawBin = await findBin(millWh.id, WH_BIN.lineStaging);
  const millSemiBin = await findBin(millWh.id, WH_BIN.fgStaging);
  const cleanSemiBin = await findBin(cleanWh.id, WH_BIN.lineStaging);
  const cleanBulkBin = await findBin(cleanWh.id, WH_BIN.fgStaging);
  if (!millRawBin || !millSemiBin || !cleanSemiBin || !cleanBulkBin) {
    throw new Error("Production WH staging bins missing — run ops:warehouses.");
  }

  const cat = await db.productCategory.findFirst({
    where: { slug: { in: ["grains", "millets"] } },
  });
  if (!cat) throw new Error("grains/millets category not found.");

  const waste = await ensureProduct(MILL_WASTE_SKU, {
    name: "Mill process waste",
    type: "consumable",
    uom: "kg",
    categoryId: cat.id,
  });
  const broken = await ensureProduct(MILL_BROKEN_SKU, {
    name: "Broken grains",
    type: "finished",
    uom: "kg",
    categoryId: cat.id,
    ecommerceEnabled: false,
  });

  const products = await db.product.findMany({
    where: {
      type: "finished",
      uom: "kg",
      category: { slug: { in: ["grains", "millets"] } },
      ...(skuFilter ? { sku: skuFilter } : {}),
      variants: { some: { active: true } },
    },
    include: {
      category: { select: { slug: true } },
      variants: { where: { active: true }, select: { id: true, sku: true, packSize: true } },
    },
    orderBy: { sku: "asc" },
  });

  let seeded = 0;
  let skipped = 0;

  for (const product of products) {
    if (isFlourProduct(product.name, product.sku)) {
      skipped += 1;
      continue;
    }
    const lineKind = resolvePackLineKind(product.category?.slug ?? null, product.name, product.sku);
    if (lineKind !== "manual" && lineKind !== "vacuum") {
      skipped += 1;
      continue;
    }

    const rawSku = rawProductSku(product.sku);
    const raw = await db.product.findUnique({ where: { sku: rawSku } });
    if (!raw) {
      console.warn(`  ⚠ ${product.sku} — raw ${rawSku} missing`);
      skipped += 1;
      continue;
    }

    let demand = await aggregateVariantDemandKg(product.id);
    demand = mergeMissingVariantDemand(demand, product.variants, product.reorderLevel || 40);
    const ropKg = Math.max(DEFAULT_SEMI_KG, Math.ceil(demand.minKg));
    const maxKg = Math.max(ropKg + 1, Math.ceil(demand.maxKg));

    const semiSku = semiProductSku(product.sku);
    const semi = await ensureProduct(semiSku, {
      name: `Semi ${product.name} (milled)`,
      type: "semi",
      uom: "kg",
      categoryId: cat.id,
    });

    const rawBatch = DEFAULT_RAW_KG;
    const semiBatch = DEFAULT_SEMI_KG;

    console.log(`\n${product.sku} — ROP ${ropKg} kg (from ${demand.variantCount} variant rule(s))`);

    const millBom = await upsertBom({
      productId: semi.id,
      variantId: null,
      revision: MILL_BOM_REVISION,
      outputQty: semiBatch,
      facilityId: millFac.id,
      lineId: millLine.id,
      operationDependencies: true,
      operations: MILL_OPERATIONS as unknown as OpDef[],
      items: [{ productId: raw.id, qty: rawBatch, uom: "kg", operationSeq: 1 }],
      byproducts: [
        { productId: waste.id, qty: DEFAULT_WASTE_KG, uom: "kg" },
        { productId: broken.id, qty: DEFAULT_BROKEN_KG, uom: "kg" },
      ],
    });

    const cleanBom = await upsertBom({
      productId: product.id,
      variantId: null,
      revision: CLEAN_BOM_REVISION,
      outputQty: semiBatch,
      facilityId: cleanFac.id,
      lineId: cleanLine.id,
      operationDependencies: false,
      operations: [CLEAN_OPERATION as OpDef],
      items: [{ productId: semi.id, qty: semiBatch, uom: "kg", operationSeq: 1 }],
    });

    const bgdRawBin =
      (await db.bin.findFirst({
        where: { warehouseId: bigGodown.id, productId: raw.id, qty: { gte: 0 } },
      })) ?? (await db.bin.findFirst({ where: { warehouseId: bigGodown.id, qty: 0, productId: null } }));

    const strBulkBin =
      (await db.bin.findFirst({
        where: { warehouseId: strWh.id, productId: product.id, variantId: null },
      })) ??
      (await db.putawayRule.findFirst({
        where: { productId: product.id, variantId: null, toWarehouseId: strWh.id, active: true },
        select: { toBinId: true },
      }).then((p) => (p?.toBinId ? db.bin.findUnique({ where: { id: p.toBinId } }) : null)));

    if (millBom && bgdRawBin) {
      await upsertStockRule({
        productId: raw.id,
        monitorBinId: millRawBin.id,
        minQty: rawBatch,
        triggerType: "transfer",
        sourceBinId: bgdRawBin.id,
        tags: "grain-milling,raw-replenish",
        notes: `${product.sku}: transfer raw from Big Godown when mill line staging low.`,
      });
    }

    if (millBom) {
      await upsertStockRule({
        productId: semi.id,
        monitorBinId: millSemiBin.id,
        minQty: ropKg,
        maxQty: maxKg,
        triggerType: "mo",
        bomId: millBom.id,
        tags: "grain-milling,mill-mo",
        notes: `${product.sku}: mill MO when semi < ${ropKg} kg (variant ROP sum).`,
      });
    }

    await upsertStockRule({
      productId: semi.id,
      monitorBinId: cleanSemiBin.id,
      minQty: semiBatch,
      triggerType: "transfer",
      sourceBinId: millSemiBin.id,
      tags: "grain-milling,semi-to-clean",
      notes: `${product.sku}: TO semi Mill → Manual Cleaning when clean line staging low.`,
    });

    if (cleanBom && strBulkBin) {
      await upsertStockRule({
        productId: product.id,
        monitorBinId: strBulkBin.id,
        minQty: ropKg,
        maxQty: maxKg,
        triggerType: "mo",
        bomId: cleanBom.id,
        tags: "grain-milling,clean-mo",
        notes: `${product.sku}: clean MO when STR bulk < ${ropKg} kg — consumes semi, posts bulk to clean FG then TO.`,
      });
    }

    if (strBulkBin) {
      await upsertStockRule({
        productId: product.id,
        monitorBinId: strBulkBin.id,
        minQty: ropKg,
        triggerType: "transfer",
        sourceBinId: cleanBulkBin.id,
        tags: "grain-milling,bulk-to-str",
        notes: `${product.sku}: TO cleaned bulk Manual Clean → Stock Room.`,
      });
    }

    seeded += 1;
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done: ${seeded} product chain(s), ${skipped} skipped.` +
      `\n  Mill: ${MILL_BOM_REVISION} @ ${MILL_FACILITY_CODE} (100 kg raw → 70 kg semi + waste/broken)` +
      `\n  Clean: ${CLEAN_BOM_REVISION} @ ${MANUAL_CLEAN_FACILITY_CODE} (semi → bulk FG)` +
      `\n  Pack: existing Rev-Pack BOMs on variants @ STR` +
      `\n  ROP (kg) = Σ variant ROP × pack size from stock rules`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
