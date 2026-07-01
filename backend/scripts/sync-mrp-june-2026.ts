/**
 * Sync catalog from MRP PRICE LIST JUNE 2026.xlsx:
 *  - Variant barcodes are never changed — matching uses OS code (col 1) and existing barcodes.
 *  - Set variant HSN + GST from the sheet.
 *  - Update RETAIL MRP prices.
 *  - "Remove" rows → delete variant (+ product when last variant) from all tables.
 *  - "Out of stock" → disable ecommerce + price lists on variant (and parent when all OOS).
 *  - "In stock" → enable channels and refresh prices.
 *  - Rows in the sheet but missing in DB → add product/variant as needed.
 *
 * Usage:
 *   npx tsx scripts/sync-mrp-june-2026.ts --dry-run
 *   npx tsx scripts/sync-mrp-june-2026.ts --apply
 *   npx tsx scripts/sync-mrp-june-2026.ts --apply --mrp "../MRP PRICE LIST JUNE 2026.xlsx"
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DEFAULT_MRP = "../MRP PRICE LIST JUNE 2026.xlsx";

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const mrpIdx = args.indexOf("--mrp");
const mrpPath = mrpIdx >= 0 ? args[mrpIdx + 1]! : DEFAULT_MRP;

// ── Types / parser ──────────────────────────────────────────────────────────

export type StockStatus = "in_stock" | "out_of_stock" | "remove" | "unknown";

export interface SheetRow {
  sheetBarcode: string | null;
  osCode: string;
  canonicalBarcode: string;
  name: string;
  hsn: string;
  size: string;
  mrp: number;
  gst: number;
  stock: StockStatus;
  category: string;
}

const CATEGORY_PATTERNS: { re: RegExp; cat: string }[] = [
  { re: /^Edible Oils/i, cat: "Edible Oils" },
  { re: /^Rice.*Cereals.*Pulses/i, cat: "Rice Cereals & Pulses" },
  { re: /^Cosmotic.*Herbal/i, cat: "Cosmetics & Herbal" },
  { re: /^Dry Fruits/i, cat: "Dry Fruits & Health" },
  { re: /^Millets/i, cat: "Millets" },
  { re: /^Spices.*Masala.*Pickles/i, cat: "Spices & Pickles" },
  { re: /^Sweets.*Savories/i, cat: "Sweets & Savories" },
  { re: /^Books/i, cat: "Books" },
  { re: /^Water Filter/i, cat: "Water Filter" },
  { re: /Miscellenous|Miscellaneous/i, cat: "Miscellaneous" },
];

const norm = (s: unknown): string => String(s ?? "").trim().replace(/\s+/g, " ");

const numF = (s: unknown): number => {
  if (typeof s === "number") return s;
  const n = parseFloat(String(s ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function parseStock(s: string): StockStatus {
  const t = s.trim().toLowerCase();
  if (t.includes("remove")) return "remove";
  if (t.includes("out")) return "out_of_stock";
  if (t.includes("in")) return "in_stock";
  return "unknown";
}

const isHeaderRow = (row: unknown[]) => {
  const a = String(row[0] ?? "").trim();
  const b = String(row[1] ?? "").trim();
  return a === "Code No" || b === "Code No";
};

const isCategoryRow = (row: unknown[]) => {
  const a = String(row[0] ?? "").trim();
  const b = String(row[1] ?? "").trim();
  const banner = a || b;
  if (!banner) return false;
  const filled = row.filter((c) => String(c ?? "").trim() !== "").length;
  if (filled > 1) return false;
  return CATEGORY_PATTERNS.some((p) => p.re.test(banner));
};

const detectCategory = (banner: string): string => {
  for (const p of CATEGORY_PATTERNS) if (p.re.test(banner)) return p.cat;
  return "Miscellaneous";
};

const SHEET_CATEGORY_SLUG: Record<string, string> = {
  "Edible Oils": "oils-oil-seeds",
  "Rice Cereals & Pulses": "grains-pulses-flours",
  "Cosmetics & Herbal": "personal-care-wellness",
  "Dry Fruits & Health": "dry-fruitsseeds-superfoods",
  Millets: "millets-millet-products",
  "Spices & Pickles": "spices-condiments",
  "Sweets & Savories": "sweets-snacks",
  Books: "home-utilities",
  "Water Filter": "home-utilities",
  Miscellaneous: "home-utilities",
};

export function parseJuneMrpRows(path: string): SheetRow[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const out: SheetRow[] = [];
  let currentCategory = "Edible Oils";

  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Sheet1") continue;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
    }) as unknown[][];

    for (const row of rows) {
      if (isHeaderRow(row)) continue;
      if (isCategoryRow(row)) {
        const banner = String(row[0] ?? "").trim() || String(row[1] ?? "").trim();
        currentCategory = detectCategory(banner);
        continue;
      }

      const col0 = String(row[0] ?? "").trim();
      let osCode = String(row[1] ?? "").trim().replace(/^0(S\d+)/i, "O$1").toUpperCase();
      const name = norm(row[2]);
      if (!osCode || !name) continue;
      if (CATEGORY_PATTERNS.some((p) => p.re.test(osCode))) continue;
      if (!/^[A-Z0-9]+\d/.test(osCode)) continue;

      // Col 0 holds the scannable barcode (OSC/MLT/SMP/RCP/…); col 1 is the legacy OS code.
      const sheetBarcode =
        col0 && col0 !== "Code No" && /^[A-Z][A-Z0-9]*\d/i.test(col0) ? col0.toUpperCase() : null;
      const hsn = norm(row[3]);
      const size = norm(row[4]);
      const mrp = numF(row[6]);
      const gst = numF(row[7]);
      const stock = parseStock(String(row[9] ?? ""));

      out.push({
        sheetBarcode,
        osCode,
        canonicalBarcode: sheetBarcode ?? osCode,
        name,
        hsn: hsn || "0000",
        size,
        mrp,
        gst: gst > 0 ? gst : 18,
        stock,
        category: currentCategory,
      });
    }
  }
  return out;
}

// ── Purge helpers ───────────────────────────────────────────────────────────

async function countProductBlockers(productId: string) {
  const [poItems, bomItems, bomByproducts, enquiryItems, boms] = await Promise.all([
    db.purchaseOrderItem.count({ where: { productId } }),
    db.bomItem.count({ where: { productId } }),
    db.bomByproduct.count({ where: { productId } }),
    db.enquiryItem.count({ where: { productId } }),
    db.bom.count({ where: { productId } }),
  ]);
  const blockers: string[] = [];
  if (poItems) blockers.push(`${poItems} PO line(s)`);
  if (bomItems) blockers.push(`${bomItems} BOM component row(s)`);
  if (bomByproducts) blockers.push(`${bomByproducts} BOM byproduct row(s)`);
  if (enquiryItems) blockers.push(`${enquiryItems} enquiry line(s)`);
  if (boms) blockers.push(`${boms} BOM(s)`);
  return blockers;
}

async function countVariantBlockers(variantId: string, productId: string) {
  const [
    invoiceItems,
    salesOrderItems,
    quoteItems,
    poItems,
    pickListItems,
    packingSlipItems,
    transferItems,
    returnItems,
    creditNoteItems,
    stockedBins,
    ledger,
    stockLots,
    bomItems,
    bomByproducts,
  ] = await Promise.all([
    db.invoiceItem.count({ where: { variantId } }),
    db.salesOrderItem.count({ where: { variantId } }),
    db.quoteItem.count({ where: { variantId } }),
    db.purchaseOrderItem.count({ where: { productId } }),
    db.pickListItem.count({ where: { variantId } }),
    db.packingSlipItem.count({ where: { variantId } }),
    db.transferOrderItem.count({ where: { variantId } }),
    db.customerReturnItem.count({ where: { variantId } }),
    db.creditNoteItem.count({ where: { variantId } }),
    db.bin.count({ where: { variantId, qty: { gt: 0 } } }),
    db.stockLedger.count({ where: { variantId } }),
    db.stockLot.count({ where: { variantId } }),
    db.bomItem.count({ where: { productId } }),
    db.bomByproduct.count({ where: { productId } }),
  ]);

  const blockers: string[] = [];
  if (invoiceItems) blockers.push(`${invoiceItems} invoice line(s)`);
  if (salesOrderItems) blockers.push(`${salesOrderItems} SO line(s)`);
  if (quoteItems) blockers.push(`${quoteItems} quote line(s)`);
  if (poItems) blockers.push(`${poItems} PO line(s)`);
  if (pickListItems) blockers.push(`${pickListItems} pick line(s)`);
  if (packingSlipItems) blockers.push(`${packingSlipItems} packing line(s)`);
  if (transferItems) blockers.push(`${transferItems} transfer line(s)`);
  if (returnItems) blockers.push(`${returnItems} return line(s)`);
  if (creditNoteItems) blockers.push(`${creditNoteItems} credit note line(s)`);
  if (stockedBins) blockers.push(`${stockedBins} stocked bin(s)`);
  if (ledger) blockers.push(`${ledger} ledger row(s)`);
  if (stockLots) blockers.push(`${stockLots} stock lot(s)`);
  if (bomItems) blockers.push(`${bomItems} BOM component row(s)`);
  if (bomByproducts) blockers.push(`${bomByproducts} BOM byproduct row(s)`);
  return blockers;
}

async function deleteBom(bomId: string) {
  const moCount = await db.productionOrder.count({ where: { bomId } });
  if (moCount > 0) throw new Error(`BOM ${bomId} has ${moCount} production order(s)`);
  await db.stockRule.deleteMany({ where: { bomId } });
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });
  await db.bomItem.deleteMany({ where: { bomId } });
  await db.bomByproduct.deleteMany({ where: { bomId } });
  await db.bom.delete({ where: { id: bomId } });
}

async function stripVariantRefs(variantId: string, productId: string) {
  await db.priceListItem.deleteMany({ where: { variantId } });
  await db.putawayRule.deleteMany({ where: { OR: [{ variantId }, { productId }] } });
  await db.stockRule.deleteMany({ where: { OR: [{ variantId }, { productId }] } });
  await db.vendorProduct.deleteMany({ where: { OR: [{ variantId }, { productId }] } });
  await db.bin.updateMany({
    where: { OR: [{ variantId }, { productId }] },
    data: { variantId: null, productId: null, qty: 0, reservedQty: 0, occupied: 0 },
  });
  await db.stockLedger.deleteMany({ where: { variantId } });
  await db.stockLot.deleteMany({ where: { variantId } });
}

async function purgeProduct(productId: string, sku: string) {
  const boms = await db.bom.findMany({ where: { productId }, select: { id: true } });
  for (const bom of boms) await deleteBom(bom.id);
  await db.productConcernLink.deleteMany({ where: { productId } });
  await db.enquiryItem.deleteMany({ where: { productId } });
  await db.productVariant.deleteMany({ where: { productId } });
  await db.product.delete({ where: { id: productId } });
  console.log(`  ✓ deleted product ${sku}`);
}

async function purgeVariant(
  variantId: string,
  label: string
): Promise<"deleted" | "blocked" | "dry"> {
  const variant = await db.productVariant.findUnique({
    where: { id: variantId },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          type: true,
          _count: { select: { variants: true } },
        },
      },
    },
  });
  if (!variant) return "dry";

  const blockers = await countVariantBlockers(variantId, variant.productId);
  if (dryRun) {
    console.log(
      `  [dry] remove ${label}${blockers.length ? ` (blockers: ${blockers.join(", ")})` : ""}`
    );
    return "dry";
  }

  await stripVariantRefs(variantId, variant.productId);

  if (blockers.length > 0) {
    await db.productVariant.update({
      where: { id: variantId },
      data: {
        active: false,
        ecommerceEnabled: false,
        priceListEnabled: false,
        barcode: null,
      },
    });
    await db.product.update({
      where: { id: variant.productId },
      data: { state: "discontinued", ecommerceEnabled: false, priceListEnabled: false },
    });
    console.log(`  ⚠ soft-removed ${label} (${blockers.join(", ")})`);
    return "blocked";
  }

  await db.productVariant.delete({ where: { id: variantId } });
  console.log(`  ✓ removed variant ${label}`);

  const remaining = await db.productVariant.count({ where: { productId: variant.productId } });
  if (remaining === 0) {
    const prodBlockers = await countProductBlockers(variant.productId);
    if (prodBlockers.length === 0) {
      await purgeProduct(variant.productId, variant.product.sku);
    } else {
      await db.product.update({
        where: { id: variant.productId },
        data: { state: "discontinued", ecommerceEnabled: false, priceListEnabled: false },
      });
    }
  }
  return "deleted";
}

// ── Create helpers ──────────────────────────────────────────────────────────

function baseProductName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function parseSizeLabel(raw: string): string {
  const t = norm(raw);
  if (!t) return "—";
  const m = t.match(/([\d.]+)\s*(ltr|lit|l|ml|kg|kgs|gms?|g|inch|sq\s*mt|pcs?|no|sticks?)/i);
  if (!m) return t;
  const mag = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith("l")) return `${mag} L`;
  if (unit === "ml") return `${mag} ml`;
  if (unit.startsWith("kg")) return `${mag} kg`;
  if (unit.startsWith("g")) return `${mag} g`;
  return t;
}

function autoSku(prefix: string, taken: Set<string>): string {
  let i = 1;
  while (taken.has(`${prefix}-${String(i).padStart(2, "0")}`)) i++;
  const sku = `${prefix}-${String(i).padStart(2, "0")}`;
  taken.add(sku);
  return sku;
}

async function findProductForRow(row: SheetRow) {
  const base = baseProductName(row.name);
  const exact = await db.product.findFirst({
    where: { name: { equals: base, mode: "insensitive" }, type: "finished" },
    include: { variants: true },
  });
  if (exact) return exact;

  return db.product.findFirst({
    where: {
      type: "finished",
      OR: [
        { name: { contains: base.slice(0, Math.min(20, base.length)), mode: "insensitive" } },
        { name: { equals: row.name, mode: "insensitive" } },
      ],
    },
    include: { variants: true },
  });
}


async function createVariantForRow(
  row: SheetRow,
  retailId: string,
  takenSkus: Set<string>,
  takenBarcodes: Set<string>,
  categoryBySlug: Map<string, string>
) {
  let product = await findProductForRow(row);
  const sizeLabel = parseSizeLabel(row.size);
  const enabled = row.stock === "in_stock";

  if (!product) {
    const words = baseProductName(row.name)
      .replace(/[^A-Za-z\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter((w) => !["and", "or", "the", "of", "for"].includes(w.toLowerCase()));
    let skuBase = words
      .slice(0, 4)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 4);
    if (skuBase.length < 3) skuBase = "PRD";
    let sku = skuBase;
    let n = 0;
    while (takenSkus.has(sku)) {
      n++;
      sku = skuBase.slice(0, 3) + n;
    }
    takenSkus.add(sku);

    const barcode = row.osCode;
    if (takenBarcodes.has(barcode.toUpperCase())) {
      console.log(`  ⚠ skip create ${row.osCode}: barcode ${barcode} taken`);
      return;
    }
    takenBarcodes.add(barcode.toUpperCase());

    if (dryRun) {
      console.log(`  [dry] create product ${sku} + variant ${row.osCode} (${row.name})`);
      return;
    }

    const catSlug = SHEET_CATEGORY_SLUG[row.category] ?? "grains-pulses-flours";
    const categoryId = categoryBySlug.get(catSlug) ?? null;

    product = await db.product.create({
      data: {
        sku,
        name: baseProductName(row.name),
        type: "finished",
        uom: "Nos",
        barcode: `BC-${sku}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        state: "active",
        categoryId,
        hsn: row.hsn,
        gstRate: row.gst,
        costPrice: Math.round(row.mrp * 0.6),
        sellingPrice: row.mrp,
        reorderLevel: 5,
        stockOnHand: 0,
        ecommerceEnabled: enabled,
        priceListEnabled: enabled,
      },
      include: { variants: true },
    });
    console.log(`  ✓ created product ${sku} (${row.name})`);
  }

  const variantSku = autoSku(product!.sku, takenSkus);
  const barcode = row.osCode;
  if (takenBarcodes.has(barcode.toUpperCase())) {
    console.log(`  ⚠ skip create variant ${row.osCode}: barcode ${barcode} taken`);
    return;
  }

  if (dryRun) {
    console.log(`  [dry] create variant ${variantSku} barcode=${barcode} on ${product!.sku}`);
    return;
  }

  takenBarcodes.add(barcode.toUpperCase());
  const variant = await db.productVariant.create({
    data: {
      productId: product!.id,
      sku: variantSku,
      barcode,
      hsn: row.hsn,
      gstRate: row.gst,
      size: sizeLabel,
      uom: "pc",
      packSize: 1,
      stockOnHand: 0,
      active: true,
      ecommerceEnabled: enabled,
      priceListEnabled: enabled,
      sellingPriceOverride: row.mrp,
    },
  });

  if (row.mrp > 0) {
    await db.priceListItem.create({
      data: {
        priceListId: retailId,
        productId: product!.id,
        variantId: variant.id,
        price: row.mrp,
        minQty: 1,
      },
    });
  }

  await db.product.update({
    where: { id: product!.id },
    data: { hsn: row.hsn, gstRate: row.gst },
  });

  console.log(`  ✓ created variant ${variantSku} (${barcode}) on ${product!.sku}`);
}

// ── Lookup helpers ──────────────────────────────────────────────────────────

type VariantRow = Awaited<ReturnType<typeof db.productVariant.findMany>>[number] & {
  product: { id: string; sku: string; type: string; hsn: string; gstRate: number };
};

function buildVariantLookups(variants: VariantRow[], rows: SheetRow[]) {
  const byAnyCode = new Map<string, VariantRow>();
  for (const v of variants) {
    if (v.barcode) byAnyCode.set(v.barcode.toUpperCase(), v);
  }
  const byOsCode = new Map<string, VariantRow>();
  for (const row of rows) {
    const v =
      byAnyCode.get(row.osCode) ??
      (row.sheetBarcode ? byAnyCode.get(row.sheetBarcode.toUpperCase()) : undefined);
    if (v) byOsCode.set(row.osCode, v);
  }
  return { byOsCode, byAnyCode };
}

function sheetCodeSet(rows: SheetRow[]): Set<string> {
  const codes = new Set<string>();
  for (const r of rows) {
    codes.add(r.osCode);
    if (r.sheetBarcode) codes.add(r.sheetBarcode.toUpperCase());
  }
  return codes;
}

function variantInSheet(v: VariantRow, codes: Set<string>): boolean {
  if (!v.barcode) return false;
  return codes.has(v.barcode.toUpperCase());
}

// ── Main sync ───────────────────────────────────────────────────────────────

async function upsertRetailPrice(
  retailId: string,
  productId: string,
  variantId: string,
  mrp: number
) {
  if (mrp <= 0) return;
  const existing = await db.priceListItem.findFirst({
    where: { priceListId: retailId, productId, variantId, minQty: 1 },
  });
  if (existing) {
    if (existing.price !== mrp) {
      await db.priceListItem.update({ where: { id: existing.id }, data: { price: mrp } });
    }
  } else {
    await db.priceListItem.create({
      data: { priceListId: retailId, productId, variantId, price: mrp, minQty: 1 },
    });
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — no DB writes\n" : "LIVE — syncing catalog\n");
  console.log(`MRP file: ${mrpPath}`);

  const rows = parseJuneMrpRows(mrpPath);
  console.log(`Parsed ${rows.length} catalog rows`);

  const retail = await db.priceList.findUnique({ where: { code: "RETAIL" } });
  if (!retail) throw new Error("RETAIL price list not found — run db:seed first");

  const variants = await db.productVariant.findMany({
    include: { product: { select: { id: true, sku: true, type: true, hsn: true, gstRate: true } } },
  });

  let { byOsCode, byAnyCode } = buildVariantLookups(variants, rows);

  const takenSkus = new Set(variants.map((v) => v.sku));
  const takenBarcodes = new Set(
    variants.map((v) => v.barcode?.toUpperCase()).filter(Boolean) as string[]
  );
  const allSheetCodes = sheetCodeSet(rows);
  const categories = await db.productCategory.findMany({ select: { id: true, slug: true } });
  const categoryBySlug = new Map(categories.map((c) => [c.slug, c.id]));

  const stats = {
    updated: 0,
    barcodeRestored: 0,
    removed: 0,
    softRemoved: 0,
    outOfStock: 0,
    inStock: 0,
    created: 0,
    notInSheetRemoved: 0,
    skippedRemoveMissing: 0,
  };

  // Undo prior col-0 barcode migrations — keep OS code (col 1) as the canonical barcode.
  for (const row of rows) {
    if (row.stock === "remove" || !row.sheetBarcode) continue;
    const variant = byAnyCode.get(row.sheetBarcode.toUpperCase());
    if (!variant || variant.barcode?.toUpperCase() === row.osCode) continue;
    const owner = byAnyCode.get(row.osCode);
    if (owner && owner.id !== variant.id) {
      console.log(`  ⚠ cannot restore ${row.osCode}: already owned by ${owner.sku}`);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry] restore barcode ${variant.barcode} → ${row.osCode} (${variant.sku})`);
    } else {
      await db.productVariant.update({
        where: { id: variant.id },
        data: { barcode: row.osCode },
      });
      console.log(`  ✓ restored barcode ${variant.barcode} → ${row.osCode} (${variant.sku})`);
    }
    if (variant.barcode) {
      byAnyCode.delete(variant.barcode.toUpperCase());
      takenBarcodes.delete(variant.barcode.toUpperCase());
    }
    variant.barcode = row.osCode;
    byAnyCode.set(row.osCode, variant);
    byOsCode.set(row.osCode, variant);
    takenBarcodes.add(row.osCode);
    stats.barcodeRestored++;
  }

  for (const row of rows) {
    const variant = byOsCode.get(row.osCode);

    if (row.stock === "remove") {
      if (!variant) {
        stats.skippedRemoveMissing++;
        continue;
      }
      const result = await purgeVariant(variant.id, `${row.osCode} ${row.name}`);
      if (result === "deleted" || result === "dry") stats.removed++;
      else if (result === "blocked") stats.softRemoved++;
      byOsCode.delete(row.osCode);
      if (variant.barcode) byAnyCode.delete(variant.barcode.toUpperCase());
      continue;
    }

    if (!variant) {
      await createVariantForRow(row, retail.id, takenSkus, takenBarcodes, categoryBySlug);
      stats.created++;
      continue;
    }

    const channelEnabled = row.stock === "in_stock";
    const updates: Record<string, unknown> = {
      hsn: row.hsn,
      gstRate: row.gst,
      sellingPriceOverride: row.mrp > 0 ? row.mrp : variant.sellingPriceOverride,
      active: true,
      ecommerceEnabled: channelEnabled,
      priceListEnabled: channelEnabled,
    };

    if (row.stock === "out_of_stock") stats.outOfStock++;
    else if (row.stock === "in_stock") stats.inStock++;

    if (dryRun) {
      const flags = channelEnabled ? "enabled" : "OOS/disabled";
      console.log(`  [dry] update ${variant.sku} gst=${row.gst}% ${flags}`);
      stats.updated++;
      continue;
    }

    await db.productVariant.update({ where: { id: variant.id }, data: updates });
    await db.product.update({
      where: { id: variant.productId },
      data: { hsn: row.hsn, gstRate: row.gst },
    });
    await upsertRetailPrice(retail.id, variant.productId, variant.id, row.mrp);
    stats.updated++;
  }

  // Remove finished-good variants not mentioned anywhere in the sheet.
  const finishedVariants = variants.filter(
    (v) => v.product.type === "finished" && !variantInSheet(v, allSheetCodes)
  );

  for (const v of finishedVariants) {
    const result = await purgeVariant(v.id, `${v.barcode} ${v.sku} (not in sheet)`);
    if (result === "deleted" || result === "dry") stats.notInSheetRemoved++;
    else if (result === "blocked") stats.softRemoved++;
  }

  // Refresh parent channel flags from variant states.
  if (!dryRun) {
    const products = await db.product.findMany({
      where: { type: "finished" },
      include: { variants: { select: { ecommerceEnabled: true, priceListEnabled: true, active: true } } },
    });
    for (const p of products) {
      if (p.variants.length === 0) continue;
      const anyEcom = p.variants.some((v) => v.ecommerceEnabled && v.active);
      const anyPrice = p.variants.some((v) => v.priceListEnabled && v.active);
      await db.product.update({
        where: { id: p.id },
        data: { ecommerceEnabled: anyEcom, priceListEnabled: anyPrice },
      });
    }
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1]?.replace(/\\/g, "/").includes("sync-mrp-june-2026")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
