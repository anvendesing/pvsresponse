// Concurrent checkout load test — 20 parallel orders against Postgres.
//
// Prerequisites:
//   - Backend running with Postgres (DATABASE_URL=postgresql://...)
//   - At least one product with stock > 20 in the DB
//   - STOREFRONT_TOKEN env var set (or VITE_MOCK_STOREFRONT_TOKEN from .env)
//
// Usage:
//   npx tsx scripts/smoke-checkout.ts
//
// The script creates 20 customers (distinct phones), adds the same product
// to each cart, and fires concurrent COD checkout requests. It reports
// success/failure counts and highlights constraint violations.

import { setTimeout as delay } from "node:timers/promises";

const BASE = process.env["API_BASE"] ?? "http://localhost:4000";
const TOKEN = process.env["STOREFRONT_TOKEN"] ?? process.env["VITE_MOCK_STOREFRONT_TOKEN"] ?? "";
const CONCURRENCY = parseInt(process.env["SMOKE_CONCURRENCY"] ?? "20", 10);

if (!TOKEN) {
  console.error("STOREFRONT_TOKEN not set — set VITE_MOCK_STOREFRONT_TOKEN in your .env");
  process.exit(1);
}

interface CatalogProduct {
  id: string;
  name: string;
  inStock: boolean;
  basePrice: number;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-mock-token": TOKEN },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-token": TOKEN },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function runOneOrder(idx: number): Promise<{ ok: boolean; msg: string }> {
  const phone = `99900${String(idx).padStart(5, "0")}`;
  try {
    // Pick the first in-stock product
    const catalog = await apiGet<{ products: CatalogProduct[] }>("/v1/storefront-mock/catalog");
    const product = catalog.products.find((p) => p.inStock);
    if (!product) throw new Error("No in-stock product found in catalog");

    const order = await apiPost<{ salesOrder?: { soNo: string }; response?: { salesOrder?: { soNo: string } } }>(
      "/v1/storefront-mock/order/mock",
      {
        customerPhone: phone,
        customerName: `Smoke Tester ${idx}`,
        shippingAddress: {
          line1: "123 Test St",
          city: "Chennai",
          state: "Tamil Nadu",
          pincode: "600001",
          country: "India",
        },
        lines: [{ productId: product.id, qty: 1 }],
        paymentMethod: "cod",
      }
    );

    const soNo = (order as { salesOrder?: { soNo: string } }).salesOrder?.soNo
      ?? (order as { response?: { salesOrder?: { soNo: string } } }).response?.salesOrder?.soNo;
    return { ok: true, msg: `#${idx} → SO ${soNo}` };
  } catch (err) {
    return { ok: false, msg: `#${idx} → FAIL: ${(err as Error).message.slice(0, 120)}` };
  }
}

async function main() {
  console.log(`\nSmoke test: ${CONCURRENCY} concurrent COD checkouts → ${BASE}\n`);

  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => runOneOrder(i + 1))
  );

  const passed = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  console.log("Results:");
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.msg}`);
  }

  console.log(`\n${passed.length}/${CONCURRENCY} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Smoke test fatal:", err);
  process.exit(1);
});
