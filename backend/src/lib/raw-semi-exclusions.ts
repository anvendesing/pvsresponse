/**
 * Raw / semi shadow products are auto-created from finished (or raw) catalog rows.
 * Flour, oils, snacks, and soap lines do not use that pattern — see purge script.
 */

import { canonicalCategorySlug } from "./category-slug-map.js";

const isOilsSlug = (slug: string | null | undefined) =>
  canonicalCategorySlug(slug ?? "") === "oils-oil-seeds";
const isSnacksSlug = (slug: string | null | undefined) =>
  canonicalCategorySlug(slug ?? "") === "sweets-snacks";
const isGrainsSlug = (slug: string | null | undefined) =>
  canonicalCategorySlug(slug ?? "") === "grains-pulses-flours";
const isMilletsSlug = (slug: string | null | undefined) =>
  canonicalCategorySlug(slug ?? "") === "millets-millet-products";

const FLOUR_RE =
  /\b(flour|atta|ravva|rava|sooji|besan|sattu|kanji|idli|puttu)\b/i;

/** Finished soap SKU prefix (Bath Soap variants). */
export function isSoapFinishedSku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return s === "BSOP" || s.startsWith("BSOP-");
}

/** Dedicated soap-process ingredients (stay type=raw; no auto semi). */
export function isSoapProcessRawSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith("RAW-SOAP-");
}

/** Auto semi rows derived from soap-process raw SKUs. */
export function isSoapProcessSemiSku(sku: string): boolean {
  return sku.trim().toUpperCase().startsWith("SEMI-SOAP-");
}

/** Shadow raw/semi created from finished BSOP catalog. */
export function isSoapFinishedShadowSku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return s === "RBSOP" || s === "SBSOP";
}

/** Bulk crude / blend rows that are real catalog items, not R{finished} shadows. */
export function isIntentionalOilBulkSku(sku: string): boolean {
  const s = sku.trim().toUpperCase();
  return s === "RAW-COCO-OIL" || s === "SEMI-OBL-1L";
}

export function isFlourLikeProduct(
  name: string,
  sku: string,
  categorySlug: string | null | undefined
): boolean {
  if (!isGrainsSlug(categorySlug) && !isMilletsSlug(categorySlug)) return false;
  return FLOUR_RE.test(`${sku} ${name}`);
}

export function parseSourceSku(tags: string | null | undefined): string | null {
  if (!tags) return null;
  const m = tags.match(/(?:^|,)\s*source-sku:([^,\s]+)/i);
  return m?.[1]?.trim().toUpperCase() ?? null;
}

export function isAutoSemiRow(tags: string | null | undefined): boolean {
  return Boolean(tags?.includes("semi-from-raw"));
}

type ProductRef = {
  sku: string;
  name: string;
  type: string;
  tags?: string | null;
  categorySlug?: string | null;
};

/** Skip creating R{sku} raw shadow from this finished product. */
export function shouldSkipRawShadowFromFinished(p: ProductRef): boolean {
  if (p.type !== "finished") return false;
  const slug = p.categorySlug ?? null;
  if (isOilsSlug(slug) || isSnacksSlug(slug)) return true;
  if (isSoapFinishedSku(p.sku)) return true;
  if (isFlourLikeProduct(p.name, p.sku, slug)) return true;
  return false;
}

/** Skip creating semi shadow from this raw product. */
export function shouldSkipSemiShadowFromRaw(p: ProductRef): boolean {
  if (p.type !== "raw") return false;
  const slug = p.categorySlug ?? null;
  if (isOilsSlug(slug) || isSnacksSlug(slug)) return true;
  if (isSoapProcessRawSku(p.sku)) return true;
  if (isSoapFinishedShadowSku(p.sku)) return true;
  if (isFlourLikeProduct(p.name, p.sku, slug)) return true;
  return false;
}

/** Skip procurement seed / stock rules for this raw product. */
export function shouldSkipRawProcurement(p: ProductRef): boolean {
  return shouldSkipSemiShadowFromRaw(p);
}

/**
 * Remove auto-generated raw/semi rows that should not exist.
 * Keeps intentional bulk rows (RAW-COCO-OIL, RAW-SOAP-*, SEMI-OBL-1L).
 */
export function shouldPurgeRawSemiProduct(
  p: ProductRef,
  sourceBySku: Map<string, { categorySlug: string | null; sku: string; name: string; type: string }>
): boolean {
  if (p.type !== "raw" && p.type !== "semi") return false;

  const slug = p.categorySlug ?? null;
  const sku = p.sku.trim().toUpperCase();

  if (isIntentionalOilBulkSku(sku)) return false;
  if (isSoapProcessRawSku(sku)) return false;

  if (isSoapProcessSemiSku(sku)) return true;
  if (isSoapFinishedShadowSku(sku)) return true;

  if (slug === "snacks" || isSnacksSlug(slug)) return true;

  if (isFlourLikeProduct(p.name, p.sku, slug)) return true;

  const sourceSku = parseSourceSku(p.tags ?? null);
  if (sourceSku) {
    const source = sourceBySku.get(sourceSku);
    if (source) {
      if (isOilsSlug(source.categorySlug) || isSnacksSlug(source.categorySlug)) return true;
      if (source.type === "finished" && isSoapFinishedSku(source.sku)) return true;
      if (isFlourLikeProduct(source.name, source.sku, source.categorySlug)) return true;
      if (isSoapProcessRawSku(source.sku)) return true;
      if (source.sku === "RAW-COCO-OIL") return true;
    }
  }

  // Oils category shadow rows without tags (shouldn't happen after backfill).
  if (isOilsSlug(slug) && !isIntentionalOilBulkSku(sku) && !isSoapProcessRawSku(sku)) {
    if (p.type === "semi") return true;
    if (sourceSku || sku.startsWith("R")) return true;
  }

  return false;
}
