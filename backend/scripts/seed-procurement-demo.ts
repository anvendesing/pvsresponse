/**
 * Seed procurement demo data: vendors, supplier catalogs, sample POs.
 *
 *   npx tsx scripts/seed-procurement-demo.ts
 *   npx tsx scripts/seed-procurement-demo.ts --dry-run
 */

import { db } from "../src/db.js";
import { SOAP_RAW_SKUS } from "./config/soap-bom-recipes.js";
import { resolvePoLine } from "../src/lib/po-lines.js";

const dryRun = process.argv.includes("--dry-run");

type VendorSpec = {
  code: string;
  name: string;
  city: string;
  gst: string;
  contact: string;
  email: string;
  paymentTerms: string;
  leadTimeDays: number;
  rating: number;
};

const VENDORS: VendorSpec[] = [
  {
    code: "VEND-OILS",
    name: "Kerala Oils & Fats Pvt Ltd",
    city: "Kochi",
    gst: "32AABCK1234F1Z5",
    contact: "+91 98470 11223",
    email: "orders@keralaoils.example",
    paymentTerms: "Net 30",
    leadTimeDays: 10,
    rating: 4.2,
  },
  {
    code: "VEND-CHEM",
    name: "ChemSupply India",
    city: "Mumbai",
    gst: "27AAACC5678G1Z2",
    contact: "+91 98200 44556",
    email: "sales@chemsupply.example",
    paymentTerms: "Advance 25%",
    leadTimeDays: 5,
    rating: 3.8,
  },
  {
    code: "VEND-HERB",
    name: "Herbal Inputs Co",
    city: "Coimbatore",
    gst: "33AAEHH9012H1Z8",
    contact: "+91 94430 77889",
    email: "procurement@herbalinputs.example",
    paymentTerms: "Net 15",
    leadTimeDays: 7,
    rating: 4.0,
  },
  {
    code: "VEND-PACK",
    name: "Universal Packaging Ltd",
    city: "Chennai",
    gst: "33AABCU3456J1Z1",
    contact: "+91 98400 12345",
    email: "ar@univpack.example",
    paymentTerms: "Net 45",
    leadTimeDays: 14,
    rating: 3.5,
  },
];

type CatalogLine = {
  sku: string;
  vendorCode: string;
  vendorName: string;
  vendorUom: string;
  packSize: number;
  price: number;
  minOrderQty: number;
};

const OIL_CATALOG: CatalogLine[] = [
  {
    sku: SOAP_RAW_SKUS.coconutOil,
    vendorCode: "KO-COCO-200L",
    vendorName: "Coconut Oil RBD (soap grade)",
    vendorUom: "drum",
    packSize: 200,
    price: 42000,
    minOrderQty: 1,
  },
  {
    sku: SOAP_RAW_SKUS.gingellyOil,
    vendorCode: "KO-GING-50KG",
    vendorName: "Gingelly / Sesame Oil",
    vendorUom: "bag",
    packSize: 50,
    price: 8500,
    minOrderQty: 2,
  },
  {
    sku: SOAP_RAW_SKUS.neemOil,
    vendorCode: "KO-NEEM-25L",
    vendorName: "Neem Oil cold-pressed",
    vendorUom: "can",
    packSize: 25,
    price: 12500,
    minOrderQty: 1,
  },
  {
    sku: SOAP_RAW_SKUS.castorOil,
    vendorCode: "KO-CAST-50KG",
    vendorName: "Castor Oil pharma grade",
    vendorUom: "bag",
    packSize: 50,
    price: 7200,
    minOrderQty: 1,
  },
];

const CHEM_CATALOG: CatalogLine[] = [
  {
    sku: SOAP_RAW_SKUS.causticSoda,
    vendorCode: "CS-NaOH-50KG",
    vendorName: "Caustic Soda Flakes 98%",
    vendorUom: "bag",
    packSize: 50,
    price: 2800,
    minOrderQty: 4,
  },
  {
    sku: SOAP_RAW_SKUS.dmdm,
    vendorCode: "CS-DMDM-25KG",
    vendorName: "DMDM Hydantoin preservative",
    vendorUom: "bag",
    packSize: 25,
    price: 18500,
    minOrderQty: 1,
  },
];

const HERB_CATALOG: CatalogLine[] = [
  {
    sku: SOAP_RAW_SKUS.flavourOil,
    vendorCode: "HI-LAV-5L",
    vendorName: "Lavender Fragrance Oil",
    vendorUom: "can",
    packSize: 5,
    price: 4200,
    minOrderQty: 2,
  },
  {
    sku: SOAP_RAW_SKUS.aloeGel,
    vendorCode: "HI-ALOE-20KG",
    vendorName: "Aloe Vera Gel 200:1",
    vendorUom: "bucket",
    packSize: 20,
    price: 6800,
    minOrderQty: 1,
  },
  {
    sku: SOAP_RAW_SKUS.tomatoJuice,
    vendorCode: "HI-TOM-10L",
    vendorName: "Tomato juice concentrate",
    vendorUom: "can",
    packSize: 10,
    price: 950,
    minOrderQty: 5,
  },
  {
    sku: SOAP_RAW_SKUS.cowMilk,
    vendorCode: "HI-MILK-20L",
    vendorName: "Fresh cow milk (bulk)",
    vendorUom: "can",
    packSize: 20,
    price: 1200,
    minOrderQty: 10,
  },
];

const PACK_CATALOG: CatalogLine[] = [
  {
    sku: "RAW-BOT-1L",
    vendorCode: "UP-PET-1L-500",
    vendorName: "PET bottle 1L clear (carton 500)",
    vendorUom: "carton",
    packSize: 500,
    price: 18500,
    minOrderQty: 1,
  },
  {
    sku: "RAW-CAP-S38",
    vendorCode: "UP-CAP-S38-1000",
    vendorName: "Cap safety seal 38mm (bag 1000)",
    vendorUom: "bag",
    packSize: 1000,
    price: 4200,
    minOrderQty: 2,
  },
];

