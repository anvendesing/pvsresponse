// Diagnose credit-hold approval state — find quotes parked at
// status=accepted with a pending Credit Limit approval, then dump
// each customer's balance picture so we can see why the gate fired.

import { db } from "../src/db.js";
import { customerSignedAR } from "../src/routes/customer-payments.js";

const main = async () => {
  const heldQuotes = await db.quote.findMany({
    where: { status: "accepted", convertedSalesOrderId: null },
    include: {
      customer: { select: { id: true, code: true, name: true, creditLimit: true } },
    },
    orderBy: { acceptedAt: "desc" },
    take: 10,
  });
  if (heldQuotes.length === 0) {
    console.log("No quotes currently parked at status=accepted.");
  } else {
    console.log(`${heldQuotes.length} quote(s) parked at status=accepted:\n`);
  }

  for (const q of heldQuotes) {
    const cust = q.customer;
    console.log(`Quote ${q.quoteNo}  customer=${cust.code} ${cust.name}`);
    console.log(`  total       = ₹${q.total.toLocaleString("en-IN")}`);
    console.log(`  creditLimit = ₹${(cust.creditLimit ?? 0).toLocaleString("en-IN")}`);

    const invoices = await db.invoice.findMany({
      where: { customerId: cust.id },
      orderBy: { date: "asc" },
    });
    let openBalance = 0;
    console.log(`  ${invoices.length} invoice(s):`);
    for (const inv of invoices) {
      const alloc = await db.customerPaymentAllocation.aggregate({
        where: { invoiceId: inv.id },
        _sum: { amount: true },
      });
      const allocated = alloc._sum.amount ?? 0;
      const remainder = Math.max(0, inv.amount - allocated);
      const counts = ["issued", "partial", "overdue"].includes(inv.status)
        ? remainder
        : 0;
      openBalance += counts;
      console.log(
        `    • ${inv.invoiceNo} (${inv.status}) amt=₹${inv.amount.toLocaleString("en-IN")} allocated=₹${allocated.toLocaleString("en-IN")} → ${counts > 0 ? "counts" : "ignored"} ₹${counts.toLocaleString("en-IN")}`
      );
    }
    const payments = await db.customerPayment.findMany({
      where: { customerId: cust.id },
      include: {
        allocations: { select: { amount: true, invoiceId: true } },
      },
      orderBy: { paymentDate: "desc" },
    });
    console.log(`  ${payments.length} payment(s):`);
    let totalPaid = 0;
    let totalAllocated = 0;
    for (const p of payments) {
      const alloc = p.allocations.reduce((s, a) => s + a.amount, 0);
      const unalloc = Math.max(0, p.amount - alloc);
      totalPaid += p.amount;
      totalAllocated += alloc;
      console.log(
        `    • ${p.paymentNo} amt=₹${p.amount.toLocaleString("en-IN")} alloc=₹${alloc.toLocaleString("en-IN")} unalloc=₹${unalloc.toLocaleString("en-IN")} mode=${p.mode}`
      );
    }
    const unallocatedAdvance = Math.max(0, totalPaid - totalAllocated);
    console.log(`  → openBalance         = ₹${openBalance.toLocaleString("en-IN")}`);
    console.log(`  → unallocated advance = ₹${unallocatedAdvance.toLocaleString("en-IN")} (NOT subtracted today!)`);
    console.log(
      `  → effective balance   = ₹${Math.max(0, openBalance - unallocatedAdvance).toLocaleString("en-IN")}`
    );
    const signed = await customerSignedAR(cust.id);
    const projected = signed + q.total;
    const wouldFire = projected > (cust.creditLimit ?? 0);
    console.log(
      `  customerSignedAR = ₹${signed.toLocaleString("en-IN")}  · projected = ₹${projected.toLocaleString("en-IN")}  · limit = ₹${(cust.creditLimit ?? 0).toLocaleString("en-IN")}`
    );
    console.log(
      `  gate now: ${wouldFire ? "BLOCKS (still needs approval)" : "PASSES (advance covers the quote — clicking Retry will materialise the SO)"}\n`
    );
  }
  await db.$disconnect();
};

void main();
