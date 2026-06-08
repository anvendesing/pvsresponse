// One-shot backfill: sweep customer advance payments against any
// 'issued' / 'partial' / 'overdue' invoices that should already have
// been auto-allocated. Use after deploying the applyAdvancesToInvoice
// hook to clean up historical data where a payment was recorded
// before its corresponding invoice was minted.

import { db } from "../src/db.js";
import { applyAdvancesToInvoice } from "../src/routes/customer-payments.js";

const main = async () => {
  const invoices = await db.invoice.findMany({
    where: { status: { in: ["issued", "partial", "overdue"] } },
    select: { id: true, invoiceNo: true, customerId: true, status: true, amount: true },
    orderBy: { date: "asc" },
  });
  console.log(`Scanning ${invoices.length} open invoices for unallocated advances…\n`);

  let totalSwept = 0;
  let touched = 0;
  for (const inv of invoices) {
    const result = await applyAdvancesToInvoice(db, inv.id);
    if (result.allocatedNow > 0 || result.newStatus !== inv.status) {
      touched++;
      totalSwept += result.allocatedNow;
      console.log(
        `  ${inv.invoiceNo}  ${inv.status} → ${result.newStatus}  applied ₹${result.allocatedNow.toLocaleString(
          "en-IN"
        )}  remainder ₹${result.remainder.toLocaleString("en-IN")}`
      );
    }
  }
  console.log(
    `\nDone. ${touched} invoice(s) updated. Total advances applied: ₹${totalSwept.toLocaleString("en-IN")}.`
  );

  await db.$disconnect();
};

void main();
