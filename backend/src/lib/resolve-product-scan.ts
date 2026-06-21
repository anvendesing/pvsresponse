import { db } from "../db.js";
import { codesEqual } from "./text-search.js";

export type ResolvedProductScan = {
  productId: string;
  variantId: string | null;
  sku: string;
  name: string;
};

/** Resolve a scanned barcode or typed SKU to a product (and optional variant). */
export async function resolveProductScan(
  raw: string
): Promise<ResolvedProductScan | null> {
  const code = raw.trim();
  if (!code) return null;

  const products = await db.product.findMany({
    where: {
      OR: [
        { barcode: { not: "" } },
        { sku: code },
        { variants: { some: { OR: [{ barcode: { not: null } }, { sku: code }] } } },
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      variants: {
        select: { id: true, sku: true, barcode: true },
      },
    },
  });

  for (const p of products) {
    if (codesEqual(p.sku, code)) {
      return { productId: p.id, variantId: null, sku: p.sku, name: p.name };
    }
    if (p.barcode && codesEqual(p.barcode, code)) {
      return { productId: p.id, variantId: null, sku: p.sku, name: p.name };
    }
    for (const v of p.variants) {
      if (codesEqual(v.sku, code)) {
        return { productId: p.id, variantId: v.id, sku: v.sku, name: p.name };
      }
      if (v.barcode && codesEqual(v.barcode, code)) {
        return { productId: p.id, variantId: v.id, sku: v.sku, name: p.name };
      }
    }
  }

  return null;
}
