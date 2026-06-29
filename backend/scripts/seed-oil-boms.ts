#!/usr/bin/env tsx
/**
 * Oil Extraction — three-BOM setup per seed-press oil:
 *   • Extract BOM on {OIL}-UNFILT semi — seeds → unfiltered oil + cake
 *   • Filter BOM on finished oil parent — unfiltered → bulk filtered oil
 *   • Pack BOMs on variants — auto via generatePackBoms (WC-OIL-FILL)
 *
 *   npm run db:seed-oil-boms:dev
 *   npm run db:seed-oil-boms:dev -- --dry-run
 *   npm run db:seed-oil-boms:dev -- --skip-pack
 */
import { PrismaClient } from "@prisma/client";
import {
  OIL_EXTRACT_BOM_REVISION,
  OIL_EXTRACT_LINE_CODES,
  OIL_EXTRACT_OPERATION,
  OIL_FACILITY_CODE,
  OIL_FILTER_BOM_REVISION,
  OIL_FILTER_LINE_CODES,
  OIL_FILTER_OPERATION,
  OIL_FILL_LINE_CODE,
  OIL_PROCESS_RECIPES,
  unfilteredSemiSku,
} from "./config/oil-bom-recipes.js";
import { generatePackBomsForProduct } from "../src/lib/generate-pack-boms.js";
import { OIL_LOCAL_STORAGE_CODE } from "../ops-scripts/config/site-layout.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const skipPack = process.argv.includes("--skip-pack");

type OpDef = {
  seq: number;
  name: string;
  description: string;
  durationMinutes: number;
  requiresQa: boolean;
  eligibleLineIds?: string[];
};

type BomItemDef = {
  productId: string;
  qty: number;
  uom: string;
  operationSeq: number;
};

type BomByproductDef = {
  productId: string;
  variantId?: string | null;
  qty: number;
  uom: string;
};

async function ensureCategoryId() {
  const cat = await db.productCategory.findFirst({
    where: { slug: { in: ["oils-oil-seeds", "oils"] } },
  });
  if (!cat) throw new Error('Category "oils" not found.');
  return cat.id;
}

async function ensureProduct(
  sku: string,
  init: {
    name: string;
    type: string;
    uom: string;
    categoryId: string;
    ecommerceEnabled?: boolean;
    priceListEnabled?: boolean;
    batchTracked?: boolean;
  }
) {
  const existing = await db.product.findUnique({ where: { sku } });
  if (existing) {
    if (!dryRun && init.ecommerceEnabled === false && existing.ecommerceEnabled) {
      await db.product.update({
        where: { id: existing.id },
        data: { ecommerceEnabled: false },
      });
    }
    return existing;
  }
  if (dryRun) return { id: `dry-${sku}`, sku, name: init.name };
  return db.product.create({
    data: {
      sku,
      name: init.name,
      type: init.type,
      uom: init.uom,
      categoryId: init.categoryId,
      barcode: sku,
      hsn: "1514",
      state: "active",
      batchTracked: init.batchTracked ?? true,
      costPrice: 0,
      sellingPrice: 0,
      ecommerceEnabled: init.ecommerceEnabled ?? false,
      priceListEnabled: init.priceListEnabled ?? true,
    },
  });
}

async function persistBomOperations(
  bomId: string,
  facilityId: string,
  defaultLineId: string,
  operations: readonly OpDef[]
) {
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });

  for (const op of operations) {
    const row = await db.bomOperation.create({
      data: {
        bomId,
        seq: op.seq,
        name: op.name,
        description: op.description,
        facilityId,
        lineId: defaultLineId,
        durationMinutes: op.durationMinutes,
        requiresQa: op.requiresQa,
      },
    });
    for (const lineId of op.eligibleLineIds ?? []) {
      await db.bomOperationLine.create({
        data: { bomOperationId: row.id, lineId },
      });
    }
  }
}

