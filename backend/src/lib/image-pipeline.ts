// Image processing pipeline using Sharp.
//
// On upload, generates 4 size × 2 format variants stored in a per-entity folder:
//   /uploads/products/{productId}/original.jpg  (archival, max 3000px)
//   /uploads/products/{productId}/large.webp    1200w q80
//   /uploads/products/{productId}/large.jpg     1200w q80
//   /uploads/products/{productId}/medium.webp   600w  q80
//   /uploads/products/{productId}/medium.jpg    600w  q80
//   /uploads/products/{productId}/thumb.webp    300w  q75
//   /uploads/products/{productId}/thumb.jpg     300w  q75
//
// Same layout for categories and concerns.
//
// Backwards compatibility: the old flat file /uploads/products/{id}.jpg still
// serves from disk (via @fastify/static) for any products not yet backfilled.

import sharp from "sharp";
import * as fs from "node:fs";
import * as path from "node:path";

const SIZES = [
  { name: "thumb",  width: 300,  q: 75 },
  { name: "medium", width: 600,  q: 80 },
  { name: "large",  width: 1200, q: 80 },
] as const;

export interface ImageSet {
  thumb:    { webp: string; jpeg: string };
  medium:   { webp: string; jpeg: string };
  large:    { webp: string; jpeg: string };
  original: string;
}

/**
 * Process an uploaded image buffer into responsive size variants.
 *
 * @param buf       Raw image bytes
 * @param entityId  Product / category / concern ID (used as folder name)
 * @param subDir    Relative subdirectory, e.g. "products", "categories"
 * @param baseDir   Absolute path to the uploads root
 * @returns         { baseUrl, imageSet } — URLs suitable for `Product.imageUrl` (baseUrl)
 */
export async function processImage(
  buf: Buffer,
  entityId: string,
  subDir: string,
  baseDir: string
): Promise<{ baseUrl: string; imageSet: ImageSet }> {
  const dir = path.join(baseDir, subDir, entityId);
  await fs.promises.mkdir(dir, { recursive: true });

  // Archival copy (rotated, max 3000px to drop very large originals, otherwise untouched)
  const archivalBuf = await sharp(buf)
    .rotate()
    .resize({ width: 3000, withoutEnlargement: true })
    .jpeg({ quality: 90, progressive: true })
    .toBuffer();
  await fs.promises.writeFile(path.join(dir, "original.jpg"), archivalBuf);

  // Responsive variants
  for (const s of SIZES) {
    const base = sharp(buf).rotate().resize({ width: s.width, withoutEnlargement: true });
    await base
      .clone()
      .webp({ quality: s.q })
      .toFile(path.join(dir, `${s.name}.webp`));
    await base
      .clone()
      .jpeg({ quality: s.q, progressive: true, mozjpeg: true })
      .toFile(path.join(dir, `${s.name}.jpg`));
  }

  const baseUrl = `/uploads/${subDir}/${entityId}`;
  // baseUrl is always a directory path (no extension), so buildImageSet always returns non-null here.
  return {
    baseUrl,
    imageSet: buildImageSet(baseUrl) as ImageSet,
  };
}

/**
 * Build an ImageSet from a baseUrl.
 * Returns null when the URL is a legacy flat file (not a directory path).
 */
export function buildImageSet(imageUrl: string | null | undefined): ImageSet | null {
  if (!imageUrl) return null;
  // Directory-based: ends with entityId (no extension)
  // Flat-file: ends with something like .jpg, .png, .webp
  if (/\.\w{2,5}(\?.*)?$/.test(imageUrl)) {
    // Legacy flat file — no image set available
    return null;
  }
  // Strip query string from base URL for building image set URLs
  const base = imageUrl.split("?")[0];
  return {
    thumb:    { webp: `${base}/thumb.webp`,  jpeg: `${base}/thumb.jpg` },
    medium:   { webp: `${base}/medium.webp`, jpeg: `${base}/medium.jpg` },
    large:    { webp: `${base}/large.webp`,  jpeg: `${base}/large.jpg` },
    original: `${base}/original.jpg`,
  };
}
