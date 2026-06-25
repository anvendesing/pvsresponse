/**
 * Export every variant covered by a Stock Room (STR) Zone PR putaway rule.
 *
 * A product-level rule (variantId = null) expands to all active variants
 * of that product. A variant-level rule covers only that variant.
 *
 *   npx tsx src/scripts/export-zone-pr-variants.ts
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { STOCK_ROOM_WAREHOUSE_CODE } from "../lib/stock-room-layout.js";

const db = new PrismaClient();
const ZONE_PR = "PR";

type ExportRow = {
  variantSku: string;
  variantBarcode: string | null;
  productSku: string;
  productName: string;
  productType: string;
  ruleScope: "product" | "variant";
  rulePriority: number;
  ruleNotes: string | null;
  stockOnHand: number;
  strBinQty: number;
  strBinCode: string | null;
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

  const rules = await db.putawayRule.findMany({
    where: {
      toWarehouseId: strWh.id,
      toZone: ZONE_PR,
      active: true,
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          type: true,
          state: true,
          variants: {
            where: { product: { state: "active" } },
            select: {
              id: true,
              sku: true,
              barcode: true,
              stockOnHand: true,
            },
            orderBy: { sku: "asc" },
          },
        },
      },
      variant: {
        select: {
          id: true,
          sku: true,
          barcode: true,
          stockOnHand: true,
          product: { select: { sku: true, name: true, type: true, state: true } },
        },
      },
    },
    orderBy: [{ priority: "asc" }, { product: { sku: "asc" } }],
  });

  const strBins = await db.bin.findMany({
    where: { warehouseId: strWh.id, zone: ZONE_PR },
    select: {
      code: true,
      variantId: true,
      productId: true,
      qty: true,
    },
  });

  const binByVariant = new Map<string, { code: string; qty: number }>();
  const binByProduct = new Map<string, { code: string; qty: number }>();
  for (const b of strBins) {
    const code = b.code ?? "";
    if (b.variantId) {
      const prev = binByVariant.get(b.variantId);
      binByVariant.set(b.variantId, {
        code: prev ? `${prev.code}; ${code}` : code,
        qty: (prev?.qty ?? 0) + b.qty,
      });
    } else if (b.productId) {
      const prev = binByProduct.get(b.productId);
      binByProduct.set(b.productId, {
        code: prev ? `${prev.code}; ${code}` : code,
        qty: (prev?.qty ?? 0) + b.qty,
      });
    }
  }

  const rows: ExportRow[] = [];
  const seenVariantIds = new Set<string>();

  for (const rule of rules) {
    const scope: ExportRow["ruleScope"] = rule.variantId ? "variant" : "product";
    const targets =
      rule.variantId && rule.variant
        ? [rule.variant]
        : rule.product.variants.filter((v) => rule.product.state === "active");

    for (const v of targets) {
      if (seenVariantIds.has(v.id)) continue;
      seenVariantIds.add(v.id);

      const product = rule.variant?.product ?? rule.product;
      const bin =
        binByVariant.get(v.id) ??
        (binByProduct.get(rule.product.id) ?? null);

      rows.push({
        variantSku: v.sku,
        variantBarcode: v.barcode,
        productSku: product.sku,
        productName: product.name,
        productType: product.type,
        ruleScope: scope,
        rulePriority: rule.priority,
        ruleNotes: rule.notes,
        stockOnHand: v.stockOnHand,
        strBinQty: bin?.qty ?? 0,
        strBinCode: bin?.code ?? null,
      });
    }
  }

  rows.sort((a, b) => a.variantSku.localeCompare(b.variantSku));

  const header =
    "variantSku,variantBarcode,productSku,productName,productType,ruleScope,rulePriority,ruleNotes,stockOnHand,strBinQty,strBinCode\n";
  const body = rows
    .map((r) =>
      [
        r.variantSku,
        r.variantBarcode ?? "",
        r.productSku,
        `"${r.productName.replace(/"/g, '""')}"`,
        r.productType,
        r.ruleScope,
        r.rulePriority,
        `"${(r.ruleNotes ?? "").replace(/"/g, '""')}"`,
        r.stockOnHand,
        r.strBinQty,
        r.strBinCode ?? "",
      ].join(",")
    )
    .join("\n");

  const outDir = resolve(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "zone-pr-putaway-variants.csv");
  writeFileSync(outPath, header + body, "utf-8");

  const byType = new Map<string, number>();
  for (const r of rows) {
    byType.set(r.productType, (byType.get(r.productType) ?? 0) + 1);
  }

  console.log(`\nZone PR putaway export (${STOCK_ROOM_WAREHOUSE_CODE} · zone ${ZONE_PR})`);
  console.log("=".repeat(60));
  console.log(`Putaway rules (active, zone PR):  ${rules.length}`);
  console.log(`Variants exported:                ${rows.length}`);
  console.log(`Variants with STR.PR bin:         ${rows.filter((r) => r.strBinCode).length}`);
  console.log(`Variants with bin qty > 0:        ${rows.filter((r) => r.strBinQty > 0).length}`);
  console.log("\nBy product type:");
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(14)} ${n}`);
  }
  console.log(`\nCSV: ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
