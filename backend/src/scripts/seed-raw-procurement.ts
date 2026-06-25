#!/usr/bin/env tsx
/**
 * Seed raw-material procurement setup:
 *   • Vendor catalog line on a pseudo-random supplier per raw SKU
 *   • Global PO stock rules (min/max reorder)
 *   • Opening qty 1234 in Big Godown (WH-STOR) + putaway rule per SKU
 *
 *   npm run db:seed-raw-procurement:dev
 *   npm run db:seed-raw-procurement:dev -- --dry-run
 *   npm run db:seed-raw-procurement:dev -- --skip-stock   # catalog + rules only
 */

import { PrismaClient } from "@prisma/client";
import { applyBinReassign } from "../lib/bin-stock-update.js";
import { shouldSkipRawProcurement } from "../lib/raw-semi-exclusions.js";

const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");
const skipStock = process.argv.includes("--skip-stock");

const BIG_GODOWN_CODE = "WH-STOR";
const OPENING_QTY = 1234;

const DEFAULT_MIN_QTY = 250;
const DEFAULT_MAX_QTY = 500;

const VENDOR_SEED = [
  { code: "VEND-OILS", name: "Kerala Oils & Fats Pvt Ltd", city: "Kochi", gst: "32AABCK1234F1Z5", contact: "+91 98470 11223", email: "orders@keralaoils.example", paymentTerms: "Net 30", leadTimeDays: 10, rating: 4.2 },
  { code: "VEND-CHEM", name: "ChemSupply India", city: "Mumbai", gst: "27AAACC5678G1Z2", contact: "+91 98200 44556", email: "sales@chemsupply.example", paymentTerms: "Advance 25%", leadTimeDays: 5, rating: 3.8 },
  { code: "VEND-HERB", name: "Herbal Inputs Co", city: "Coimbatore", gst: "33AAEHH9012H1Z8", contact: "+91 94430 77889", email: "procurement@herbalinputs.example", paymentTerms: "Net 15", leadTimeDays: 7, rating: 4.0 },
  { code: "VEND-PACK", name: "Universal Packaging Ltd", city: "Chennai", gst: "33AABCU3456J1Z1", contact: "+91 98400 12345", email: "ar@univpack.example", paymentTerms: "Net 45", leadTimeDays: 14, rating: 3.5 },
  { code: "VEND-MILL", name: "Rajasthan Millets Traders", city: "Jaipur", gst: "08AABCR7788K1Z3", contact: "+91 94140 55667", email: "orders@rajmillets.example", paymentTerms: "Net 21", leadTimeDays: 12, rating: 4.1 },
  { code: "VEND-SPICE", name: "Spice Route Suppliers", city: "Guntur", gst: "37AABCS3344M1Z6", contact: "+91 98480 99001", email: "sales@spiceroute.example", paymentTerms: "Net 15", leadTimeDays: 8, rating: 3.9 },
] as const;

function isTestSku(sku: string): boolean {
  return /^DBOM-/i.test(sku);
}

/** Stable vendor pick — same raw SKU always maps to the same supplier. */
function pickVendorIndex(key: string, count: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % count;
}

function catalogPackSize(uom: string, sku: string): number {
  const u = uom.toLowerCase();
  if (u === "kg" || u === "g") {
    return sku.includes("SOAP") || sku.includes("OIL") ? 25 : 50;
  }
  return 1;
}

function catalogVendorUom(uom: string, packSize: number): string {
  const u = uom.toLowerCase();
  if (u === "kg" && packSize >= 25) return "bag";
  if (u === "l") return "can";
  if (u === "pc") return "carton";
  return u || "unit";
}

async function ensureVendors() {
  const out: Array<{ id: string; code: string; name: string }> = [];
  for (const spec of VENDOR_SEED) {
    let row = await db.vendor.findUnique({ where: { code: spec.code } });
    if (!row && !dryRun) {
      row = await db.vendor.create({ data: { ...spec, active: true } });
      console.log(`  + vendor ${spec.code}`);
    } else if (!row && dryRun) {
      row = { id: `dry-${spec.code}`, code: spec.code, name: spec.name };
    }
    if (row) out.push(row);
  }
  return out;
}

async function systemUserId(): Promise<string> {
  const user =
    (await db.user.findFirst({ where: { username: "admin" }, select: { id: true } })) ??
    (await db.user.findFirst({ select: { id: true } }));
  if (!user) throw new Error("No user found for stock audit trail.");
  return user.id;
}

