/**
 * Import alternate/regional product names from the products xlsx into
 * Product.searchAliases so the storefront can search by them.
 *
 * The xlsx has columns: ID | Product Name | Size/Pack | Price | SKU | Alternate Names
 * Alternate Names is a comma-separated string, shared across all variants of a product.
 * The xlsx uses legacy short SKUs (e.g. "SM989") that no longer match the DB. Matching
 * is done by product name (case-insensitive).
 *
 * Usage:
 *   npx tsx scripts/import-product-aliases.ts --dry-run   (default)
 *   npx tsx scripts/import-product-aliases.ts --apply
 *   npx tsx scripts/import-product-aliases.ts --apply --xlsx "../products-2026-01-07.xlsx"
 */
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const xlsxIdx = args.indexOf("--xlsx");
const XLSX_PATH = xlsxIdx >= 0 ? args[xlsxIdx + 1]! : "../products-2026-01-07.xlsx";

const norm = (s: unknown): string => String(s ?? "").trim();

/** Parse and normalise a comma-separated alias string. Returns empty string if none. */
function normaliseAliases(raw: string): string {
  const cleaned = norm(raw);
  if (!cleaned || cleaned === "-") return "";
  const parts = cleaned
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  return unique.join(", ");
}

interface XlsxRow {
  productName: string;
  aliases: string; // normalised
}

function parseXlsx(path: string): XlsxRow[] {
  const buf = readFileSync(path);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["Product List"] ?? wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error("Could not find worksheet in xlsx.");

  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
  }) as unknown[][];

  // Locate header row (banner row 0 is "Complete Product List")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const row = raw[i] as unknown[];
    if (row.some((c) => String(c ?? "").trim() === "SKU")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Could not locate header row with 'SKU'.");

  const header = (raw[headerIdx] as unknown[]).map((c) => String(c ?? "").trim());
  const nameCol = header.findIndex((h) => h.toLowerCase().includes("product name"));
  const altCol = header.findIndex(
    (h) => h.toLowerCase().includes("alternate") || h.toLowerCase().includes("alt")
  );

  if (nameCol < 0) throw new Error("Product Name column not found.");
  if (altCol < 0) throw new Error("Alternate Names column not found.");

  const rows: XlsxRow[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const productName = norm(row[nameCol]);
    if (!productName) continue;
    const aliases = normaliseAliases(norm(row[altCol]));
    rows.push({ productName, aliases });
  }
  return rows;
}

async function main() {
  console.log(dryRun ? "[dry-run]" : "[apply]", `Reading ${XLSX_PATH}`);

  const xlsxRows = parseXlsx(XLSX_PATH);
  console.log(`Parsed ${xlsxRows.length} product rows from xlsx`);

  // Build per-product-name → aliases map (first non-empty alias wins; warn on conflicts)
  const nameAliasMap = new Map<string, string>(); // lowered name → aliases
  for (const row of xlsxRows) {
    if (!row.aliases) continue;
    const key = row.productName.toLowerCase();
    const existing = nameAliasMap.get(key);
    if (!existing) {
      nameAliasMap.set(key, row.aliases);
    } else if (existing !== row.aliases) {
      const merged = Array.from(
        new Set([...existing.split(", "), ...row.aliases.split(", ")])
      ).join(", ");
      nameAliasMap.set(key, merged);
    }
  }
  console.log(`${nameAliasMap.size} distinct product names with aliases in xlsx`);

  // Load all products from DB, keyed by lowercased name
  const dbProducts = await db.product.findMany({
    select: { id: true, name: true, sku: true, searchAliases: true },
  });
  const dbByName = new Map(dbProducts.map((p) => [p.name.trim().toLowerCase(), p]));

  let matched = 0;
  let noMatch = 0;
  const noMatchNames: string[] = [];
  let updated = 0;
  let skipped = 0;

  for (const [lowName, aliases] of nameAliasMap) {
    const product = dbByName.get(lowName);
    if (!product) {
      noMatch++;
      noMatchNames.push(lowName);
      continue;
    }
    matched++;
    if (product.searchAliases === aliases) {
      skipped++;
      continue;
    }
    console.log(
      `  ${product.sku} (${product.name}): "${aliases.slice(0, 60)}${aliases.length > 60 ? "…" : ""}"`
    );
    if (!dryRun) {
      await db.product.update({
        where: { id: product.id },
        data: { searchAliases: aliases },
      });
    }
    updated++;
  }

  console.log(`\nMatched:   ${matched} products`);
  console.log(`No match:  ${noMatch} xlsx products (name not found in DB)`);
  if (noMatchNames.length) {
    console.log("Unmatched names:", noMatchNames.slice(0, 20).join(", ") + (noMatchNames.length > 20 ? "…" : ""));
  }
  console.log(
    dryRun
      ? `Would update ${updated} products, ${skipped} already up-to-date`
      : `Updated ${updated} products, ${skipped} already up-to-date`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
