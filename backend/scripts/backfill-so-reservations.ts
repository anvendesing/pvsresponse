// One-shot backfill that reserves stock for every confirmed /
// partially-invoiced sales order that doesn't yet have any
// SalesOrderReservation rows. Idempotent — calling it again is a
// no-op for SOs that already reserved (reserveSalesOrderStock
// release-then-reserves, but if there's nothing to release the net
// is the same).
//
// Usage:
//   npx tsx scripts/backfill-so-reservations.ts          (dry run)
//   npx tsx scripts/backfill-so-reservations.ts --apply  (actually reserve)
//
// Prints a per-SO summary including any shortages so you can spot
// SOs that confirmed against stock that has since been pulled
// elsewhere.

import { db } from "../src/db.js";
import { reserveSalesOrderStock } from "../src/lib/so-reservations.js";

const apply = process.argv.includes("--apply");

const main = async () => {
  const sos = await db.salesOrder.findMany({
    where: { status: { in: ["confirmed", "partially_invoiced"] } },
    select: {
      id: true,
      soNo: true,
      status: true,
      items: { select: { reservations: { select: { id: true } } } },
    },
    orderBy: { orderDate: "asc" },
  });

  const targets = sos.filter(
    (s) => s.items.flatMap((i) => i.reservations).length === 0
  );
  console.log(
    `${sos.length} open SO(s); ${targets.length} have no reservations yet.`
  );
  if (!apply) {
    console.log("Pass --apply to reserve.");
  }

  let totalReserved = 0;
  let totalShort = 0;
  for (const so of targets) {
    if (!apply) {
      console.log(`  • ${so.soNo} (${so.status}) — would reserve`);
      continue;
    }
    try {
      const result = await reserveSalesOrderStock(so.id);
      const reserved = result.reserved.reduce((s, r) => s + r.reserved, 0);
      const short = result.reserved.reduce((s, r) => s + r.short, 0);
      totalReserved += reserved;
      totalShort += short;
      const tag = short > 0 ? `(short ${short})` : "";
      console.log(
        `  • ${so.soNo} (${so.status}): reserved ${reserved} ${tag}`
      );
    } catch (e) {
      console.error(`  ! ${so.soNo} failed: ${(e as Error).message}`);
    }
  }
  if (apply) {
    console.log(
      `\nDone. Reserved ${totalReserved} unit(s) total; ${totalShort} short.`
    );
  }
  await db.$disconnect();
};

void main();