async function main() {
  console.log(
    dryRun
      ? "DRY RUN — raw procurement seed\n"
      : "Seeding raw procurement (catalog + stock rules + Big Godown stock)…\n"
  );

  const vendors = await ensureVendors();
  if (vendors.length === 0) {
    throw new Error("No vendors available — run seed-procurement-demo or add vendors first.");
  }

  const extraVendors = await db.vendor.findMany({
    where: { active: true, code: { notIn: VENDOR_SEED.map((v) => v.code) } },
    select: { id: true, code: true, name: true },
  });
  const allVendors = [...vendors, ...extraVendors];

  const rawProducts = await db.product.findMany({
    where: { type: "raw", state: { not: "discontinued" } },
    include: { category: { select: { slug: true } } },
    orderBy: { sku: "asc" },
  });

  let catalogCreated = 0;
  let catalogSkipped = 0;
  let rulesCreated = 0;
  let rulesSkipped = 0;
  let stockOk = 0;
  let stockSkipped = 0;
  let putawayOk = 0;

  const wh = await db.warehouse.findUnique({
    where: { code: BIG_GODOWN_CODE },
    select: { id: true, name: true },
  });
  if (!wh) {
    throw new Error(`Warehouse ${BIG_GODOWN_CODE} not found — run db:seed-godowns:dev first.`);
  }

  const emptyBins = skipStock
    ? []
    : await db.bin.findMany({
        where: { warehouseId: wh.id, qty: 0, productId: null },
        orderBy: [{ zone: "asc" }, { shelf: "asc" }, { bin: "asc" }],
      });

  const userId = dryRun ? "dry-run" : await systemUserId();
  let binIdx = 0;

  console.log(`Raw products: ${rawProducts.length} · vendors: ${allVendors.length}`);
  if (!skipStock) {
    console.log(`Big Godown empty bins: ${emptyBins.length}\n`);
  }

  for (const product of rawProducts) {
    if (isTestSku(product.sku)) continue;
    if (
      shouldSkipRawProcurement({
        sku: product.sku,
        name: product.name,
        type: product.type,
        categorySlug: product.category?.slug ?? null,
      })
    ) {
      continue;
    }

    const vendor = allVendors[pickVendorIndex(product.sku, allVendors.length)]!;
    const packSize = catalogPackSize(product.uom, product.sku);
    const vendorUom = catalogVendorUom(product.uom, packSize);
    const price = Math.max(100, Math.round((product.costPrice || 10) * packSize));
    const minQty = product.reorderLevel > 0 ? product.reorderLevel : DEFAULT_MIN_QTY;
    const maxQty = Math.max(minQty * 2, DEFAULT_MAX_QTY);

    const existingCatalog = await db.vendorProduct.findFirst({
      where: { vendorId: vendor.id, productId: product.id, variantId: null },
    });

    if (existingCatalog) {
      catalogSkipped += 1;
    } else if (dryRun) {
      console.log(`  [dry] catalog ${product.sku} → ${vendor.code}`);
      catalogCreated += 1;
    } else {
      await db.vendorProduct.create({
        data: {
          vendorId: vendor.id,
          productId: product.id,
          variantId: null,
          vendorProductCode: `${vendor.code.replace("VEND-", "")}-${product.sku}`.slice(0, 40),
          vendorProductName: product.name.replace(/^Raw\s+/i, ""),
          vendorUom,
          packSize,
          price,
          minOrderQty: 1,
          leadTimeDays: 7,
          priority: 100,
          active: true,
          notes: "raw-procurement-seed",
        },
      });
      catalogCreated += 1;
    }

    const existingRule = await db.stockRule.findFirst({
      where: {
        productId: product.id,
        variantId: null,
        triggerType: "po",
        monitorBinId: null,
      },
    });

    if (existingRule) {
      rulesSkipped += 1;
    } else if (dryRun) {
      rulesCreated += 1;
    } else {
      await db.stockRule.create({
        data: {
          productId: product.id,
          variantId: null,
          monitorBinId: null,
          minQty,
          maxQty,
          orderMultiple: 1,
          triggerType: "po",
          vendorId: vendor.id,
          active: true,
          notes: `raw-procurement-seed · reorder below ${minQty} ${product.uom}`,
          tags: "raw-procurement",
        },
      });
      rulesCreated += 1;
    }

    if (skipStock) continue;

    const existingBin = await db.bin.findFirst({
      where: { warehouseId: wh.id, productId: product.id, qty: { gt: 0 } },
    });
    if (existingBin && existingBin.qty === OPENING_QTY) {
      stockSkipped += 1;
      continue;
    }

    let bin = existingBin;
    if (!bin) {
      if (binIdx >= emptyBins.length) {
        console.warn(`  ⚠ No empty bin left for ${product.sku}`);
        stockSkipped += 1;
        continue;
      }
      bin = emptyBins[binIdx++]!;
    }

    const loc = `${bin.zone}/${bin.shelf}/${bin.bin}`;

    if (dryRun) {
      console.log(`  [dry] stock ${product.sku} → ${BIG_GODOWN_CODE} ${loc} ×${OPENING_QTY}`);
      stockOk += 1;
      putawayOk += 1;
      continue;
    }

    await applyBinReassign(bin, {
      productId: product.id,
      variantId: null,
      qty: OPENING_QTY,
      reasonCode: "physical_match",
      remarks: `Raw opening stock seed (${product.sku})`,
      userId,
    });
    stockOk += 1;

    const putaway = await db.putawayRule.findFirst({
      where: { productId: product.id, variantId: null, active: true },
    });
    if (!putaway) {
      await db.putawayRule.create({
        data: {
          productId: product.id,
          variantId: null,
          toWarehouseId: wh.id,
          toBinId: bin.id,
          priority: 50,
          active: true,
          notes: `Raw default → ${BIG_GODOWN_CODE} ${loc}`,
        },
      });
      putawayOk += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Done.` +
      `\n  vendor catalog: ${catalogCreated} created, ${catalogSkipped} already existed` +
      `\n  stock rules (PO): ${rulesCreated} created, ${rulesSkipped} already existed` +
      (skipStock
        ? ""
        : `\n  Big Godown stock ×${OPENING_QTY}: ${stockOk} set, ${stockSkipped} skipped` +
          `\n  putaway rules: ${putawayOk} created`)
  );

  if (!dryRun && !skipStock && stockOk > 0) {
    console.log("Tip: npm run db:sync-stock:dev to refresh product counters.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
