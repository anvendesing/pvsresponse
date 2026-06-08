// One-shot fix for the PWA showing every pick / pack line as already
// confirmed before any scan was performed. Resets qtyPicked → 0
// (pick lists) and qtyPacked → 0 (open packing slips) where the rows
// look like the legacy auto-seed default and not real work-in-progress.
//
// Heuristic: a list is "stale defaults" iff every item has its
// confirmation field equal to qtyToPick / qtyPicked AND > 0 — i.e. the
// signature of "server seeded these as full and the operator hasn't
// touched them". Lists with even one mixed value are left alone.
//
// Usage:
//   npx tsx scripts/reset-stale-pick-list-defaults.ts          (dry run)
//   npx tsx scripts/reset-stale-pick-list-defaults.ts --apply

import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

const main = async () => {
  // -------- Pick lists --------------------------------------------------
  const lists = await db.pickList.findMany({
    where: { status: { in: ["draft", "picking"] } },
    include: { items: { select: { id: true, qtyPicked: true, qtyToPick: true } } },
    orderBy: { createdAt: "asc" },
  });
  const stalePickLists = lists.filter((pl) =>
    pl.items.length > 0 &&
    pl.items.every((it) => it.qtyPicked === it.qtyToPick && it.qtyPicked > 0)
  );
  console.log(
    `Pick lists: ${lists.length} open; ${stalePickLists.length} look like untouched legacy defaults.`
  );

  // -------- Packing slips ----------------------------------------------
  const slips = await db.packingSlip.findMany({
    where: { status: "open" },
    include: { items: { select: { id: true, qtyPicked: true, qtyPacked: true, rate: true } } },
    orderBy: { createdAt: "asc" },
  });
  const staleSlips = slips.filter((ps) =>
    ps.items.length > 0 &&
    ps.items.every((it) => it.qtyPacked === it.qtyPicked && it.qtyPacked > 0)
  );
  console.log(
    `Packing slips: ${slips.length} open; ${staleSlips.length} look like untouched legacy defaults.`
  );

  if (!apply) {
    console.log("\nPass --apply to reset.");
    for (const pl of stalePickLists) {
      console.log(`  • ${pl.pickListNo}: ${pl.items.length} pick item(s) would reset`);
    }
    for (const ps of staleSlips) {
      console.log(`  • ${ps.packingSlipNo}: ${ps.items.length} pack item(s) would reset`);
    }
    await db.$disconnect();
    return;
  }

  let pickTouched = 0;
  for (const pl of stalePickLists) {
    const ids = pl.items.map((i) => i.id);
    await db.pickListItem.updateMany({
      where: { id: { in: ids } },
      data: { qtyPicked: 0 },
    });
    pickTouched += ids.length;
    console.log(`  • ${pl.pickListNo}: reset ${ids.length} pick item(s)`);
  }

  let packTouched = 0;
  for (const ps of staleSlips) {
    for (const it of ps.items) {
      await db.packingSlipItem.update({
        where: { id: it.id },
        data: { qtyPacked: 0, amount: 0 },
      });
    }
    packTouched += ps.items.length;
    console.log(`  • ${ps.packingSlipNo}: reset ${ps.items.length} pack item(s)`);
  }

  console.log(
    `\nDone. Reset ${pickTouched} pick-list item(s) and ${packTouched} pack-slip item(s).`
  );
  await db.$disconnect();
};

void main();
