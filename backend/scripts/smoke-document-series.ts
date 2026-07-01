import { db } from "../src/db.js";
import { ensureDocumentSeriesSeeded, allocateInvoiceNumber } from "../src/lib/document-series.js";

await ensureDocumentSeriesSeeded();
const series = await db.documentSeries.findMany();
console.log(
  "Series:",
  series.map((s) => ({
    code: s.code,
    next: s.nextNumber,
    channel: s.channelSource,
    default: s.isDefault,
  }))
);

const cust = await db.customer.findFirst({ select: { id: true } });
if (!cust) {
  console.log("No customer found");
  process.exit(0);
}

const internal = await db.$transaction((tx) =>
  allocateInvoiceNumber(tx, { customerId: cust.id, source: "internal" })
);
console.log("Allocated internal:", internal);

const imported = await db.$transaction((tx) =>
  allocateInvoiceNumber(tx, { customerId: cust.id, source: "imported" })
);
console.log("Allocated imported:", imported);

await db.$disconnect();
