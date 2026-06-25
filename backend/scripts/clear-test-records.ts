#!/usr/bin/env tsx
/**
 * Remove throwaway test / smoke data:
 *   • Products with SKU prefix MFGTST- (manufacturing smoke tests)
 *   • Stock ledger rows from reset-test-environment (ref TEST-OPEN-*)
 *   • Customers named "Test User*" and their quotes / SOs / invoices
 *
 *   npx tsx scripts/clear-test-records.ts          # dry run
 *   npx tsx scripts/clear-test-records.ts --apply  # delete
 */
import { db } from "../src/db.js";

const apply = process.argv.includes("--apply");

async function deleteBom(bomId: string) {
  const moCount = await db.productionOrder.count({ where: { bomId } });
  if (moCount > 0) {
    await db.workOrder.deleteMany({ where: { productionOrder: { bomId } } });
    await db.productionOrder.deleteMany({ where: { bomId } });
  }
  await db.stockRule.deleteMany({ where: { bomId } });
  await db.bomOperationLine.deleteMany({ where: { bomOperation: { bomId } } });
  await db.bomOperation.deleteMany({ where: { bomId } });
  await db.bomItem.deleteMany({ where: { bomId } });
  await db.bomByproduct.deleteMany({ where: { bomId } });
  await db.bom.delete({ where: { id: bomId } });
}

async function forceDeleteTestProduct(productId: string, sku: string) {
  const boms = await db.bom.findMany({ where: { productId }, select: { id: true } });

  if (!apply) {
    const ledger = await db.stockLedger.count({ where: { productId } });
    console.log(`  [dry] product ${sku}: ${boms.length} BOM(s), ${ledger} ledger row(s)`);
    return;
  }

  for (const bom of boms) await deleteBom(bom.id);
  await db.putawayRule.deleteMany({ where: { productId } });
  await db.stockRule.deleteMany({ where: { productId } });
  await db.stockLot.deleteMany({ where: { productId } });
  await db.stockLedger.deleteMany({ where: { productId } });
  await db.bin.updateMany({
    where: { productId },
    data: { productId: null, variantId: null, qty: 0, reservedQty: 0, occupied: 0 },
  });
  await db.product.delete({ where: { id: productId } });
  console.log(`  ✓ deleted product ${sku}`);
}

