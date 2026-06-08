// Sanity-check the new evaluateCreditGate helper for Test User1.
// Simulates "what if they tried to create another quote/SO right now?"
// for several amounts and prints whether the gate would pass.

import { db } from "../src/db.js";
import { evaluateCreditGate } from "../src/routes/sales.js";

const main = async () => {
  const cust = await db.customer.findFirst({
    where: { code: "CUST-0001" },
    select: { id: true, name: true, creditLimit: true },
  });
  if (!cust) {
    console.log("Customer CUST-0001 not found");
    await db.$disconnect();
    return;
  }
  const limit = cust.creditLimit ?? 0;
  console.log(`${cust.name}  creditLimit=₹${limit.toLocaleString("en-IN")}\n`);

  for (const amt of [1, 1000, 2006, 5015, 10000]) {
    const r = await evaluateCreditGate(cust.id, amt, cust.name, limit);
    const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
    console.log(
      `  + ₹${amt.toLocaleString("en-IN").padStart(7)} →  ${
        r.allowed ? "PASS" : "BLOCK"
      }  signed=${inr(r.exposure.signed)}  projected=${inr(r.projected)}`
    );
    if (!r.allowed) console.log(`              ${r.reason}`);
  }

  await db.$disconnect();
};

void main();
