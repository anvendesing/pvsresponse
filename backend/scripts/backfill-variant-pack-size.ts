// One-shot pack-size backfill.
//
// Walks every active ProductVariant whose packSize is still the
// default (1) and whose SKU encodes a unit-bearing size token
// (e.g. `BAJF-1KG-01`, `CAOL-AMU-250ML-05`, `BSOP-COW-100G-01`).
// Derives the variant's pack size in the parent's bulk UoM and
// updates the column.
//
// Why
// ---
// The "Packaged total in bulk UoM" row on the Products / Stock
// breakdown panel is `Σ variant.stockOnHand × packSize`. With
// packSize = 1 (the seed default) the roll-up is just a piece
// count, which is meaningless when the parent UoM is kg or L. After
// this script runs the roll-up reflects the real grams / millilitres
// of bulk that the variant pieces contain.
//
// Safety rules
// ------------
//   • Only touches variants where packSize === 1. A non-default
//     value is treated as deliberate and left alone.
//   • Only touches variants whose SKU contains exactly ONE numeric
//     size token (e.g. `1KG`, `250ML`, `100G`, `5L`). Compound
//     dimensions like `31CM*75CM` or count packs like `30PC` /
//     `90STICKS` are skipped — there's no valid conversion to a
//     mass / volume parent UoM.
//   • Conversion table is keyed on parent.uom:
//       kg   ← KG, G  (G/1000 → kg)
//       g    ← KG, G  (KG*1000 → g)
//       L    ← L, ML  (ML/1000 → L)
//       ml   ← L, ML  (L*1000 → ml)
//     Any other parent UoM (`pc`, `pack`, `set`, …) → skip.
//
// Dry-run with `--dry-run` to inspect changes before applying.

import { db } from "../src/db.js";

const dryRun = process.argv.includes("--dry-run");

// ─── parsing ────────────────────────────────────────────────────────
type ParsedSize = { qty: number; unit: "kg" | "g" | "l" | "ml" };

const SIZE_RE = /(\d+(?:\.\d+)?)(KG|G|L|ML)\b/gi;

const parseSizeFromSku = (sku: string): ParsedSize | null => {
  const matches = Array.from(sku.matchAll(SIZE_RE));
  // Multi-token SKUs (e.g. `31CM*75CM`) are unsafe to interpret.
  // We allow exactly ONE size match.
  if (matches.length !== 1) return null;
  const m = matches[0];
  const qty = parseFloat(m[1]);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unit = m[2].toLowerCase() as ParsedSize["unit"];
  return { qty, unit };
};

// Convert (parsed.qty parsed.unit) → parent UoM.
// Returns null if the units aren't compatible (e.g. ML token on a
// kg-UoM parent).
const convertToParentUom = (
  parsed: ParsedSize,
  parentUom: string
): number | null => {
  const pUom = parentUom.toLowerCase();
  // Mass family.
  if ((pUom === "kg" || pUom === "g") && (parsed.unit === "kg" || parsed.unit === "g")) {
    const inG = parsed.unit === "kg" ? parsed.qty * 1000 : parsed.qty;
    return pUom === "kg" ? inG / 1000 : inG;
  }
  // Volume family.
  if ((pUom === "l" || pUom === "ml") && (parsed.unit === "l" || parsed.unit === "ml")) {
    const inMl = parsed.unit === "l" ? parsed.qty * 1000 : parsed.qty;
    return pUom === "l" ? inMl / 1000 : inMl;
  }
  return null;
};

// ─── main ───────────────────────────────────────────────────────────
const main = async () => {
  const variants = await db.productVariant.findMany({
    where: { packSize: 1, active: true },
    include: {
      product: { select: { id: true, sku: true, uom: true } },
    },
    orderBy: { sku: "asc" },
  });

  console.log(
    `${dryRun ? "DRY RUN — " : ""}inspecting ${variants.length} variant(s) with packSize=1…\n`
  );

  let updated = 0;
  let skippedNoSize = 0;
  let skippedIncompatible = 0;
  let skippedAmbiguous = 0;
  let skippedAlready = 0; // packSize already correct (e.g. 1KG variants on kg parent)

  for (const v of variants) {
    const parent = v.product;
    const parsed = parseSizeFromSku(v.sku);
    if (!parsed) {
      skippedNoSize++;
      continue;
    }
    const newPack = convertToParentUom(parsed, parent.uom);
    if (newPack == null) {
      skippedIncompatible++;
      console.log(
        `  SKIP (uom mismatch)  ${v.sku.padEnd(28)} parent uom=${parent.uom}  size=${parsed.qty}${parsed.unit}`
      );
      continue;
    }
    if (newPack === 1) {
      // e.g. BAJF-1KG-01 on parent uom=kg → 1.0, no change needed.
      skippedAlready++;
      continue;
    }
    if (newPack <= 0 || newPack > 1000) {
      // Suspect parse — bail rather than wreck the data.
      skippedAmbiguous++;
      console.log(
        `  SKIP (out of range)  ${v.sku.padEnd(28)} computed pack=${newPack}`
      );
      continue;
    }

    if (dryRun) {
      console.log(
        `  DRY  ${v.sku.padEnd(28)} 1 → ${newPack}  (1 ${v.uom ?? "pc"} = ${newPack} ${parent.uom})`
      );
    } else {
      await db.productVariant.update({
        where: { id: v.id },
        data: { packSize: newPack },
      });
      console.log(
        `  TAG  ${v.sku.padEnd(28)} 1 → ${newPack}  (1 ${v.uom ?? "pc"} = ${newPack} ${parent.uom})`
      );
    }
    updated++;
  }

  console.log(
    `\nDone. ${dryRun ? "would update" : "updated"}=${updated}` +
      `  skipped(no size token)=${skippedNoSize}` +
      `  skipped(uom incompatible)=${skippedIncompatible}` +
      `  skipped(out of range)=${skippedAmbiguous}` +
      `  skipped(already correct)=${skippedAlready}`
  );

  await db.$disconnect();
};

void main();
