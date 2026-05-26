// Wipe all transactional + master data while keeping users + warehouses.
// Use this before entering your real factory data.
//
//    npm run db:wipe
//
// To restart from scratch (including users + warehouses), use:
//    npm run prisma:reset

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("Wiping data (keeping users + warehouses)...");
  await db.changeLog.deleteMany();
  await db.tombstone.deleteMany();
  await db.syncState.deleteMany();
  await db.syncConflict.deleteMany();
  await db.auditLog.deleteMany();
  await db.approval.deleteMany();
  await db.dispatchOrder.deleteMany();
  await db.invoiceItem.deleteMany();
  await db.invoice.deleteMany();
  await db.attendance.deleteMany();
  await db.worker.deleteMany();
  await db.workOrder.deleteMany();
  await db.productionOrder.deleteMany();
  await db.bomItem.deleteMany();
  await db.bom.deleteMany();
  await db.grn.deleteMany();
  await db.purchaseOrderItem.deleteMany();
  await db.purchaseOrder.deleteMany();
  await db.stockLedger.deleteMany();
  await db.bin.deleteMany();
  await db.product.deleteMany();
  await db.vendor.deleteMany();
  await db.customer.deleteMany();
  console.log("Done. Users + warehouses preserved. Use Prisma Studio (npm run studio) to add real data.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
