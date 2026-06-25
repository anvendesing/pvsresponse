#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const fac = await db.productionFacility.findFirst({
    where: { code: "WC-OIL" },
    include: {
      lines: {
        orderBy: { code: "asc" },
        include: { machines: { orderBy: { code: "asc" } } },
      },
    },
  });
  if (!fac) {
    console.log("WC-OIL facility not found");
    return;
  }
  console.log(`Facility: ${fac.code} active=${fac.active}`);
  console.log(`Lines: ${fac.lines.length}\n`);
  for (const line of fac.lines) {
    console.log(
      `  ${line.active ? "ON " : "OFF"} ${line.code} — ${line.name} — machines: ${line.machines.length}`
    );
    for (const m of line.machines) {
      console.log(`      ${m.active ? "ON " : "OFF"} ${m.code} ${m.name} (${m.status})`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => db.$disconnect());
