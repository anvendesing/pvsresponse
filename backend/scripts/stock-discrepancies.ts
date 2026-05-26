// Stock discrepancy report.
//
// Surfaces master-data inconsistencies that the operator needs to resolve
// physically before manufacturing/billing flows can run cleanly. Read-only
// by default - prints findings, makes no DB writes.
//
// Categories of finding (each printed as its own section):
//
//   1. variant_uom_incompatible
//      The variant's selling UoM is in a different category from the
//      parent's stock UoM AND packSize is the default 1.0. Almost
//      certainly a setup mistake (e.g. parent in "kg", variant in "pc"
//      with packSize 1 means "1 pc = 1 kg" which is unlikely intended).
//      Fix: edit the variant in Products and set the correct UoM and
//      pack size, e.g. uom="pc" packSize=0.1 for a 100g pouch on a
//      kg-tracked parent.
//
//   2. variant_packsize_drift
//      Parent.stockOnHand differs from sum(variant.stockOnHand * variant.packSize)
//      beyond a small tolerance. Means the parent counter and the variant
//      counters disagree about how much physical stock exists. Could be:
//        - historical sales that decremented variants but not the parent
//        - manufacturing runs that incremented parent but not variants
//        - bad seed data (variants seeded with different totals)
//      Fix: do a physical recount and run an Inventory Adjustment.
//
//   3. bom_uom_incompatible
//      A BOM component's authored UoM lives in a different category from
//      the component product's stock UoM (e.g. BOM says "100 mL" but the
//      component product is stocked in "kg"). Production explosions will
//      reject this BOM at issue time.
//      Fix: edit the BOM and use a UoM in the same category as the
//      component product, OR change the component product's stock UoM.
//
// Usage: npx tsx scripts/stock-discrepancies.ts

import { db } from "../src/db.js";
import { UOMS, convertUom } from "../src/lib/uom.js";

interface Finding {
  category: "variant_uom_incompatible" | "variant_packsize_drift" | "bom_uom_incompatible";
  productSku: string;
  productName: string;
  detail: string;
}

const TOLERANCE = 0.001;

const sameCategory = (a: string, b: string): boolean => {
  if (a === b) return true;
  const ua = UOMS.find((u) => u.code === a);
  const ub = UOMS.find((u) => u.code === b);
  return !!ua && !!ub && ua.categoryCode === ub.categoryCode;
};

