/**
 * Semi-finished bath soap (drying WIP) — one parent product, variants mirror BSOP.
 */
import { db } from "../db.js";

export const SOAP_PROC_PRODUCT_SKU = "SOAP-PROC";

/** Semi variant SKU from finished BSOP variant SKU. */
export function semiVariantSku(fgVariantSku: string): string {
  return fgVariantSku.replace(/^BSOP-/, `${SOAP_PROC_PRODUCT_SKU}-`);
}

/** Map BSOP variant id → matching SOAP-PROC variant id (pack MO issue). */
export async function resolveSemiVariantIdForFgVariant(
  fgVariantId: string
): Promise<string | null> {
  const fg = await db.productVariant.findUnique({
    where: { id: fgVariantId },
    select: { sku: true },
  });
  if (!fg) return null;
  const semi = await db.productVariant.findUnique({
    where: { sku: semiVariantSku(fg.sku) },
    select: { id: true },
  });
  return semi?.id ?? null;
}

/** When issuing SOAP-PROC on a pack MO, pick the semi variant matching the FG variant. */
export async function resolveComponentVariantIdForMoIssue(opts: {
  moFgVariantId: string | null;
  componentProductSku: string;
}): Promise<string | null> {
  if (!opts.moFgVariantId) return null;
  if (opts.componentProductSku !== SOAP_PROC_PRODUCT_SKU) return null;
  return resolveSemiVariantIdForFgVariant(opts.moFgVariantId);
}
