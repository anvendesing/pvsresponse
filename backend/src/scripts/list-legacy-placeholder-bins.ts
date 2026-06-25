// Quick audit: list bins in placeholder zones ("_" or "WH") across
// every warehouse, regardless of qty. Helps confirm whether the
// guard/migration cleanup has any remaining stragglers to handle.

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const rows = await db.bin.findMany({
    where: { OR: [{ zone: "_" }, { zone: "WH" }] },
    include: {
      warehouse: { select: { code: true, name: true } },
      product: { select: { sku: true } },
    },
    orderBy: [{ warehouse: { code: "asc" } }, { qty: "desc" }],
  });
  if (rows.length === 0) {
    console.log("No placeholder bins in '_' or 'WH' zones anywhere.");
    return;
  }
  let withStock = 0;
  for (const r of rows) {
    if (r.qty > 0) withStock++;
    console.log(
      `${r.warehouse.code.padEnd(14)}  ${r.code ?? `${r.zone}/${r.shelf}/${r.bin}`.padEnd(20)}` +
        `  qty=${String(r.qty).padStart(6)}  reserved=${r.reservedQty}` +
        `  product=${r.product?.sku ?? "—"}`
    );
  }
  console.log(`\nTotal: ${rows.length} placeholder bins (${withStock} with qty > 0)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