async function run() {
  const findings: Finding[] = [];

  // ----- 1. variant_uom_incompatible -----
  const products = await db.product.findMany({
    select: {
      id: true,
      sku: true,
      name: true,
      uom: true,
      stockOnHand: true,
      variants: {
        select: {
          id: true,
          sku: true,
          uom: true,
          packSize: true,
          stockOnHand: true,
          size: true,
        },
      },
    },
    orderBy: { sku: "asc" },
  });

  for (const p of products) {
    for (const v of p.variants) {
      const vu = (v.uom ?? "").trim();
      // No variant UoM set => inherits parent. That's always compatible.
      if (vu.length === 0) continue;
      if (vu === p.uom) continue;
      if (sameCategory(vu, p.uom)) continue;
      // Cross-category UoM is fine ONLY if packSize already encodes the
      // conversion (e.g. parent kg, variant pc, packSize 0.1 means
      // "1 pc = 0.1 kg"). The default packSize 1 with a cross-category
      // UoM almost always indicates a setup mistake.
      if (Math.abs((v.packSize ?? 1) - 1) < TOLERANCE) {
        findings.push({
          category: "variant_uom_incompatible",
          productSku: p.sku,
          productName: p.name,
          detail: `variant ${v.sku} (${v.size ?? "—"}) has uom="${vu}" while parent is "${p.uom}" and packSize=1. Either set packSize (e.g. 0.1 for a 100g pouch on a kg parent), or change the variant uom.`,
        });
      }
    }
  }

  // ----- 2. variant_packsize_drift -----
  for (const p of products) {
    if (p.variants.length === 0) continue;
    let expectedFromVariants = 0;
    let convertible = true;
    for (const v of p.variants) {
      const vu = (v.uom ?? "").trim() || p.uom;
      const variantInParentUom = (v.stockOnHand ?? 0) * (v.packSize ?? 1);
      // If variant.uom is in same category as parent.uom (or equal),
      // packSize is interpreted in parent units directly.
      if (vu === p.uom || sameCategory(vu, p.uom)) {
        expectedFromVariants += variantInParentUom;
      } else {
        // Cross-category: packSize bridges directly to parent.uom by
        // contract (1 variant unit = packSize parent units), so we still
        // accumulate.
        expectedFromVariants += variantInParentUom;
      }
      // If we ever fail conversion, flag and bail (section 1 already
      // covered cross-category issues).
      void convertible;
    }
    const drift = expectedFromVariants - p.stockOnHand;
    if (Math.abs(drift) > TOLERANCE) {
      findings.push({
        category: "variant_packsize_drift",
        productSku: p.sku,
        productName: p.name,
        detail: `parent stockOnHand=${p.stockOnHand} ${p.uom} but sum(variant*packSize)=${expectedFromVariants.toFixed(3)} ${p.uom} (drift ${drift > 0 ? "+" : ""}${drift.toFixed(3)} ${p.uom})`,
      });
    }
  }

  // ----- 3. bom_uom_incompatible -----
  const bomItems = await db.bomItem.findMany({
    include: {
      bom: {
        select: {
          id: true,
          product: { select: { sku: true, name: true } },
          variant: { select: { sku: true } },
          active: true,
        },
      },
      product: { select: { sku: true, name: true, uom: true } },
    },
  });
  for (const bi of bomItems) {
    if (bi.uom === bi.product.uom) continue;
    if (sameCategory(bi.uom, bi.product.uom)) {
      // Same category - convertible. Just verify the conversion doesn't
      // throw (it shouldn't, but defensive).
      try {
        convertUom(bi.qty, bi.uom, bi.product.uom, UOMS);
        continue;
      } catch {
        // fall through
      }
    }
    findings.push({
      category: "bom_uom_incompatible",
      productSku: bi.bom.product.sku,
      productName: bi.bom.product.name,
      detail: `BOM ${bi.bom.product.sku}${bi.bom.variant ? `/${bi.bom.variant.sku}` : ""} (${bi.bom.active ? "active" : "inactive"}) component "${bi.product.sku}" specifies qty in "${bi.uom}" but the component is stocked in "${bi.product.uom}" (different category - cannot convert).`,
    });
  }

  // ----- Report -----
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = groups.get(f.category) ?? [];
    list.push(f);
    groups.set(f.category, list);
  }

  if (findings.length === 0) {
    console.log("No stock discrepancies found. Master data is clean.");
    return;
  }

  const titles: Record<Finding["category"], string> = {
    variant_uom_incompatible: "Variant UoM / parent UoM mismatch (set packSize correctly)",
    variant_packsize_drift: "Parent stock != sum(variant.stockOnHand * packSize)",
    bom_uom_incompatible: "BOM component UoM is not convertible to its product's stock UoM",
  };

  for (const [cat, list] of groups) {
    console.log(`\n=== ${titles[cat as Finding["category"]]} (${list.length}) ===`);
    const colW = Math.max(...list.map((f) => f.productSku.length), 6);
    for (const f of list) {
      console.log(`  ${f.productSku.padEnd(colW)}  ${f.productName}`);
      console.log(`  ${" ".repeat(colW)}  ${f.detail}`);
    }
  }

  console.log(`\nTotal findings: ${findings.length}`);
  console.log("\nResolution guide:");
  console.log("  variant_uom_incompatible -> Products page > edit variant > set Selling UoM and Pack size.");
  console.log("  variant_packsize_drift   -> physical recount + Inventory > Adjustments to bring counters in line.");
  console.log("  bom_uom_incompatible     -> Manufacturing > BOMs > edit and use a same-category UoM.");
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
