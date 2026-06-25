#!/usr/bin/env tsx
/**
 * Soap Room — two-BOM manufacturing setup (Rev-Soap-2.0):
 *   • Cook BOM (SOAP-PROC semi) — raw → processed drying bars
 *   • Pack BOM (BSOP FG) — semi bars → packaged retail variant
 *
 *   npm run db:seed-soap-boms:dev
 */
import { PrismaClient } from "@prisma/client";
import { binCodeFromRow } from "../src/lib/codes.js";
import {
  SOAP_ROOM_SCAN_PREFIX,
  SOAP_ROOM_WAREHOUSE_CODE,
  soapRoomBinRows,
} from "./config/soap-room-layout.js";
import {
  SOAP_BATCH_OUTPUT_QTY,
  SOAP_COOK_BOM_OPERATIONS,
  SOAP_COOK_BOM_REVISION,
  SOAP_CUT_SCRAP_QTY,
  SOAP_CUT_SCRAP_UOM,
  SOAP_CUT_VARIANT_SKU,
  SOAP_HERB_LINE_BASE,
  SOAP_LEGACY_BOM_REVISION,
  SOAP_NEEM_LINE_BASE,
  SOAP_PACK_BOM_OPERATIONS,
  SOAP_PACK_BOM_REVISION,
  SOAP_PROC_PRODUCT_SKU,
  SOAP_RAW_SKUS,
  SOAP_STR_REPLENISH_MIN_QTY,
  SOAP_VARIANT_RECIPES,
  semiVariantSku,
  soapDryingBinSlot,
  soapPackagedBinSlot,
  type SoapComponentLine,
} from "./config/soap-bom-recipes.js";
import { EXISTING_FINISHED_GOODS_WH_CODE } from "../ops-scripts/config/site-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

type OpDef = {
  seq: number;
  name: string;
  description: string;
  durationMinutes: number;
  requiresQa: boolean;
  blockedBySeq?: number;
};

type BomItemDef = {
  productId: string;
  variantId?: string | null;
  qty: number;
  uom: string;
  operationSeq: number;
};

type BomByproductDef = {
  productId: string;
  variantId: string;
  qty: number;
  uom: string;
};

const RAW_PRODUCTS = [
  { sku: SOAP_RAW_SKUS.coconutOil, name: "Raw Coconut Oil (soap grade)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.gingellyOil, name: "Raw Gingelly Oil (soap grade)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.neemOil, name: "Raw Neem Oil (soap grade)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.castorOil, name: "Raw Castor Oil (soap grade)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.causticSoda, name: "Raw Caustic Soda", uom: "kg" },
  { sku: SOAP_RAW_SKUS.dmdm, name: "Raw DMDM", uom: "kg" },
  { sku: SOAP_RAW_SKUS.flavourOil, name: "Raw Flavour Oil (soap)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.aloeGel, name: "Raw Aloe Vera Gel", uom: "kg" },
  { sku: SOAP_RAW_SKUS.tomatoJuice, name: "Tomato Juice (soap process)", uom: "kg" },
  { sku: SOAP_RAW_SKUS.cowMilk, name: "Cow Milk (soap process)", uom: "kg" },
];

async function ensureCategoryId() {
  const cat = await db.productCategory.findUnique({ where: { slug: "wellness" } });
  if (!cat) throw new Error('Category "wellness" not found.');
  return cat.id;
}

async function ensureProduct(
  sku: string,
  init: { name: string; type: string; uom: string; categoryId: string }
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
      hsn: "3401",
      state: "active",
      batchTracked: true,
      costPrice: 0,
      sellingPrice: 0,
    },
  });
}

