// One-shot data fix: any PackingSlip whose status is 'packed' but
// whose Invoice relation is already populated should be reclassified
// as 'invoiced'. This is the legacy state from before pack-complete
// learned to flip the slip straight to 'invoiced' for ecommerce
// orders. Without this fix the desktop UI keeps showing "Generate
// invoice" on those slips and pressing it 500s on the unique
// Invoice.packingSlipId constraint.
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const slips = await db.packingSlip.findMany({
    where: { status: "packed" },
    include: { invoice: { select: { id: true, invoiceNo: true, status: true } } },
  });
  const targets = slips.filter((s) => s.invoice);
  console.log("eligible:", targets.length);
  for (const s of targets) {
    await db.packingSlip.update({
      where: { id: s.id },
      data: { status: "invoiced", invoicedAt: s.invoicedAt ?? new Date() },
    });
    console.log(
      "  ",
      s.packingSlipNo,
      "-> invoiced (inv=" + s.invoice.invoiceNo + " " + s.invoice.status + ")"
    );
  }
  await db.$disconnect();
})();
