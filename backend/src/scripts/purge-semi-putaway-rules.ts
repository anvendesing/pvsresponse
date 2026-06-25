/**
 * Delete putaway rules whose product is type=semi. Semi-finished
 * goods (BRAR-SEMI, WHET-SEMI, …) should stay on their production
 * warehouse; routing them through STR.PR would create useless
 * putaway TOs and clutter the staging zone.
 *
 *   npx tsx src/scripts/purge-semi-putaway-rules.ts            # dry-run
 *   npx tsx src/scripts/purge-semi-putaway-rules.ts --apply    # commit
 */

import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const db = new PrismaClient();

async function main() {
  console.log(
    apply
      ? "=== Purge semi-product putaway rules === APPLYING"
      : "=== DRY RUN === (pass --apply to delete)"
  );

  const rules = await db.putawayRule.findMany({
    where: { product: { type: "semi" } },
    include: {
      product: { select: { sku: true, name: true, type: true } },
      toWarehouse: { select: { code: true } },
    },
    orderBy: [{ product: { sku: "asc" } }],
  });

  if (rules.length === 0) {
    console.log("No semi-product putaway rules. Nothing to delete.");
    return;
  }

  for (const r of rules) {
    const dest = r.toBinId
      ? `bin=${r.toBinId}`
      : r.toZone
        ? `zone=${r.toZone}`
        : "warehouse-level";
    console.log(
      `  ${apply ? "delete" : "[dry] delete"}  ${r.product.sku.padEnd(20)}` +
        `  ${r.toWarehouse.code} ${dest}`
    );
  }

  if (apply) {
    const ids = rules.map((r) => r.id);
    const res = await db.putawayRule.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nDeleted ${res.count} semi-product putaway rule(s).`);
  } else {
    console.log(
      `\n${rules.length} semi-product rule(s) would be deleted. Re-run with --apply.`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
