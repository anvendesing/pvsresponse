// Quick audit: list distinct UoMs used in Product and BomItem.
// Run with: npx tsx scripts/audit-uoms.ts
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const rows = await db.product.groupBy({
    by: ["uom"],
    _count: { _all: true },
    orderBy: { _count: { uom: "desc" } },
  });
  console.log("--- Product.uom distinct values ---");
  for (const r of rows) {
    console.log(`  ${JSON.stringify(r.uom)} -> ${r._count._all}`);
  }

  const bomItemUoms = await db.bomItem.groupBy({
    by: ["uom"],
    _count: { _all: true },
    orderBy: { _count: { uom: "desc" } },
  });
  console.log("--- BomItem.uom distinct values ---");
  for (const r of bomItemUoms) {
    console.log(`  ${JSON.stringify(r.uom)} -> ${r._count._all}`);
  }
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    return db.$disconnect().then(() => process.exit(1));
  });
