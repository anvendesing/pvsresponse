/**
 * Create or refresh auto packaging BOMs for a product's variants.
 */
import { db } from "../db.js";
import {
  MANUAL_PACK_FACILITY_CODE,
  MANUAL_PACK_LINE_CODE,
  OIL_PACK_FACILITY_CODE,
  OIL_PACK_LINE_CODE,
  PACK_BOM_REVISION,
  SNACKS_PACK_FACILITY_CODES,
  SNACKS_PACK_LINE_CODES,
  VACUUM_PACK_FACILITY_CODE,
  VACUUM_PACK_LINE_CODE,
  computePackBatch,
  effectivePackSize,
  packOperationDescription,
  packOperationDurationMinutes,
  packOperationName,
  resolvePackLineKind,
  type PackLineKind,
} from "./pack-bom.js";

export type GeneratePackBomOpts = {
  /** When true, deactivate and recreate auto BOMs even if one exists. */
  force?: boolean;
  /** When true, only assign facility/line for routed categories. */
  routedCategoriesOnly?: boolean;
  /** When true, compute results without writing. */
  dryRun?: boolean;
};

export type GeneratePackBomResult = {
  productSku: string;
  created: Array<{ variantSku: string; bomId: string; batch: string; line: string | null }>;
  updated: Array<{ variantSku: string; bomId: string; batch: string; line: string | null }>;
  skipped: Array<{ variantSku: string; reason: string }>;
};

type LineRefs = {
  facilityId: string;
  lineId: string;
};

let lineCache: Partial<Record<PackLineKind, LineRefs | null>> | null = null;

async function resolveLineRefs(kind: PackLineKind): Promise<LineRefs | null> {
  if (!lineCache) lineCache = {};
  if (lineCache[kind] !== undefined) return lineCache[kind] ?? null;

  if (kind === "snacks") {
    const facility = await db.productionFacility.findFirst({
      where: { code: { in: [...SNACKS_PACK_FACILITY_CODES] }, active: true },
      select: { id: true },
    });
    if (!facility) {
      lineCache[kind] = null;
      return null;
    }
    for (const lineCode of SNACKS_PACK_LINE_CODES) {
      const line = await db.productionLine.findFirst({
        where: { code: lineCode, facilityId: facility.id, active: true },
        select: { id: true },
      });
      if (line) {
        const refs = { facilityId: facility.id, lineId: line.id };
        lineCache[kind] = refs;
        return refs;
      }
    }
    lineCache[kind] = null;
    return null;
  }

  const facilityCode =
    kind === "oil"
      ? OIL_PACK_FACILITY_CODE
      : kind === "manual"
        ? MANUAL_PACK_FACILITY_CODE
        : VACUUM_PACK_FACILITY_CODE;
  const lineCode =
    kind === "oil"
      ? OIL_PACK_LINE_CODE
      : kind === "manual"
        ? MANUAL_PACK_LINE_CODE
        : VACUUM_PACK_LINE_CODE;

  const facility = await db.productionFacility.findFirst({
    where: { code: facilityCode, active: true },
    select: { id: true },
  });
  if (!facility) {
    lineCache[kind] = null;
    return null;
  }
  const line = await db.productionLine.findFirst({
    where: { code: lineCode, facilityId: facility.id, active: true },
    select: { id: true },
  });
  if (!line) {
    lineCache[kind] = null;
    return null;
  }
  const refs = { facilityId: facility.id, lineId: line.id };
  lineCache[kind] = refs;
  return refs;
}

async function upsertPackOperation(
  bomId: string,
  lineKind: PackLineKind,
  refs: LineRefs
) {
  const existing = await db.bomOperation.findFirst({
    where: { bomId },
    orderBy: { seq: "asc" },
  });
  if (existing) {
    await db.bomOperation.update({
      where: { id: existing.id },
      data: {
        name: packOperationName(lineKind),
        description: packOperationDescription(lineKind),
        facilityId: refs.facilityId,
        lineId: refs.lineId,
      },
    });
    return existing.id;
  }
  const op = await db.bomOperation.create({
    data: {
      bomId,
      seq: 1,
      name: packOperationName(lineKind),
      description: packOperationDescription(lineKind),
      facilityId: refs.facilityId,
      lineId: refs.lineId,
      durationMinutes: packOperationDurationMinutes(lineKind),
      requiresQa: false,
    },
  });
  return op.id;
}

