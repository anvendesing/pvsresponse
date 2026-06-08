import { db } from "../src/db.js";

const main = async () => {
  const cust = await db.customer.findFirst({
    where: { code: "CUST-0001" },
    select: { id: true, name: true, code: true, creditLimit: true },
  });
  if (!cust) {
    console.log("Customer CUST-0001 not found");
    await db.$disconnect();
    return;
  }
  console.log(`${cust.code} ${cust.name}  creditLimit=₹${(cust.creditLimit ?? 0).toLocaleString("en-IN")}\n`);

  const sos = await db.salesOrder.findMany({
    where: { customerId: cust.id },
    include: {
      items: true,
      invoices: { select: { id: true, invoiceNo: true, status: true, amount: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`${sos.length} sales order(s):\n`);
  let totalOpenSOExposure = 0;
  for (const so of sos) {
    const ordered = so.items.reduce((s, i) => s + i.qtyOrdered, 0);
    const invoiced = so.items.reduce((s, i) => s + i.qtyInvoiced, 0);
    const cancelled = so.items.reduce((s, i) => s + i.qtyCancelled, 0);
    const remaining = ordered - invoiced - cancelled;

    let lineExposure = 0;
    for (const it of so.items) {
      const remQty = Math.max(0, it.qtyOrdered - it.qtyInvoiced - it.qtyCancelled);
      const fraction = it.qtyOrdered > 0 ? remQty / it.qtyOrdered : 0;
      lineExposure += it.amount * fraction;
    }
    const taxFraction = so.subTotal > 0 ? so.tax / so.subTotal : 0;
    const lineExposureWithTax = lineExposure * (1 + taxFraction);

    const counts = ["confirmed", "partially_invoiced", "on_hold"].includes(so.status);
    if (counts) totalOpenSOExposure += lineExposureWithTax;

    console.log(
      `  ${so.soNo}  status=${so.status}  total=₹${so.total.toLocaleString("en-IN")}  ordered=${ordered} invoiced=${invoiced} cancelled=${cancelled} remaining=${remaining}`
    );
    console.log(
      `    → un-invoiced commitment ≈ ₹${lineExposureWithTax.toLocaleString("en-IN")}  ${counts ? "(COUNTS)" : "(ignored)"}`
    );
    if (so.invoices.length) {
      console.log(
        `    invoices: ${so.invoices.map((i) => `${i.invoiceNo}/${i.status}/₹${i.amount.toLocaleString("en-IN")}`).join(", ")}`
      );
    }
  }

  console.log(`\nTotal open SO exposure (un-invoiced) = ₹${totalOpenSOExposure.toLocaleString("en-IN")}`);

  // AR side
  const invoices = await db.invoice.findMany({
    where: { customerId: cust.id, status: { in: ["issued", "partial", "overdue"] } },
  });
  let arRemainder = 0;
  for (const inv of invoices) {
    const alloc = await db.customerPaymentAllocation.aggregate({
      where: { invoiceId: inv.id },
      _sum: { amount: true },
    });
    arRemainder += Math.max(0, inv.amount - (alloc._sum.amount ?? 0));
  }
  const payments = await db.customerPayment.findMany({
    where: { customerId: cust.id },
    include: { allocations: { select: { amount: true } } },
  });
  let unalloc = 0;
  for (const p of payments) {
    const a = p.allocations.reduce((s, x) => s + x.amount, 0);
    unalloc += Math.max(0, p.amount - a);
  }

  const fullExposure = arRemainder + totalOpenSOExposure - unalloc;
  console.log(`Open invoice remainder           = ₹${arRemainder.toLocaleString("en-IN")}`);
  console.log(`Unallocated advances             = ₹${unalloc.toLocaleString("en-IN")}`);
  console.log(`────────────────────────────────────────────`);
  console.log(`Full credit exposure (AR+SO−adv) = ₹${fullExposure.toLocaleString("en-IN")}`);
  console.log(`Customer credit limit            = ₹${(cust.creditLimit ?? 0).toLocaleString("en-IN")}`);
  console.log(
    `Headroom available                = ₹${((cust.creditLimit ?? 0) - fullExposure).toLocaleString("en-IN")}`
  );

  await db.$disconnect();
};

void main();
