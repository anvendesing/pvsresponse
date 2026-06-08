/**
 * One-shot backfill: ecommerce prepaid invoices were marked status='paid'
 * at checkout but no CustomerPayment row was written, so AR statements
 * showed a debit with no matching credit. Creates payment + allocation
 * for each affected invoice.
 *
 *   docker compose exec backend node dist/scripts/backfill-ecommerce-payments.js
 */

import { db } from "../db.js";
import { nextPaymentNo } from "../routes/customer-payments.js";

const main = async () => {
  const invoices = await db.invoice.findMany({
    where: {
      status: "paid",
      salesOrder: { source: "ecommerce" },
    },
    include: {
      salesOrder: { select: { soNo: true } },
      paymentAllocations: { select: { amount: true } },
    },
    orderBy: { date: "asc" },
  });

  const missing = invoices.filter(
    (inv) => inv.paymentAllocations.reduce((s, a) => s + a.amount, 0) < inv.amount - 0.005
  );

  console.log(
    `Found ${missing.length} paid ecommerce invoice(s) without full payment allocation.\n`
  );

  for (const inv of missing) {
    const allocated = inv.paymentAllocations.reduce((s, a) => s + a.amount, 0);
    const gap = Math.max(0, inv.amount - allocated);
    if (gap < 0.005) continue;

    const paymentNo = await nextPaymentNo();
    const payment = await db.customerPayment.create({
      data: {
        paymentNo,
        customerId: inv.customerId,
        amount: gap,
        mode: "upi",
        reference: inv.invoiceNo,
        notes: `Backfill storefront prepaid · ${inv.salesOrder?.soNo ?? "ecommerce"}`,
        paymentDate: inv.date,
        allocations: {
          create: [{ invoiceId: inv.id, amount: gap }],
        },
      },
    });
    console.log(
      `  ${inv.invoiceNo}  +${payment.paymentNo}  ₹${gap.toLocaleString("en-IN")}`
    );
  }

  console.log("\nDone.");
  await db.$disconnect();
};

void main();
