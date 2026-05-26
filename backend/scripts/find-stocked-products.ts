import { db } from "../src/db.js";

const ps = await db.product.findMany({
  where: { stockOnHand: { gt: 0 } },
  select: {
    id: true,
    sku: true,
    name: true,
    stockOnHand: true,
    _count: { select: { variants: true } },
  },
  orderBy: { stockOnHand: "desc" },
  take: 20,
});
console.log("Products with stockOnHand > 0:", ps.length);
console.table(ps);
await db.$disconnect();
