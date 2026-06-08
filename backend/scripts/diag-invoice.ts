import { db } from "../src/db.js";

const main = async () => {
  const inv = await db.invoice.findFirst({
    where: { invoiceNo: "INV-2026-5501" },
    include: {
      customer: { select: { code: true, name: true } },
      paymentAllocations: {
        include: {
          payment: { select: { paymentNo: true, amount: true, mode: true, paymentDate: true } },
        },
      },
      salesOrder: { select: { soNo: true, status: true } },
    },
  });
  if (!inv) {
    console.log("INV-2026-5501 not found");
    await db.$disconnect();
    return;
  }
  console.log(`Invoice ${inv.invoiceNo}`);
  console.log(`  customer    : ${inv.customer.code} ${inv.customer.name}`);
  console.log(`  status      : ${inv.status}`);
  console.log(`  amount      : ₹${inv.amount.toLocaleString("en-IN")}`);
  console.log(`  date        : ${inv.date.toISOString()}`);
  console.log(`  paymentMode : ${inv.paymentMode}`);
  console.log(`  salesOrder  : ${inv.salesOrder?.soNo ?? "—"} (${inv.salesOrder?.status ?? "n/a"})`);

  const totalAllocated = inv.paymentAllocations.reduce((s, a) => s + a.amount, 0);
  console.log(`\n  ${inv.paymentAllocations.length} allocation(s) totalling ₹${totalAllocated.toLocaleString("en-IN")}:`);
  for (const a of inv.paymentAllocations) {
    console.log(
      `    • ${a.payment.paymentNo}  alloc=₹${a.amount.toLocaleString("en-IN")}  paymentTotal=₹${a.payment.amount.toLocaleString("en-IN")}  mode=${a.payment.mode}  date=${a.payment.paymentDate.toISOString()}`
    );
  }
  const remainder = inv.amount - totalAllocated;
  console.log(`\n  remainder   : ₹${remainder.toLocaleString("en-IN")}`);
  const expectedStatus =
    remainder <= 0.005 ? "paid" : totalAllocated > 0 ? "partial" : "issued";
  console.log(`  expected status (per allocation rules) : ${expectedStatus}`);
  console.log(
    `  actual status                            : ${inv.status}  ${expectedStatus === inv.status ? "OK" : "MISMATCH"}`
  );

  await db.$disconnect();
};

void main();
