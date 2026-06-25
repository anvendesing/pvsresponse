/**
 * Report variants that lack Stock Room (STR) putaway rules AND are not
 * assigned to any STR bin.
 *
 *   npx tsx src/scripts/analyze-variants-missing-str.ts
 *   npx tsx src/scripts/analyze-variants-missing-str.ts --csv
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../lib/stock-room-layout.js";

const db = new PrismaClient();
const asCsv = process.argv.includes("--csv");

type Row = {
  variantSku: string;
  variantBarcode: string | null;
  productSku: string;
  productName: string;
  productType: string;
  productState: string;
  stockOnHand: number;
  hasStrPutawayRule: boolean;
  putawayRuleKind: string | null;
  hasStrBin: boolean;
  strBinQty: number;
  strBinCodes: string;
};

async function main() {
  const strWh = await db.warehouse.findUnique({
    where: { code: STOCK_ROOM_WAREHOUSE_CODE },
    select: { id: true, name: true },
  });
  if (!strWh) {
    console.error(`Warehouse ${STOCK_ROOM_WAREHOUSE_CODE} not found.`);
    process.exit(1);
  }

  const [variants, strRules, strBins] = await Promise.all([
    db.productVariant.findMany({
      where: { product: { state: "active" } },
      select: {
        id: true,
        sku: true,
        barcode: true,
        stockOnHand: true,
        product: {
          select: { id: true, sku: true, name: true, type: true, state: true },
        },
      },
      orderBy: [{ product: { sku: "asc" } }, { sku: "asc" }],
    }),
    db.putawayRule.findMany({
      where: { toWarehouseId: strWh.id, active: true },
      select: {
        productId: true,
        variantId: true,
        toZone: true,
        toBinId: true,
        tobin: { select: { code: true, zone: true } },
      },
    }),
    db.bin.findMany({
      where: { warehouseId: strWh.id },
      select: {
        id: true,
        code: true,
        zone: true,
        shelf: true,
        bin: true,
        productId: true,
        variantId: true,
        qty: true,
      },
    }),
  ]);

  // Index putaway coverage: product-level (variantId=null) + variant-specific.
  const productRule = new Map<
    string,
    { kind: string; detail: string }
  >();
  const variantRule = new Map<string, { kind: string; detail: string }>();

  for (const r of strRules) {
    const detail = r.toBinId
      ? `bin ${r.tobin?.code ?? r.toBinId}`
      : r.toZone
        ? `zone ${r.toZone}`
        : "warehouse default";
    const kind = r.variantId ? "variant" : "product";
    const entry = { kind, detail };
    if (r.variantId) variantRule.set(r.variantId, entry);
    else productRule.set(r.productId, entry);
  }

  // Index STR bin presence per variant (and per product for untagged bins).
  const variantBinQty = new Map<string, number>();
  const variantBinCodes = new Map<string, string[]>();
  const productBinQty = new Map<string, number>();

  for (const b of strBins) {
    const code = b.code ?? `${b.zone}.${b.shelf}.${b.bin}`;
    if (b.variantId) {
      variantBinQty.set(b.variantId, (variantBinQty.get(b.variantId) ?? 0) + b.qty);
      const list = variantBinCodes.get(b.variantId) ?? [];
      list.push(`${code}(${b.qty})`);
      variantBinCodes.set(b.variantId, list);
    } else if (b.productId) {
      productBinQty.set(b.productId, (productBinQty.get(b.productId) ?? 0) + b.qty);
    }
  }

  const rows: Row[] = [];
  const missingBoth: Row[] = [];

  for (const v of variants) {
    const vRule = variantRule.get(v.id);
    const pRule = productRule.get(v.product.id);
    const hasStrPutawayRule = !!(vRule || pRule);
    const putawayRuleKind = vRule
      ? `variant → ${vRule.detail}`
      : pRule
        ? `product → ${pRule.detail}`
        : null;

    const hasVariantBin = variantBinCodes.has(v.id);
    const hasProductBin = productBinQty.has(v.product.id);
    const strBinQty =
      (variantBinQty.get(v.id) ?? 0) +
      (hasVariantBin ? 0 : productBinQty.get(v.product.id) ?? 0);
    const hasStrBin = hasVariantBin || (!hasVariantBin && hasProductBin);

    const row: Row = {
      variantSku: v.sku,
      variantBarcode: v.barcode,
      productSku: v.product.sku,
      productName: v.product.name,
      productType: v.product.type,
      productState: v.product.state,
      stockOnHand: v.stockOnHand,
      hasStrPutawayRule,
      putawayRuleKind,
      hasStrBin,
      strBinQty,
      strBinCodes: (variantBinCodes.get(v.id) ?? []).join(", "),
    };
    rows.push(row);

    if (!hasStrPutawayRule && !hasStrBin) {
      missingBoth.push(row);
    }
  }

  const byType = (list: Row[]) => {
    const m = new Map<string, number>();
    for (const r of list) {
      m.set(r.productType, (m.get(r.productType) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  console.log(`\nStock Room analysis (${STOCK_ROOM_WAREHOUSE_CODE} · ${strWh.name})`);
  console.log("=".repeat(72));
  console.log(`Active variants total:        ${variants.length}`);
  console.log(`STR putaway rules (active):   ${strRules.length}`);
  console.log(`STR bins (all):               ${strBins.length}`);
  console.log(`STR bins with qty > 0:        ${strBins.filter((b) => b.qty > 0).length}`);
  console.log("");
  console.log(`Variants WITHOUT STR putaway:   ${rows.filter((r) => !r.hasStrPutawayRule).length}`);
  console.log(`Variants NOT in any STR bin:   ${rows.filter((r) => !r.hasStrBin).length}`);
  console.log(`Variants missing BOTH:         ${missingBoth.length}`);
  console.log("");
  console.log("Missing BOTH — by product type:");
  for (const [t, n] of byType(missingBoth)) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }

  const finishedMissing = missingBoth.filter((r) => r.productType === "finished");
  const finishedWithStock = finishedMissing.filter((r) => r.stockOnHand > 0);

  console.log("");
  console.log(`Finished variants missing BOTH: ${finishedMissing.length}`);
  console.log(`  …with stockOnHand > 0:        ${finishedWithStock.length}`);

  if (finishedWithStock.length > 0) {
    console.log("\n⚠ Finished variants with stock but no STR rule/bin (top 30):");
    for (const r of finishedWithStock.slice(0, 30)) {
      console.log(
        `  ${r.variantSku.padEnd(22)} barcode=${(r.variantBarcode ?? "—").padEnd(8)} SOH=${String(r.stockOnHand).padStart(6)}  ${r.productName.slice(0, 40)}`
      );
    }
  }

  console.log("\nSample — finished missing BOTH (first 40):");
  for (const r of finishedMissing.slice(0, 40)) {
    console.log(
      `  ${r.variantSku.padEnd(22)} ${r.productSku.padEnd(16)} SOH=${String(r.stockOnHand).padStart(5)}  ${r.productName.slice(0, 36)}`
    );
  }
  if (finishedMissing.length > 40) {
    console.log(`  … and ${finishedMissing.length - 40} more`);
  }

  // Secondary lens: finished variants that HAVE a putaway rule but still
  // sit in no STR bin (common after rule seeding before first receipt).
  const finishedNoBin = rows.filter(
    (r) => r.productType === "finished" && r.hasStrPutawayRule && !r.hasStrBin
  );
  const finishedNoBinWithStock = finishedNoBin.filter((r) => r.stockOnHand > 0);
  console.log("");
  console.log(`Finished WITH putaway rule but NO STR bin: ${finishedNoBin.length}`);
  console.log(`  …with stockOnHand > 0:                    ${finishedNoBinWithStock.length}`);
  if (finishedNoBinWithStock.length > 0) {
    console.log("\n  Top 20 finished (rule exists, stock but no STR bin):");
    for (const r of finishedNoBinWithStock.slice(0, 20)) {
      console.log(
        `    ${r.variantSku.padEnd(22)} SOH=${String(r.stockOnHand).padStart(6)}  rule: ${r.putawayRuleKind}`
      );
    }
  }

  // Variants with no STR bin at all (broader set — includes those WITH rules).
  const noBinByType = byType(rows.filter((r) => !r.hasStrBin));
  console.log("");
  console.log(`All variants NOT in any STR bin (${rows.filter((r) => !r.hasStrBin).length}) — by type:`);
  for (const [t, n] of noBinByType) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }

  if (asCsv) {
    const header =
      "variantSku,variantBarcode,productSku,productName,productType,stockOnHand,hasStrPutawayRule,putawayRuleKind,hasStrBin,strBinQty,strBinCodes\n";
    const body = missingBoth
      .map((r) =>
        [
          r.variantSku,
          r.variantBarcode ?? "",
          r.productSku,
          `"${r.productName.replace(/"/g, '""')}"`,
          r.productType,
          r.stockOnHand,
          r.hasStrPutawayRule,
          r.putawayRuleKind ?? "",
          r.hasStrBin,
          r.strBinQty,
          `"${r.strBinCodes.replace(/"/g, '""')}"`,
        ].join(",")
      )
      .join("\n");
    const out = resolve(process.cwd(), "output", "variants-missing-str-putaway-and-bins.csv");
    writeFileSync(out, header + body, "utf-8");
    console.log(`\nCSV written: ${out} (${missingBoth.length} rows)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