async function persistBomOperations(
  bomId: string,
  facilityId: string,
  lineId: string,
  operations: readonly OpDef[]
) {
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

async function upsertSoapBom(opts: {
  productId: string;
  variantId: string | null;
  revision: string;
  facilityId: string;
  lineId: string;
  operations: readonly OpDef[];
  items: BomItemDef[];
  byproducts?: BomByproductDef[];
}) {
  if (dryRun) {
    console.log(
      `  [dry] ${opts.revision} — ${opts.items.length} item(s), ${opts.operations.length} op(s)`
    );
    return null;
  }

  await db.bom.updateMany({
    where: { productId: opts.productId, variantId: opts.variantId, active: true },
    data: { active: false },
  });

  let bom = await db.bom.findFirst({
    where: {
      productId: opts.productId,
      variantId: opts.variantId,
      revision: opts.revision,
    },
  });

  const bomData = {
    outputQty: SOAP_BATCH_OUTPUT_QTY,
    active: true,
    defaultFacilityId: opts.facilityId,
    defaultLineId: opts.lineId,
    operationDependencies: opts.operations.length > 1,
  };

  if (bom) {
    await db.bomItem.deleteMany({ where: { bomId: bom.id } });
    await db.bomByproduct.deleteMany({ where: { bomId: bom.id } });
    bom = await db.bom.update({ where: { id: bom.id }, data: bomData });
  } else {
    bom = await db.bom.create({
      data: {
        productId: opts.productId,
        variantId: opts.variantId,
        revision: opts.revision,
        ...bomData,
      },
    });
  }

  const seqToOp = await persistBomOperations(
    bom.id,
    opts.facilityId,
    opts.lineId,
    opts.operations
  );

  if (opts.items.length > 0) {
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
  }

  for (const bp of opts.byproducts ?? []) {
    await db.bomByproduct.create({
      data: {
        bomId: bom.id,
        productId: bp.productId,
        variantId: bp.variantId,
        qty: bp.qty,
        uom: bp.uom,
        costShare: 0,
      },
    });
  }

  return bom;
}

async function ensureSemiVariant(opts: {
  semiProductId: string;
  fgVariant: { id: string; sku: string; size: string | null; color: string | null; uom: string | null };
  displayName: string;
}) {
  const sku = semiVariantSku(opts.fgVariant.sku);
  const existing = await db.productVariant.findUnique({ where: { sku } });
  if (existing) {
    if (!dryRun) {
      await db.productVariant.update({
        where: { id: existing.id },
        data: {
          productId: opts.semiProductId,
          size: opts.fgVariant.size,
          color: `${opts.fgVariant.color ?? opts.displayName} (drying)`,
          uom: opts.fgVariant.uom ?? "pc",
          active: true,
        },
      });
    }
    return existing;
  }
  if (dryRun) return { id: `dry-${sku}`, sku, productId: opts.semiProductId };
  return db.productVariant.create({
    data: {
      productId: opts.semiProductId,
      sku,
      size: opts.fgVariant.size,
      color: `${opts.fgVariant.color ?? opts.displayName} (drying)`,
      uom: opts.fgVariant.uom ?? "pc",
      packSize: 1,
      barcode: sku,
      active: true,
    },
  });
}

async function retireLegacySemiProducts(semiParentId: string) {
  const legacy = await db.product.findMany({
    where: {
      sku: { startsWith: `${SOAP_PROC_PRODUCT_SKU}-` },
      id: { not: semiParentId },
      type: "semi",
    },
    select: { id: true, sku: true },
  });
  for (const p of legacy) {
    const rules = await db.putawayRule.deleteMany({ where: { productId: p.id } });
    const boms = await db.bom.findMany({ where: { productId: p.id }, select: { id: true } });
    for (const bom of boms) {
      const moCount = await db.productionOrder.count({ where: { bomId: bom.id } });
      if (moCount > 0) {
        await db.bom.update({ where: { id: bom.id }, data: { active: false } });
        continue;
      }
      await db.stockRule.deleteMany({ where: { bomId: bom.id } });
      await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId: bom.id } } });
      await db.bomOperation.deleteMany({ where: { bomId: bom.id } });
      await db.bomItem.deleteMany({ where: { bomId: bom.id } });
      await db.bomByproduct.deleteMany({ where: { bomId: bom.id } });
      await db.bom.delete({ where: { id: bom.id } });
    }
    await db.stockRule.deleteMany({ where: { productId: p.id } });
    await db.product.delete({ where: { id: p.id } }).catch(() => undefined);
    console.log(
      `  Deleted legacy semi product ${p.sku}` +
        (rules.count > 0 ? ` (${rules.count} stale putaway rule(s) removed)` : "")
    );
  }
}