export async function generatePackBomsForProduct(
  productId: string,
  opts: GeneratePackBomOpts = {}
): Promise<GeneratePackBomResult | null> {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: {
      category: { select: { slug: true } },
      variants: { where: { active: true }, orderBy: { sku: "asc" } },
    },
  });
  if (!product) return null;
  if (product.variants.length === 0) {
    return {
      productSku: product.sku,
      created: [],
      updated: [],
      skipped: [],
    };
  }

  const categorySlug = product.category?.slug ?? null;
  const lineKind = resolvePackLineKind(categorySlug, product.name, product.sku);
  const lineRefs = lineKind ? await resolveLineRefs(lineKind) : null;
  const lineLabel = lineKind ?? null;

  const result: GeneratePackBomResult = {
    productSku: product.sku,
    created: [],
    updated: [],
    skipped: [],
  };

  for (const v of product.variants) {
    const existing = await db.bom.findFirst({
      where: { productId, variantId: v.id, active: true },
      select: { id: true, revision: true },
    });

    if (existing && !opts.force) {
      if (
        existing.revision === PACK_BOM_REVISION &&
        lineKind &&
        lineRefs
      ) {
        const packSize = effectivePackSize(v.packSize, v.sku, product.uom);
        const batch = computePackBatch(packSize, product.uom, product.sku);
        if (!opts.dryRun) {
          await db.bom.update({
            where: { id: existing.id },
            data: {
              defaultFacilityId: lineRefs.facilityId,
              defaultLineId: lineRefs.lineId,
              operationDependencies: false,
            },
          });
          await upsertPackOperation(existing.id, lineKind, lineRefs);
        }
        result.updated.push({
          variantSku: v.sku,
          bomId: existing.id,
          batch: batch.summary,
          line: lineLabel,
        });
        continue;
      }
      result.skipped.push({
        variantSku: v.sku,
        reason: `active BOM ${existing.id} (${existing.revision}) already exists`,
      });
      continue;
    }

    if (existing && opts.force && !opts.dryRun) {
      await db.bom.update({
        where: { id: existing.id },
        data: { active: false },
      });
    }

    const packSize = effectivePackSize(v.packSize, v.sku, product.uom);
    const batch = computePackBatch(packSize, product.uom, product.sku);

    const assignLine = !opts.routedCategoriesOnly || lineKind != null;

    if (opts.dryRun) {
      result.created.push({
        variantSku: v.sku,
        bomId: `dry-${v.sku}`,
        batch: batch.summary,
        line: lineLabel,
      });
      continue;
    }

    if (packSize !== v.packSize && packSize > 0) {
      await db.productVariant.update({
        where: { id: v.id },
        data: { packSize },
      });
    }

    const bom = await db.bom.create({
      data: {
        productId,
        variantId: v.id,
        revision: PACK_BOM_REVISION,
        outputQty: batch.outputQty,
        active: true,
        defaultFacilityId:
          assignLine && lineRefs ? lineRefs.facilityId : null,
        defaultLineId: assignLine && lineRefs ? lineRefs.lineId : null,
        operationDependencies: false,
        items: {
          create: [
            {
              productId,
              qty: batch.parentQty,
              uom: product.uom,
              scrapPct: 0,
            },
          ],
        },
      },
    });

    if (lineKind && lineRefs) {
      const opId = await upsertPackOperation(bom.id, lineKind, lineRefs);
      await db.bomItem.updateMany({
        where: { bomId: bom.id },
        data: { bomOperationId: opId },
      });
    }

    result.created.push({
      variantSku: v.sku,
      bomId: bom.id,
      batch: batch.summary,
      line: lineLabel,
    });
  }

  return result;
}

export async function generatePackBomsForCatalog(
  opts: GeneratePackBomOpts & {
    categorySlugs?: string[];
  } = {}
): Promise<GeneratePackBomResult[]> {
  const where =
    opts.categorySlugs && opts.categorySlugs.length > 0
      ? { category: { slug: { in: opts.categorySlugs } } }
      : {};

  const products = await db.product.findMany({
    where: {
      ...where,
      variants: { some: { active: true } },
    },
    select: { id: true },
    orderBy: { sku: "asc" },
  });

  const results: GeneratePackBomResult[] = [];
  for (const p of products) {
    const r = await generatePackBomsForProduct(p.id, opts);
    if (r) results.push(r);
  }
  return results;
}

/** Reset line cache between test runs. */
export function resetPackBomLineCache() {
  lineCache = null;
}
