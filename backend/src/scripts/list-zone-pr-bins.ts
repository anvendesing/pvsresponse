// Audit: list bins in STR Zone PR (the new staging zone).

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const wh = await db.warehouse.findUnique({ where: { code: "STR" } });
  if (!wh) {
    console.error("STR not found.");
    process.exit(1);
  }
  const rows = await db.bin.findMany({
    where: { warehouseId: wh.id, zone: "PR" },
    include: { product: { select: { sku: true, name: true, uom: true } } },
    orderBy: [{ shelf: "asc" }],
  });
  if (rows.length === 0) {
    console.log("Zone PR is empty.");
    return;
  }
  for (const r of rows) {
    console.log(
      `${r.code ?? `${r.zone}/${r.shelf}/${r.bin}`.padEnd(22)}  qty=${String(r.qty).padStart(6)} ${r.product?.uom ?? ""}` +
        `  ${r.product?.sku ?? "—"}  ${r.product?.name ?? ""}`
    );
  }
  console.log(`\nTotal: ${rows.length} bins in STR Zone PR`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