async function ensurePutawayRule(opts: {
  productId: string;
  variantId: string | null;
  warehouseId: string;
  binId: string;
  notes: string;
}) {
  if (dryRun) return;
  const existing = await db.putawayRule.findFirst({
    where: {
      productId: opts.productId,
      variantId: opts.variantId,
      toWarehouseId: opts.warehouseId,
      active: true,
    },
  });
  if (existing) {
    await db.putawayRule.update({
      where: { id: existing.id },
      data: { toBinId: opts.binId, notes: opts.notes, priority: 10 },
    });
    return;
  }
  await db.putawayRule.create({
    data: {
      productId: opts.productId,
      variantId: opts.variantId,
      toWarehouseId: opts.warehouseId,
      toBinId: opts.binId,
      priority: 10,
      active: true,
      notes: opts.notes,
    },
  });
}

async function ensureStockRule(opts: {
  productId: string;
  variantId: string;
  monitorBinId: string;
  sourceBinId: string;
  tags: string;
  notes: string;
}) {
  const existing = await db.stockRule.findFirst({
    where: {
      productId: opts.productId,
      variantId: opts.variantId,
      monitorBinId: opts.monitorBinId,
      active: true,
    },
  });
  if (dryRun) return;
  if (existing) {
    await db.stockRule.update({
      where: { id: existing.id },
      data: {
        minQty: SOAP_STR_REPLENISH_MIN_QTY,
        triggerType: "transfer",
        sourceBinId: opts.sourceBinId,
        toBinId: opts.monitorBinId,
        tags: opts.tags,
        notes: opts.notes,
      },
    });
    return;
  }
  await db.stockRule.create({
    data: {
      productId: opts.productId,
      variantId: opts.variantId,
      monitorBinId: opts.monitorBinId,
      minQty: SOAP_STR_REPLENISH_MIN_QTY,
      triggerType: "transfer",
      sourceBinId: opts.sourceBinId,
      toBinId: opts.monitorBinId,
      tags: opts.tags,
      active: true,
      notes: opts.notes,
    },
  });
}

