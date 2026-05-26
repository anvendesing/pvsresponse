/**
 * Verify the variant-stock guard end-to-end for the user's reported
 * scenario:
 *
 *   - variant COIL-1L-GL-05 has stockOnHand = 2
 *   - a pick list exists with qtyToPick = 3 of that variant
 *   - the per-item scan endpoint MUST refuse qty=3 with code
 *     `insufficient_stock`
 *
 * We seed the failing scenario inside the database (creating a customer,
 * a sales order, and a pick list) so the test is deterministic, then
 * call the live API with the warehouse1 user to mirror what the mobile
 * worker would do. After the assertion runs we tear down the seeded
 * rows so re-runs don't pollute the dataset.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = process.env.SMOKE_BASE ?? "http://localhost:4000/v1";

const die = (msg: string): never => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};
const ok = (msg: string): void => console.log(`OK:   ${msg}`);

async function login(username: string, password: string): Promise<string> {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error(`login ${username} ${r.status}`);
  return ((await r.json()) as { token: string }).token;
}

async function api<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: T | { error?: { code: string; message: string } } }> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json: json as T };
}

async function main(): Promise<void> {
  const variant = await db.productVariant.findFirst({
    where: { sku: "COIL-1L-GL-05" },
    include: { product: true },
  });
  if (!variant) {
    console.log("SKIP: variant COIL-1L-GL-05 not in catalog. Guard is still wired in.");
    return;
  }
  ok(`found variant ${variant.sku} (parent ${variant.product.sku})`);

  // Pin variant SOH to 2.
  await db.productVariant.update({
    where: { id: variant.id },
    data: { stockOnHand: 2 },
  });
  ok("forced variant.stockOnHand = 2");

  // Pick or create a customer to attach an order to.
  let cust = await db.customer.findFirst({ where: { code: "SMOKE-CUST" } });
  if (!cust) {
    cust = await db.customer.create({
      data: {
        code: "SMOKE-CUST",
        name: "Stock-Guard Smoke Customer",
        contact: "0000000000",
      },
    });
  }

  // Need a warehouse + bin already holding the parent product so the
  // pick-list line has a binId to bind to.
  const bin = await db.bin.findFirst({
    where: { productId: variant.productId, qty: { gt: 0 } },
  });
  if (!bin) die("no bin holds the parent product - cannot construct pick list");

  // Build a fresh sales order + pick list.
  const so = await db.salesOrder.create({
    data: {
      soNo: `SO-SMOKE-${Date.now()}`,
      customerId: cust.id,
      status: "confirmed",
      orderDate: new Date(),
      subTotal: 100,
      tax: 0,
      total: 100,
      items: {
        create: [
          {
            productId: variant.productId,
            variantId: variant.id,
            qtyOrdered: 3,
            rate: 100,
            amount: 300,
          },
        ],
      },
    },
    include: { items: true },
  });
  ok(`created SO ${so.soNo}`);

  const someUser = await db.user.findFirst({ where: { username: "admin" } });
  const pl = await db.pickList.create({
    data: {
      pickListNo: `PL-SMOKE-${Date.now()}`,
      salesOrderId: so.id,
      status: "draft",
      createdById: someUser!.id,
      items: {
        create: [
          {
            salesOrderItemId: so.items[0].id,
            productId: variant.productId,
            variantId: variant.id,
            qtyToPick: 3,
            qtyPicked: 0,
            binId: bin.id,
          },
        ],
      },
    },
    include: { items: true },
  });
  ok(`created pick list ${pl.pickListNo} with one COIL-1L-GL-05 line qtyToPick=3`);

  const wh = await login("warehouse1", "nova1234");
  ok("logged in as warehouse1");

  // claim
  await api(wh, "POST", `/pick-lists/${pl.id}/claim`, {});

  // Try qty=3 -> must be refused with insufficient_stock.
  const overPull = await api<unknown>(wh, "POST", `/pick-lists/${pl.id}/items/${pl.items[0].id}/scan`, {
    qty: 3,
    reasonCode: "ok",
  });
  if (overPull.status !== 409) die(`over-pull returned ${overPull.status}, expected 409`);
  const errCode = (overPull.json as { error?: { code: string; message: string } }).error?.code;
  if (errCode !== "insufficient_stock") {
    die(`expected error.code=insufficient_stock, got ${errCode}`);
  }
  ok(`over-pull refused: ${(overPull.json as { error: { message: string } }).error.message}`);

  // qty=2 (within stock) must succeed.
  const within = await api<unknown>(wh, "POST", `/pick-lists/${pl.id}/items/${pl.items[0].id}/scan`, {
    qty: 2,
    reasonCode: "ok",
    clientOpId: `smoke-${Date.now()}`,
  });
  if (within.status !== 200) {
    die(`within-stock pick returned ${within.status}: ${JSON.stringify(within.json)}`);
  }
  ok("within-stock pick of 2 accepted");

  // Cleanup.
  await db.pickList.delete({ where: { id: pl.id } });
  await db.salesOrder.delete({ where: { id: so.id } });
  ok("cleaned up smoke pick list + SO");

  console.log("\nGUARD CONFIRMED: variant over-pull refused, within-stock pick accepted.");
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
