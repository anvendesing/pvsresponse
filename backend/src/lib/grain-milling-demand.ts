/**
 * Derive parent-product reorder levels (kg) from variant-level stock rules.
 *
 * Example: ROP 50 × 1 kg + ROP 40 × 0.5 kg = 70 kg bulk reorder point.
 */
import { db } from "../db.js";

export type VariantDemandKg = {
  minKg: number;
  maxKg: number;
  variantCount: number;
  lines: Array<{ variantSku: string; ropUnits: number; maxUnits: number; packSizeKg: number; minKg: number }>;
};

export async function aggregateVariantDemandKg(productId: string): Promise<VariantDemandKg> {
  const rules = await db.stockRule.findMany({
    where: {
      productId,
      active: true,
      variantId: { not: null },
    },
    include: {
      variant: { select: { sku: true, packSize: true } },
    },
  });

  const lines: VariantDemandKg["lines"] = [];
  let minKg = 0;
  let maxKg = 0;

  for (const rule of rules) {
    if (!rule.variant) continue;
    const packSizeKg = rule.variant.packSize > 0 ? rule.variant.packSize : 1;
    const lineMin = rule.minQty * packSizeKg;
    const lineMax = (rule.maxQty ?? rule.minQty * 2) * packSizeKg;
    minKg += lineMin;
    maxKg += lineMax;
    lines.push({
      variantSku: rule.variant.sku,
      ropUnits: rule.minQty,
      maxUnits: rule.maxQty ?? rule.minQty * 2,
      packSizeKg,
      minKg: lineMin,
    });
  }

  return { minKg, maxKg, variantCount: lines.length, lines };
}

/** Fill demand for variants that have no stock rule yet (use reorderLevel or default ROP units). */
export function mergeMissingVariantDemand(
  demand: VariantDemandKg,
  variants: Array<{ sku: string; packSize: number }>,
  defaultRopUnits: number
): VariantDemandKg {
  const seen = new Set(demand.lines.map((l) => l.variantSku));
  const lines = [...demand.lines];
  let minKg = demand.minKg;
  let maxKg = demand.maxKg;
  for (const v of variants) {
    if (seen.has(v.sku)) continue;
    const packSizeKg = v.packSize > 0 ? v.packSize : 1;
    const rop = defaultRopUnits;
    const lineMin = rop * packSizeKg;
    const lineMax = rop * 2 * packSizeKg;
    minKg += lineMin;
    maxKg += lineMax;
    lines.push({
      variantSku: v.sku,
      ropUnits: rop,
      maxUnits: rop * 2,
      packSizeKg,
      minKg: lineMin,
    });
  }
  return { minKg, maxKg, variantCount: lines.length, lines };
}

/** Fallback when no variant rules exist yet. */
export function demandFromVariantPackSizes(
  variants: Array<{ sku: string; packSize: number }>,
  defaultRopUnits = 40
): VariantDemandKg {
  const lines = variants.map((v) => {
    const packSizeKg = v.packSize > 0 ? v.packSize : 1;
    const minKg = defaultRopUnits * packSizeKg;
    return {
      variantSku: v.sku,
      ropUnits: defaultRopUnits,
      maxUnits: defaultRopUnits * 2,
      packSizeKg,
      minKg,
    };
  });
  const minKg = lines.reduce((s, l) => s + l.minKg, 0);
  const maxKg = lines.reduce((s, l) => s + l.minKg * 2, 0);
  return { minKg, maxKg, variantCount: lines.length, lines };
}