async function ensureSoapRoomBins(warehouseId: string, warehouseCode: string, scanPrefix: string) {
  if (dryRun) return;
  for (const r of soapRoomBinRows()) {
    const exists = await db.bin.findUnique({
      where: {
        warehouseId_zone_shelf_bin: {
          warehouseId,
          zone: r.zone,
          shelf: r.shelf,
          bin: r.bin,
        },
      },
    });
    if (exists) continue;
    await db.bin.create({
      data: {
        warehouseId,
        zone: r.zone,
        shelf: r.shelf,
        bin: r.bin,
        code: binCodeFromRow(r, { code: warehouseCode, scanPrefix }),
        qty: 0,
        reservedQty: 0,
        capacity: 9999,
      },
    });
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — soap two-BOM setup" : "Soap two-BOM setup (Rev-Soap-2.0)…\n");

  const categoryId = await ensureCategoryId();
  const facility = await db.productionFacility.findFirst({
    where: { code: { in: ["WC-SOAP", "FAC-SOAP"] } },
  });
  if (!facility) throw new Error("Soap Room facility not found.");
  const line = await db.productionLine.findFirst({
    where: { facilityId: facility.id, active: true },
    orderBy: { code: "asc" },
  });
  if (!line) throw new Error("Soap Room line not found.");

  const soapWh = await db.warehouse.findUnique({ where: { code: SOAP_ROOM_WAREHOUSE_CODE } });
  const strWh = await db.warehouse.findUnique({
    where: { code: EXISTING_FINISHED_GOODS_WH_CODE },
  });
  if (!soapWh || !strWh) throw new Error("Soap Room or STR warehouse missing.");

  await ensureSoapRoomBins(soapWh.id, soapWh.code, soapWh.scanPrefix ?? SOAP_ROOM_SCAN_PREFIX);

  console.log("Raw materials…");
  const rawBySku = new Map<string, string>();
  for (const raw of RAW_PRODUCTS) {
    const p = await ensureProduct(raw.sku, {
      name: raw.name,
      type: "raw",
      uom: raw.uom,
      categoryId,
    });
    rawBySku.set(raw.sku, p.id);
  }

  const bsop = await db.product.findUnique({
    where: { sku: "BSOP" },
    include: { variants: true },
  });
  if (!bsop) throw new Error("BSOP not found.");

  console.log("Semi-finished product SOAP-PROC + variants…");
  const semiProduct = await ensureProduct(SOAP_PROC_PRODUCT_SKU, {
    name: "Processed Bath Soap (drying WIP)",
    type: "semi",
    uom: "pc",
    categoryId,
  });

  if (!dryRun) {
    await retireLegacySemiProducts(semiProduct.id);
  }

  let cutVariant = bsop.variants.find((v) => v.sku === SOAP_CUT_VARIANT_SKU);
  if (!cutVariant && !dryRun) {
    cutVariant = await db.productVariant.create({
      data: {
        productId: bsop.id,
        sku: SOAP_CUT_VARIANT_SKU,
        size: "Cut trimmings",
        color: "Process scrap",
        uom: "kg",
        packSize: 1,
        barcode: "BSOP-CUT",
        active: true,
      },
    });
  }

  if (!dryRun) {
    const legacy = await db.bom.updateMany({
      where: { revision: SOAP_LEGACY_BOM_REVISION, active: true },
      data: { active: false },
    });
    if (legacy.count > 0) {
      console.log(`  Deactivated ${legacy.count} legacy ${SOAP_LEGACY_BOM_REVISION} BOM(s).`);
    }
  }

  console.log("\nCook + Pack BOMs per variant…");
  for (let i = 0; i < SOAP_VARIANT_RECIPES.length; i++) {
    const recipe = SOAP_VARIANT_RECIPES[i]!;
    const fgVariant = bsop.variants.find((v) => v.sku === recipe.variantSku);
    if (!fgVariant) {
      console.warn(`  ⚠ ${recipe.variantSku} missing — skipped`);
      continue;
    }
    if (!fgVariant.active && !dryRun) {
      await db.productVariant.update({ where: { id: fgVariant.id }, data: { active: true } });
    }

    const semiSku = semiVariantSku(recipe.variantSku);
    const semiVariant = await ensureSemiVariant({
      semiProductId: semiProduct.id,
      fgVariant,
      displayName: recipe.displayName,
    });

    const base = recipe.line === "neem" ? SOAP_NEEM_LINE_BASE : SOAP_HERB_LINE_BASE;
    const components: SoapComponentLine[] = [...base, ...(recipe.extraComponents ?? [])];

    await upsertSoapBom({
      productId: semiProduct.id,
      variantId: semiVariant.id,
      revision: SOAP_COOK_BOM_REVISION,
      facilityId: facility.id,
      lineId: line.id,
      operations: SOAP_COOK_BOM_OPERATIONS as unknown as OpDef[],
      items: components.map((c) => ({
        productId: rawBySku.get(SOAP_RAW_SKUS[c.rawKey])!,
        qty: c.qty,
        uom: c.uom,
        operationSeq: 1,
      })),
      byproducts: cutVariant
        ? [
            {
              productId: bsop.id,
              variantId: cutVariant.id,
              qty: SOAP_CUT_SCRAP_QTY,
              uom: SOAP_CUT_SCRAP_UOM,
            },
          ]
        : [],
    });

    await upsertSoapBom({
      productId: bsop.id,
      variantId: fgVariant.id,
      revision: SOAP_PACK_BOM_REVISION,
      facilityId: facility.id,
      lineId: line.id,
      operations: SOAP_PACK_BOM_OPERATIONS as unknown as OpDef[],
      items: [
        {
          productId: semiProduct.id,
          qty: SOAP_BATCH_OUTPUT_QTY,
          uom: "pc",
          operationSeq: 1,
        },
      ],
    });
    const drySlot = soapDryingBinSlot(i);
    const packSlot = soapPackagedBinSlot(i);
    const dryBin = await db.bin.findUnique({
      where: {
        warehouseId_zone_shelf_bin: {
          warehouseId: soapWh.id,
          zone: "A",
          shelf: drySlot.shelf,
          bin: drySlot.bin,
        },
      },
    });
    const packBin = await db.bin.findUnique({
      where: {
        warehouseId_zone_shelf_bin: {
          warehouseId: soapWh.id,
          zone: "A",
          shelf: packSlot.shelf,
          bin: packSlot.bin,
        },
      },
    });

    if (dryBin) {
      await ensurePutawayRule({
        productId: semiProduct.id,
        variantId: semiVariant.id,
        warehouseId: soapWh.id,
        binId: dryBin.id,
        notes: `Cook MO complete → drying bin A/${drySlot.shelf}/${drySlot.bin}`,
      });
    }

    if (packBin) {
      await ensurePutawayRule({
        productId: bsop.id,
        variantId: fgVariant.id,
        warehouseId: soapWh.id,
        binId: packBin.id,
        notes: `Pack MO complete → packaged shelf A/${packSlot.shelf}/${packSlot.bin}`,
      });
    }

    console.log(
      `  ✓ ${recipe.displayName}: cook→${semiSku} dry A/${drySlot.shelf}/${drySlot.bin} | pack→${recipe.variantSku}`
    );
  }

  console.log("\nStock rules (packaged shelf → STR)…");
  for (let i = 0; i < SOAP_VARIANT_RECIPES.length; i++) {
    const recipe = SOAP_VARIANT_RECIPES[i]!;
    const fgVariant = bsop.variants.find((v) => v.sku === recipe.variantSku);
    if (!fgVariant) continue;

    const packSlot = soapPackagedBinSlot(i);
    const sourceBin = await db.bin.findUnique({
      where: {
        warehouseId_zone_shelf_bin: {
          warehouseId: soapWh.id,
          zone: "A",
          shelf: packSlot.shelf,
          bin: packSlot.bin,
        },
      },
    });
    const strPutaway = await db.putawayRule.findFirst({
      where: { variantId: fgVariant.id, toWarehouseId: strWh.id, active: true },
      include: { tobin: true },
    });
    const strBin = strPutaway?.tobin;
    if (sourceBin && strBin) {
      await ensureStockRule({
        productId: bsop.id,
        variantId: fgVariant.id,
        monitorBinId: strBin.id,
        sourceBinId: sourceBin.id,
        tags: `soap,${recipe.variantSku}`,
        notes: "Auto-transfer packaged soap from Soap Room to Stock Room when STR bin is low.",
      });
      console.log(`  ✓ STR replenish: ${recipe.variantSku}`);
    }
  }

  console.log("\nDone.");
  console.log(`Cook MO: ${SOAP_COOK_BOM_REVISION} on ${SOAP_PROC_PRODUCT_SKU} (variant-level)`);
  console.log(`Pack MO: ${SOAP_PACK_BOM_REVISION} on BSOP (after ≥30 days drying)`);
  console.log("Guide: docs/soap-manufacturing-process.md");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
