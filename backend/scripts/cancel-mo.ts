#!/usr/bin/env tsx
/**
 * Cancel production order(s) and unwind side-effects.
 *
 *   npx tsx scripts/cancel-mo.ts MO-2026-2202          # dry run one
 *   npx tsx scripts/cancel-mo.ts MO-2026-2202 --apply   # cancel one
 *   npx tsx scripts/cancel-mo.ts --all                  # dry run all open
 *   npx tsx scripts/cancel-mo.ts --all --apply            # cancel all open
 */
import { db } from "../src/db.js";
import {
  cancelAllOpenProductionOrders,
  cancelProductionOrder,
  MoCancelError,
} from "../src/lib/mo-cancel.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const orderNo = args.find((a) => !a.startsWith("--"));

async function previewOne(id: string) {
  const po = await db.productionOrder.findUnique({
    where: { id },
    select: {
      orderNo: true,
      status: true,
      plannedQty: true,
      actualQty: true,
      transferOrders: { select: { transferNo: true, status: true } },
    },
  });
  if (!po) return null;
  const issues = await db.stockLedger.count({
    where: { ref: po.orderNo, txnType: "Issue", qty: { lt: 0 } },
  });
  console.log(
    `  ${po.orderNo} · ${po.status} · planned ${po.plannedQty} · actual ${po.actualQty} · ${po.transferOrders.length} TO(s) · ${issues} issue row(s)`
  );
  return po;
}

async function main() {
  if (all) {
    const open = await db.productionOrder.findMany({
      where: { status: { notIn: ["completed", "cancelled"] } },
      select: { id: true, orderNo: true },
      orderBy: { orderNo: "asc" },
    });
    if (open.length === 0) {
      console.log("No open MOs to cancel.");
      return;
    }
    console.log(`${open.length} open MO(s):`);
    for (const row of open) {
      await previewOne(row.id);
    }
    if (!apply) {
      console.log("\nDRY RUN — re-run with --all --apply to cancel.");
      return;
    }
    const results = await cancelAllOpenProductionOrders();
    console.log(`\nCancelled ${results.length} MO(s).`);
    for (const r of results) {
      console.log(
        `  ✓ ${r.orderNo} · ${r.transfersCancelled} TO(s) · ${r.issuesReversed} issue reversal(s)`
      );
    }
    return;
  }

  if (!orderNo) {
    console.error(
      "Usage: npx tsx scripts/cancel-mo.ts <orderNo> [--apply]\n       npx tsx scripts/cancel-mo.ts --all [--apply]"
    );
    process.exit(1);
  }

  const po = await db.productionOrder.findUnique({
    where: { orderNo },
    select: { id: true },
  });
  if (!po) {
    console.error(`MO ${orderNo} not found.`);
    process.exit(1);
  }

  console.log(`MO ${orderNo}:`);
  await previewOne(po.id);

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to cancel.");
    return;
  }

  try {
    const result = await cancelProductionOrder(po.id);
    console.log(
      `\n✓ Cancelled ${result.orderNo} · ${result.transfersCancelled} TO(s) · ${result.issuesReversed} issue reversal(s)`
    );
  } catch (e) {
    if (e instanceof MoCancelError) {
      console.error(`\n${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
