// Audit putaway rules grouped by product type, to confirm semi /
// raw / packaging products don't carry rules.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const rules = await db.putawayRule.findMany({
    include: {
      product: { select: { type: true } },
    },
  });

  const byType = new Map<string, number>();
  for (const r of rules) {
    const t = r.product.type ?? "unknown";
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }

  console.log("Putaway rules by product type:");
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(12)} ${n}`);
  }
  console.log(`\nTotal: ${rules.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