async function upsertOilBom(opts: {
  productId: string;
  variantId: string | null;
  revision: string;
  outputQty: number;
  facilityId: string;
  lineId: string;
  operations: readonly OpDef[];
  items: BomItemDef[];
  byproducts?: BomByproductDef[];
  operationDependencies?: boolean;
}) {
  if (dryRun) {
    console.log(
      `  [dry] ${opts.revision} — ${opts.items.length} item(s), ${opts.operations.length} op(s), out=${opts.outputQty}`
    );
    return null;
  }

  await db.bom.updateMany({
    where: {
      productId: opts.productId,
      variantId: opts.variantId,
      revision: opts.revision,
      active: true,
    },
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
    outputQty: opts.outputQty,
    active: true,
    defaultFacilityId: opts.facilityId,
    defaultLineId: opts.lineId,
    operationDependencies: opts.operationDependencies ?? false,
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

  const seqToOp = new Map<number, string>();
  await persistBomOperations(bom.id, opts.facilityId, opts.lineId, opts.operations);
  const ops = await db.bomOperation.findMany({
    where: { bomId: bom.id },
    select: { id: true, seq: true },
  });
  for (const op of ops) seqToOp.set(op.seq, op.id);

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
        variantId: bp.variantId ?? null,
        qty: bp.qty,
        uom: bp.uom,
        costShare: 0,
      },
    });
  }

  return bom;
}

async function resolveLines() {
  const facility = await db.productionFacility.findFirst({
    where: { code: OIL_FACILITY_CODE, active: true },
  });
  if (!facility) {
    throw new Error(`${OIL_FACILITY_CODE} not found — run db:configure-oil-extraction:dev first.`);
  }

  const lineByCode = new Map<string, string>();
  for (const code of [
    ...OIL_EXTRACT_LINE_CODES,
    ...OIL_FILTER_LINE_CODES,
    OIL_FILL_LINE_CODE,
  ]) {
    const line = await db.productionLine.findFirst({
      where: { code, facilityId: facility.id, active: true },
    });
    if (!line) throw new Error(`Line ${code} not found on ${OIL_FACILITY_CODE}.`);
    lineByCode.set(code, line.id);
  }

  return {
    facilityId: facility.id,
    extractLineIds: OIL_EXTRACT_LINE_CODES.map((c) => lineByCode.get(c)!),
    filterLineIds: OIL_FILTER_LINE_CODES.map((c) => lineByCode.get(c)!),
    defaultExtractLineId: lineByCode.get(OIL_EXTRACT_LINE_CODES[0]!)!,
    defaultFilterLineId: lineByCode.get(OIL_FILTER_LINE_CODES[0]!)!,
    fillLineId: lineByCode.get(OIL_FILL_LINE_CODE)!,
  };
}

async function markCakePosOnly(cakeSku: string) {
  if (dryRun) return;
  await db.product.updateMany({
    where: { sku: cakeSku },
    data: { ecommerceEnabled: false, priceListEnabled: true },
  });
}

