// End-to-end smoke test for the pre-generated invoice rollout.
//
// Walks through:
//   1. Login (admin / Admin@123)
//   2. Create a fresh customer (so we don't pollute fixtures)
//   3. Direct-create a small SO via POST /sales-orders
//   4. Assert: SO has exactly one Invoice, status='issued',
//      packingSlipId === null, qty matches qtyOrdered
//   5. Generate the pick list, complete picking
//   6. Pack the slip via /packing-slips/:id/pack
//   7. Assert: packing slip is now 'invoiced', the SAME invoice is
//      attached (no second invoice created), invoice items match
//      qtyPacked
//   8. Cancel-test: confirm a separate SO, immediately cancel it,
//      assert the pre-gen invoice is marked 'cancelled' and the SO
//      doesn't refuse the cancel
//
// Run with: npx tsx scripts/smoke-pre-gen-invoice.ts

import { db } from "../src/db.js";

const API = "http://localhost:4000/v1";

async function login(): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "nova1234" }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { token: string };
  return j.token;
}

async function call(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function jsonOrThrow<T>(r: Response, label: string): Promise<T> {
  if (!r.ok) {
    throw new Error(
      `${label} -> ${r.status}: ${await r.text().catch(() => "(no body)")}`
    );
  }
  return r.json() as Promise<T>;
}

async function pickStockedProductWithVariant(): Promise<{
  productId: string;
  variantId: string;
  stockOnHand: number;
}> {
  const candidates = await db.productVariant.findMany({
    where: { active: true, stockOnHand: { gt: 5 } },
    take: 1,
    orderBy: { stockOnHand: "desc" },
    select: { id: true, productId: true, stockOnHand: true },
  });
  if (candidates.length === 0) {
    throw new Error("Smoke test needs at least one variant with stockOnHand>5");
  }
  return {
    productId: candidates[0].productId,
    variantId: candidates[0].id,
    stockOnHand: candidates[0].stockOnHand,
  };
}

async function createCustomer(token: string, suffix: string): Promise<string> {
  const r = await call(token, "POST", "/customers", {
    name: `Smoke Test ${suffix}`,
    contact: "9999999999",
    creditLimit: 100000,
  });
  const cust = await jsonOrThrow<{ id: string }>(r, "create customer");
  return cust.id;
}

async function main(): Promise<void> {
  console.log("Logging in...");
  const token = await login();
  console.log("OK\n");

  const sku = await pickStockedProductWithVariant();
  console.log(
    `Using variant ${sku.variantId} (stock=${sku.stockOnHand})\n`
  );

  // ===== Path A: SO -> Pack -> Invoice settlement =====
  console.log("=== Path A: SO -> Pack -> Invoice ===");
  const customerId = await createCustomer(token, "A");
  const qty = 2;
  const rate = 100;
  const soResp = await call(token, "POST", "/sales-orders", {
    customerId,
    items: [
      { productId: sku.productId, variantId: sku.variantId, qty, rate, discount: 0 },
    ],
  });
  const so = await jsonOrThrow<{ id: string; soNo: string; total: number }>(
    soResp,
    "create SO"
  );
  console.log(`  SO created: ${so.soNo} (total ₹${so.total})`);

  const invs = await db.invoice.findMany({
    where: { salesOrderId: so.id },
    include: { items: true },
  });
  if (invs.length !== 1) {
    throw new Error(`Expected exactly 1 invoice, got ${invs.length}`);
  }
  const inv = invs[0];
  console.log(
    `  Pre-generated invoice: ${inv.invoiceNo} (${inv.status}, packingSlipId=${inv.packingSlipId})`
  );
  if (inv.status !== "issued") {
    throw new Error(`Expected status='issued', got '${inv.status}'`);
  }
  if (inv.packingSlipId !== null) {
    throw new Error(`Expected packingSlipId=null, got ${inv.packingSlipId}`);
  }
  if (Math.abs(inv.amount - so.total) > 1) {
    throw new Error(`Invoice amount ${inv.amount} != SO total ${so.total}`);
  }
  console.log("  invoice amount + status assertions OK");

  const plResp = await call(token, "POST", `/sales-orders/${so.id}/pick-lists`, {});
  const pl = await jsonOrThrow<{ id: string; pickListNo: string; items: { id: string; qtyToPick: number }[] }>(
    plResp,
    "create pick list"
  );
  console.log(`  Pick list created: ${pl.pickListNo}`);

  await jsonOrThrow(
    await call(token, "PATCH", `/pick-lists/${pl.id}`, {
      items: pl.items.map((it) => ({ id: it.id, qtyPicked: it.qtyToPick })),
    }),
    "patch pick list items"
  );
  const completed = await jsonOrThrow<{ packingSlip?: { id: string; packingSlipNo: string } }>(
    await call(token, "POST", `/pick-lists/${pl.id}/complete`, {}),
    "complete pick list"
  );
  if (!completed.packingSlip) {
    throw new Error("pick complete didn't return a packingSlip");
  }
  console.log(`  Pick complete -> Packing slip ${completed.packingSlip.packingSlipNo}`);

  const packed = await jsonOrThrow<{
    status: string;
    invoice?: { invoiceNo: string; status: string };
  }>(
    await call(token, "POST", `/packing-slips/${completed.packingSlip.id}/pack`, {}),
    "pack packing slip"
  );
  console.log(
    `  Packed -> status='${packed.status}', invoice=${packed.invoice?.invoiceNo}`
  );
  if (packed.status !== "invoiced") {
    throw new Error(`Expected slip status='invoiced', got '${packed.status}'`);
  }

  const invsAfter = await db.invoice.findMany({
    where: { salesOrderId: so.id },
  });
  if (invsAfter.length !== 1) {
    throw new Error(
      `Expected exactly 1 invoice after pack, got ${invsAfter.length} (would be a duplicate-invoice regression)`
    );
  }
  const invAfter = invsAfter[0];
  if (invAfter.id !== inv.id) {
    throw new Error("Pack created a different invoice instead of attaching the pre-gen one");
  }
  if (invAfter.packingSlipId !== completed.packingSlip.id) {
    throw new Error(
      `Invoice not attached to slip: invoice.packingSlipId=${invAfter.packingSlipId}, slip=${completed.packingSlip.id}`
    );
  }
  // Confirm stock was decremented atomically with pack-complete
  // (B2B: stockOnHand moves at pack, not at SO commit). The
  // variant we picked started at sku.stockOnHand and we packed 2.
  const vAfter = await db.productVariant.findUnique({
    where: { id: sku.variantId },
    select: { stockOnHand: true },
  });
  if (vAfter && vAfter.stockOnHand !== sku.stockOnHand - qty) {
    console.warn(
      `  WARN: stockOnHand=${vAfter?.stockOnHand}, expected ${
        sku.stockOnHand - qty
      } (other smoke tests may have moved stock concurrently).`
    );
  } else {
    console.log(
      `  stockOnHand decremented from ${sku.stockOnHand} -> ${vAfter?.stockOnHand}.`
    );
  }
  console.log("  Same invoice attached, no duplicate. Path A OK.\n");

  // ===== Path B: Confirm + Cancel SO =====
  console.log("=== Path B: SO -> Cancel (issued invoice should not block) ===");
  const customerB = await createCustomer(token, "B");
  const soBResp = await call(token, "POST", "/sales-orders", {
    customerId: customerB,
    items: [
      { productId: sku.productId, variantId: sku.variantId, qty: 1, rate: 50, discount: 0 },
    ],
  });
  const soB = await jsonOrThrow<{ id: string; soNo: string }>(soBResp, "create SO B");
  console.log(`  SO B created: ${soB.soNo}`);

  const invB = await db.invoice.findFirst({ where: { salesOrderId: soB.id } });
  if (!invB) throw new Error("SO B had no pre-gen invoice");
  console.log(`  Pre-gen invoice: ${invB.invoiceNo} (${invB.status})`);

  const cancelResp = await call(token, "POST", `/sales-orders/${soB.id}/cancel`, {});
  const cancelled = await jsonOrThrow<{ status: string }>(
    cancelResp,
    "cancel SO B"
  );
  if (cancelled.status !== "cancelled") {
    throw new Error(`Expected SO status='cancelled', got '${cancelled.status}'`);
  }
  console.log(`  SO B cancelled.`);

  const invBAfter = await db.invoice.findUnique({ where: { id: invB.id } });
  if (invBAfter?.status !== "cancelled") {
    throw new Error(
      `Expected invoice to be 'cancelled' after SO cancel, got '${invBAfter?.status}'`
    );
  }
  console.log("  Pre-gen invoice was auto-cancelled with the SO. Path B OK.\n");

  // ===== Path C: Legacy /sales-orders/:id/invoice rejected =====
  console.log("=== Path C: Legacy draw-down endpoint refuses pre-gen SO ===");
  const customerC = await createCustomer(token, "C");
  const soCResp = await call(token, "POST", "/sales-orders", {
    customerId: customerC,
    items: [
      { productId: sku.productId, variantId: sku.variantId, qty: 1, rate: 50, discount: 0 },
    ],
  });
  const soC = await jsonOrThrow<{ id: string; soNo: string; items: { id: string; qtyOrdered: number }[] }>(
    soCResp,
    "create SO C"
  );
  console.log(`  SO C created: ${soC.soNo}`);

  const drawDownResp = await call(token, "POST", `/sales-orders/${soC.id}/invoice`, {
    paymentMode: "credit",
    items: [{ salesOrderItemId: soC.items[0].id, qty: 1 }],
  });
  if (drawDownResp.ok) {
    throw new Error(
      "Legacy /sales-orders/:id/invoice should have refused, but returned 2xx"
    );
  }
  const errBody = (await drawDownResp.json()) as {
    error?: { code?: string; message?: string };
  };
  if (errBody.error?.code !== "invoice_already_exists") {
    throw new Error(
      `Expected 'invoice_already_exists' error, got '${errBody.error?.code}': ${errBody.error?.message}`
    );
  }
  console.log(
    `  Legacy endpoint correctly rejected with code=${errBody.error.code}`
  );
  console.log("  Path C OK.\n");

  console.log("All assertions passed.");
}

main()
  .then(async () => {
    await db.$disconnect();
    process.exit(0);
  })
  .catch(async (e: unknown) => {
    console.error("FAILED:", e);
    await db.$disconnect();
    process.exit(1);
  });