async function clearTestCustomers() {
  const customers = await db.customer.findMany({
    where: { name: { startsWith: "Test User" } },
    select: { id: true, code: true, name: true },
  });

  if (customers.length === 0) {
    console.log("No test customers.");
    return 0;
  }

  if (!apply) {
    for (const c of customers) {
      const [quotes, sos, inv] = await Promise.all([
        db.quote.count({ where: { customerId: c.id } }),
        db.salesOrder.count({ where: { customerId: c.id } }),
        db.invoice.count({ where: { customerId: c.id } }),
      ]);
      console.log(
        `  [dry] customer ${c.code} ${c.name}: ${quotes} quote(s), ${sos} SO(s), ${inv} invoice(s)`
      );
    }
    return customers.length;
  }

  for (const c of customers) {
    const quoteIds = (
      await db.quote.findMany({ where: { customerId: c.id }, select: { id: true } })
    ).map((q) => q.id);
    const soIds = (
      await db.salesOrder.findMany({ where: { customerId: c.id }, select: { id: true } })
    ).map((s) => s.id);
    const invoiceIds = (
      await db.invoice.findMany({ where: { customerId: c.id }, select: { id: true } })
    ).map((i) => i.id);

    if (quoteIds.length > 0) {
      await db.quoteRevision.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await db.quoteItem.deleteMany({ where: { quoteId: { in: quoteIds } } });
      await db.quote.deleteMany({ where: { id: { in: quoteIds } } });
    }

    if (soIds.length > 0) {
      await db.pickListItem.deleteMany({ where: { pickList: { salesOrderId: { in: soIds } } } });
      await db.pickList.deleteMany({ where: { salesOrderId: { in: soIds } } });
      await db.packingSlipItem.deleteMany({
        where: { packingSlip: { salesOrderId: { in: soIds } } },
      });
      await db.packingSlip.deleteMany({ where: { salesOrderId: { in: soIds } } });
      await db.salesOrderItem.deleteMany({ where: { salesOrderId: { in: soIds } } });
      await db.salesOrder.deleteMany({ where: { id: { in: soIds } } });
    }

    if (invoiceIds.length > 0) {
      await db.dispatchOrder.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await db.customerPaymentAllocation.deleteMany({
        where: { invoiceId: { in: invoiceIds } },
      });
      await db.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await db.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }

    const returnIds = (
      await db.customerReturn.findMany({ where: { customerId: c.id }, select: { id: true } })
    ).map((r) => r.id);
    if (returnIds.length > 0) {
      const creditNotes = await db.creditNote.findMany({
        where: { customerReturnId: { in: returnIds } },
        select: { id: true, customerPaymentId: true },
      });
      const cnIds = creditNotes.map((n) => n.id);
      const paymentIds = creditNotes
        .map((n) => n.customerPaymentId)
        .filter((id): id is string => Boolean(id));
      if (cnIds.length > 0) {
        await db.creditNoteItem.deleteMany({ where: { creditNoteId: { in: cnIds } } });
        await db.creditNote.deleteMany({ where: { id: { in: cnIds } } });
      }
      if (paymentIds.length > 0) {
        await db.customerPaymentAllocation.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
        await db.customerPayment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      await db.customerReturnItem.deleteMany({ where: { customerReturnId: { in: returnIds } } });
      await db.customerReturn.deleteMany({ where: { id: { in: returnIds } } });
    }

    await db.customerAccount.deleteMany({ where: { customerId: c.id } });

    const paymentIds = (
      await db.customerPayment.findMany({ where: { customerId: c.id }, select: { id: true } })
    ).map((p) => p.id);
    if (paymentIds.length > 0) {
      await db.customerPaymentAllocation.deleteMany({
        where: { paymentId: { in: paymentIds } },
      });
      await db.customerPayment.deleteMany({ where: { id: { in: paymentIds } } });
    }

    await db.enquiryItem.deleteMany({
      where: { enquiry: { customerId: c.id } },
    });
    await db.enquiryActivity.deleteMany({
      where: { enquiry: { customerId: c.id } },
    });
    await db.enquiry.deleteMany({ where: { customerId: c.id } });

    await db.customer.delete({ where: { id: c.id } });
    console.log(`  ✓ deleted customer ${c.code} ${c.name}`);
  }

  return customers.length;
}

async function main() {
  console.log(apply ? "Clearing test records…\n" : "DRY RUN — test records\n");

  const testProducts = await db.product.findMany({
    where: { sku: { startsWith: "MFGTST-" } },
    select: { id: true, sku: true },
    orderBy: { sku: "asc" },
  });

  console.log(`MFGTST products: ${testProducts.length}`);
  for (const p of testProducts) {
    await forceDeleteTestProduct(p.id, p.sku);
  }

  const testLedgerCount = await db.stockLedger.count({
    where: { ref: { startsWith: "TEST-OPEN-" } },
  });
  console.log(`\nTEST-OPEN ledger rows: ${testLedgerCount}`);
  if (apply && testLedgerCount > 0) {
    const removed = await db.stockLedger.deleteMany({
      where: { ref: { startsWith: "TEST-OPEN-" } },
    });
    console.log(`  ✓ deleted ${removed.count} ledger row(s)`);
  } else if (!apply && testLedgerCount > 0) {
    console.log(`  [dry] would delete ${testLedgerCount} ledger row(s)`);
  }

  const demoLedgerCount = await db.stockLedger.count({
    where: { ref: { startsWith: "DEMO-" } },
  });
  if (demoLedgerCount > 0) {
    console.log(`\nDEMO ledger rows: ${demoLedgerCount}`);
    if (apply) {
      const removed = await db.stockLedger.deleteMany({
        where: { ref: { startsWith: "DEMO-" } },
      });
      console.log(`  ✓ deleted ${removed.count} ledger row(s)`);
    } else {
      console.log(`  [dry] would delete ${demoLedgerCount} ledger row(s)`);
    }
  }

  console.log("\nTest customers:");
  const custCount = await clearTestCustomers();

  console.log(
    `\nDone.${
      apply
        ? ""
        : " Re-run with --apply to delete."
    } products=${testProducts.length} customers=${custCount}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