async function main() {
  console.log(
    dryRun
      ? "DRY RUN — oil three-BOM setup\n"
      : "Oil extraction three-BOM setup (Rev-Oil-1.0)…\n"
  );

  const categoryId = await ensureCategoryId();
  const lines = await resolveLines();

  const oilWh = await db.warehouse.findUnique({ where: { code: OIL_LOCAL_STORAGE_CODE } });
  if (!oilWh) {
    console.warn(`  ⚠ ${OIL_LOCAL_STORAGE_CODE} not found — putaway rules skipped.`);
  }

  let extractCount = 0;
  let filterCount = 0;
  let packCount = 0;
  let skipped = 0;

  for (const recipe of OIL_PROCESS_RECIPES) {
    const oil = await db.product.findUnique({
      where: { sku: recipe.oilSku },
      include: { variants: { where: { active: true } } },
    });
    if (!oil) {
      console.warn(`  ⚠ ${recipe.oilSku} missing — skipped`);
      skipped += 1;
      continue;
    }

    const seed = await db.product.findUnique({ where: { sku: recipe.seedSku } });
    if (!seed) {
      console.warn(`  ⚠ seed ${recipe.seedSku} for ${recipe.oilSku} missing — skipped`);
      skipped += 1;
      continue;
    }

    let cakeId: string | null = null;
    if (recipe.cakeSku) {
      const cake = await db.product.findUnique({ where: { sku: recipe.cakeSku } });
      if (!cake) {
        console.warn(`  ⚠ cake ${recipe.cakeSku} for ${recipe.oilSku} missing — extract without byproduct`);
      } else {
        cakeId = cake.id;
        await markCakePosOnly(recipe.cakeSku);
      }
    }

    const semiSku = unfilteredSemiSku(recipe.oilSku);
    const semi = await ensureProduct(semiSku, {
      name: `Unfiltered ${recipe.oilName}`,
      type: "semi",
      uom: "L",
      categoryId,
      ecommerceEnabled: false,
      priceListEnabled: false,
      batchTracked: true,
    });

    const extractOps: OpDef[] = [
      {
        ...OIL_EXTRACT_OPERATION,
        eligibleLineIds: lines.extractLineIds,
      },
    ];

    await upsertOilBom({
      productId: semi.id,
      variantId: null,
      revision: OIL_EXTRACT_BOM_REVISION,
      outputQty: recipe.unfilteredOutputQty,
      facilityId: lines.facilityId,
      lineId: lines.defaultExtractLineId,
      operations: extractOps,
      items: [
        {
          productId: seed.id,
          qty: recipe.seedQty,
          uom: seed.uom,
          operationSeq: 1,
        },
      ],
      byproducts:
        cakeId && recipe.cakeQty
          ? [{ productId: cakeId, qty: recipe.cakeQty, uom: "kg" }]
          : [],
    });
    extractCount += 1;

    const filterOps: OpDef[] = [
      {
        ...OIL_FILTER_OPERATION,
        eligibleLineIds: lines.filterLineIds,
      },
    ];

    await upsertOilBom({
      productId: oil.id,
      variantId: null,
      revision: OIL_FILTER_BOM_REVISION,
      outputQty: recipe.filteredOutputQty,
      facilityId: lines.facilityId,
      lineId: lines.defaultFilterLineId,
      operations: filterOps,
      items: [
        {
          productId: semi.id,
          qty: recipe.unfilteredOutputQty,
          uom: "L",
          operationSeq: 1,
        },
      ],
    });
    filterCount += 1;

    if (!skipPack && oil.variants.length > 0) {
      if (dryRun) {
        console.log(`  [dry] pack BOMs for ${recipe.oilSku} (${oil.variants.length} variant(s))`);
        packCount += oil.variants.length;
      } else {
        const packResult = await generatePackBomsForProduct(oil.id, {
          force: true,
          routedCategoriesOnly: true,
        });
        if (packResult) {
          packCount += packResult.created.length + packResult.updated.length;
          if (packResult.skipped.length > 0) {
            for (const s of packResult.skipped) {
              console.warn(`    pack skip ${s.variantSku}: ${s.reason}`);
            }
          }
        }
      }
    }

    console.log(
      `  ✓ ${recipe.oilSku}: ${recipe.seedQty} kg ${recipe.seedSku} → ${semiSku} (${recipe.unfilteredOutputQty} L) → ${recipe.filteredOutputQty} L bulk → variants`
    );
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done.` +
      `\n  extract BOMs: ${extractCount}` +
      `\n  filter BOMs: ${filterCount}` +
      `\n  pack BOM rows: ${packCount}` +
      (skipped ? `\n  skipped recipes: ${skipped}` : "") +
      `\n\nFlow: MO on ${OIL_EXTRACT_BOM_REVISION} (split across ${OIL_EXTRACT_LINE_CODES.length} lines) →` +
      ` ${OIL_FILTER_BOM_REVISION} → Rev-Pack-1.0 on ${OIL_FILL_LINE_CODE}.` +
      `\nCake co-products: ecommerce off, price list on (farm-shop POS).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
