// Seed canonical UoM categories + UoMs from src/lib/uom.ts.
//
// Idempotent - safe to re-run. Uses upserts keyed by .code.
//
// Run with: npx tsx scripts/seed-uoms.ts
import { PrismaClient } from "@prisma/client";
import { UOM_CATEGORIES, UOMS } from "../src/lib/uom";

const db = new PrismaClient();

async function main() {
  console.log("Seeding UoM categories...");
  for (const c of UOM_CATEGORIES) {
    await db.uomCategory.upsert({
      where: { code: c.code },
      create: { code: c.code, name: c.name, description: c.description },
      update: { name: c.name, description: c.description },
    });
    console.log(`  ✓ category ${c.code} (${c.name})`);
  }

  // Build a code -> id map for quick lookup.
  const cats = await db.uomCategory.findMany();
  const catByCode = new Map(cats.map((c) => [c.code, c.id]));

  console.log("Seeding UoMs...");
  for (const u of UOMS) {
    const categoryId = catByCode.get(u.categoryCode);
    if (!categoryId) {
      throw new Error(`Unknown UoM category code: ${u.categoryCode}`);
    }
    await db.uom.upsert({
      where: { code: u.code },
      create: {
        code: u.code,
        name: u.name,
        categoryId,
        factor: u.factor,
        isReference: u.isReference ?? false,
        rounding: u.rounding ?? 0.001,
        active: u.active ?? true,
      },
      update: {
        name: u.name,
        categoryId,
        factor: u.factor,
        isReference: u.isReference ?? false,
        rounding: u.rounding ?? 0.001,
        active: u.active ?? true,
      },
    });
    console.log(
      `  ✓ ${u.code.padEnd(8)} ${u.name.padEnd(15)} ${u.categoryCode.padEnd(8)} factor=${u.factor}`
    );
  }

  // Sanity check: each category has exactly one reference UoM.
  for (const c of UOM_CATEGORIES) {
    const refs = await db.uom.count({
      where: { category: { code: c.code }, isReference: true },
    });
    if (refs !== 1) {
      throw new Error(
        `Category ${c.code} has ${refs} reference UoM(s); expected exactly 1`
      );
    }
  }

  console.log("UoM seed complete.");
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    return db.$disconnect().then(() => process.exit(1));
  });