async function ensureVendor(spec: VendorSpec) {
  const existing = await db.vendor.findUnique({ where: { code: spec.code } });
  if (existing) return existing;
  if (dryRun) return { id: `dry-${spec.code}`, code: spec.code, name: spec.name };
  return db.vendor.create({ data: { ...spec, active: true } });
}

async function ensureCatalog(vendorId: string, lines: CatalogLine[]) {
  for (const line of lines) {
    const product = await db.product.findUnique({ where: { sku: line.sku } });
    if (!product) {
      console.warn(`  skip catalog ${line.sku} — product not found (run db:seed-soap-boms:dev)`);
      continue;
    }
    const dup = await db.vendorProduct.findFirst({
      where: { vendorId, productId: product.id, variantId: null },
    });
    if (dup) {
      console.log(`  catalog exists: ${line.sku} → ${line.vendorCode}`);
      continue;
    }
    if (dryRun) {
      console.log(`  [dry] catalog ${line.sku} @ ${line.vendorUom}`);
      continue;
    }
    await db.vendorProduct.create({
      data: {
        vendorId,
        productId: product.id,
        variantId: null,
        vendorProductCode: line.vendorCode,
        vendorProductName: line.vendorName,
        vendorUom: line.vendorUom,
        packSize: line.packSize,
        price: line.price,
        minOrderQty: line.minOrderQty,
        priority: 100,
        active: true,
      },
    });
    console.log(`  catalog + ${line.sku} (${line.vendorCode})`);
  }
}

async function createDemoPo(
  vendorId: string,
  vendorCode: string,
  lines: Array<{ sku: string; vendorQty: number }>,
  status: "draft" | "approved"
) {
  const resolved = [];
  for (const line of lines) {
    const product = await db.product.findUnique({ where: { sku: line.sku } });
    if (!product) continue;
    const vp = await db.vendorProduct.findFirst({
      where: { vendorId, productId: product.id, active: true },
    });
    if (!vp) continue;
    resolved.push(
      await resolvePoLine(
        {
          productId: product.id,
          vendorProductId: vp.id,
          vendorQty: line.vendorQty,
        },
        vendorId
      )
    );
  }
  if (resolved.length === 0) return;

  const open = await db.purchaseOrder.findFirst({
    where: { vendorId, notes: { contains: "procurement-demo" } },
  });
  if (open) {
    console.log(`  PO demo exists for ${vendorCode}: ${open.poNo}`);
    return;
  }

  if (dryRun) {
    console.log(`  [dry] PO ${vendorCode} ${status} × ${resolved.length} lines`);
    return;
  }

  const last = await db.purchaseOrder.findFirst({
    where: { poNo: { startsWith: "PO-2026-" } },
    orderBy: { poNo: "desc" },
    select: { poNo: true },
  });
  const n = last ? parseInt(last.poNo.split("-").pop() ?? "1100", 10) + 1 : 1101;
  const poNo = `PO-2026-${String(n).padStart(4, "0")}`;
  const expected = new Date();
  expected.setDate(expected.getDate() + 10);
  const amount = resolved.reduce((s, l) => s + l.amount, 0);

  const po = await db.purchaseOrder.create({
    data: {
      poNo,
      vendorId,
      date: new Date(),
      expectedDate: expected,
      amount,
      status,
      notes: "procurement-demo — soap raw materials sample order",
      items: { create: resolved },
    },
  });
  console.log(`  PO ${po.poNo} (${status}) · ${vendorCode} · ${resolved.length} lines · ₹${amount.toFixed(0)}`);
  void po;
}

async function main() {
  console.log(dryRun ? "DRY RUN — procurement demo seed\n" : "Seeding procurement demo…\n");

  const oils = await ensureVendor(VENDORS[0]);
  const chem = await ensureVendor(VENDORS[1]);
  const herb = await ensureVendor(VENDORS[2]);
  const pack = await ensureVendor(VENDORS[3]);

  console.log("\nSupplier catalogs:");
  console.log("Oils vendor:");
  await ensureCatalog(oils.id, OIL_CATALOG);
  console.log("Chemicals vendor:");
  await ensureCatalog(chem.id, CHEM_CATALOG);
  console.log("Herbal vendor:");
  await ensureCatalog(herb.id, HERB_CATALOG);
  console.log("Packaging vendor:");
  await ensureCatalog(pack.id, PACK_CATALOG);

  console.log("\nSample purchase orders:");
  await createDemoPo(oils.id, oils.code, [
    { sku: SOAP_RAW_SKUS.coconutOil, vendorQty: 2 },
    { sku: SOAP_RAW_SKUS.neemOil, vendorQty: 1 },
    { sku: SOAP_RAW_SKUS.castorOil, vendorQty: 2 },
  ], "approved");
  await createDemoPo(chem.id, chem.code, [
    { sku: SOAP_RAW_SKUS.causticSoda, vendorQty: 8 },
    { sku: SOAP_RAW_SKUS.dmdm, vendorQty: 1 },
  ], "draft");
  await createDemoPo(herb.id, herb.code, [
    { sku: SOAP_RAW_SKUS.flavourOil, vendorQty: 3 },
    { sku: SOAP_RAW_SKUS.aloeGel, vendorQty: 2 },
  ], "draft");
  await createDemoPo(pack.id, pack.code, [
    { sku: "RAW-BOT-1L", vendorQty: 2 },
    { sku: "RAW-CAP-S38", vendorQty: 4 },
  ], "draft");

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
