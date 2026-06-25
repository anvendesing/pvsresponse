#!/usr/bin/env tsx
import { db } from "../src/db.js";

const warehouses = await db.warehouse.findMany({
  orderBy: { code: "asc" },
  include: { _count: { select: { bins: true } } },
});

console.log("code\tactive\tbins\tstocked\tqty1234\ttotalQty");
for (const wh of warehouses) {
  const stocked = await db.bin.count({
    where: {
      warehouseId: wh.id,
      OR: [{ qty: { gt: 0 } }, { productId: { not: null } }],
    },
  });
  const qty1234 = await db.bin.count({ where: { warehouseId: wh.id, qty: 1234 } });
  const totalQty =
    (await db.bin.aggregate({ where: { warehouseId: wh.id }, _sum: { qty: true } }))._sum.qty ?? 0;

  const match627628 =
    (wh._count.bins >= 620 && wh._count.bins <= 660) ||
    (stocked >= 620 && stocked <= 660) ||
    qty1234 >= 500;

  if (match627628 || wh._count.bins >= 600) {
    console.log(
      [wh.code, wh.active ? "Y" : "N", wh._count.bins, stocked, qty1234, totalQty].join("\t")
    );
  }
}

await db.$disconnect();
