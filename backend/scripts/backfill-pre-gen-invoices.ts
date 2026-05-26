// Backfill helper: walks every SalesOrder that lacks an Invoice and
// mints one using the same `ensureInvoiceForSalesOrder` helper the
// new SO confirmation paths use.
//
// Why this exists
// ---------------
// The pre-generated-invoice rollout assumes every confirmed SO has
// an invoice attached at SO creation time. SOs that were created
// before the rollout don't have one yet, so the desktop packing
// screen would show the new "invoice info" panel as blank for old
// orders. Running this script fills the gap one-shot and is
// idempotent thereafter.
//
// What it does NOT do
// -------------------
// * Doesn't touch SOs that already have any invoice (issued, paid,
//   or cancelled - we don't want to mint a second invoice for
//   anything that's already been billed in any form).
// * Doesn't touch SOs in 'cancelled' / 'closed' states. They are
//   terminal and minting an invoice now would just be paperwork
//   nobody will look at.
//
// Usage
// -----
//   $ cd backend
//   $ npx tsx scripts/backfill-pre-gen-invoices.ts
//   $ npx tsx scripts/backfill-pre-gen-invoices.ts --dry-run

import { db } from "../src/db.js";
import { ensureInvoiceForSalesOrder } from "../src/services/invoice-create.js";

const dryRun = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  // Fetch SOs that have no invoice yet and are still in a state
  // where invoicing them makes sense. We deliberately include
  // 'partially_invoiced' so old data from the multi-draw-down era
  // can also get a "main" invoice attached - the legacy partial
  // invoices stay around but the SO gets the canonical one.
  const candidates = await db.salesOrder.findMany({
    where: {
      status: { in: ["confirmed", "partially_invoiced", "invoiced"] },
      invoices: { none: {} },
    },
    select: {
      id: true,
      soNo: true,
      status: true,
      total: true,
      source: true,
      customerId: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(
    `Found ${candidates.length} SO(s) without an invoice. Mode: ${
      dryRun ? "DRY RUN" : "WRITE"
    }`
  );

  let created = 0;
  let skipped = 0;
  for (const so of candidates) {
    if (so._count.items === 0) {
      skipped += 1;
      console.log(
        `  - skip ${so.soNo} (${so.status}): SO has zero items, can't invoice.`
      );
      continue;
    }
    if (dryRun) {
      console.log(
        `  + would mint invoice for ${so.soNo} (${so.status}, ₹${so.total}, source=${so.source})`
      );
      continue;
    }
    try {
      const result = await ensureInvoiceForSalesOrder(db, so.id, {
        // Source-specific defaults: ecommerce SOs that somehow
        // ended up here are treated as already paid (they wouldn't
        // be in this script if the storefront-mock atomic path
        // worked, so seeing them here implies a recovery scenario).
        status: so.source === "ecommerce" ? "paid" : "issued",
        paymentMode: so.source === "ecommerce" ? "upi" : "credit",
      });
      if (result.created && result.invoice) {
        created += 1;
        console.log(
          `  + minted ${result.invoice.invoiceNo} for ${so.soNo} (${so.status})`
        );
      } else {
        skipped += 1;
        console.log(
          `  - skip ${so.soNo}: ensureInvoiceForSalesOrder reported existing invoice.`
        );
      }
    } catch (e) {
      skipped += 1;
      console.error(
        `  ! error on ${so.soNo}: ${(e as Error).message}`
      );
    }
  }

  console.log(`\nDone. Minted ${created}, skipped ${skipped}.`);
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    console.error("Fatal:", e);
    await db.$disconnect();
    process.exit(1);
  });
