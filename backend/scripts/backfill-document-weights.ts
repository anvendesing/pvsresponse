// Backfill Quote.totalWeightKg / SalesOrder.totalWeightKg /
// Invoice.totalWeightKg for every existing row.
//
// Run once after the schema migration that added the columns. The
// runtime mutation paths will keep these in sync from then on. Safe
// to re-run; each helper is a pure recompute + UPDATE.
//
// Usage:
//   npm run db:backfill-document-weights

import { PrismaClient } from "@prisma/client";
import {
  recomputeInvoiceWeight,
  recomputeQuoteWeight,
  recomputeSalesOrderWeight,
} from "../src/lib/document-weight.js";

const db = new PrismaClient();

const main = async () => {
  console.log("Backfilling Quote.totalWeightKg…");
  const quotes = await db.quote.findMany({ select: { id: true, quoteNo: true } });
  for (const q of quotes) {
    const kg = await recomputeQuoteWeight(db, q.id);
    if (kg > 0) console.log(`  ${q.quoteNo}: ${kg} kg`);
  }
  console.log(`  done (${quotes.length} quotes)`);

  console.log("\nBackfilling SalesOrder.totalWeightKg…");
  const sos = await db.salesOrder.findMany({ select: { id: true, soNo: true } });
  for (const s of sos) {
    const kg = await recomputeSalesOrderWeight(db, s.id);
    if (kg > 0) console.log(`  ${s.soNo}: ${kg} kg`);
  }
  console.log(`  done (${sos.length} sales orders)`);

  console.log("\nBackfilling Invoice.totalWeightKg…");
  // Prefer packing slip kg when the invoice is linked to one so
  // historical invoices match what the slip recorded (incl. actual
  // scale readings). Direct invoices fall through to item-sum.
  const invs = await db.invoice.findMany({
    select: { id: true, invoiceNo: true, packingSlipId: true },
  });
  for (const inv of invs) {
    const kg = await recomputeInvoiceWeight(db, inv.id, {
      preferPackingSlipKg: !!inv.packingSlipId,
    });
    if (kg > 0) console.log(`  ${inv.invoiceNo}: ${kg} kg`);
  }
  console.log(`  done (${invs.length} invoices)`);

  await db.$disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
