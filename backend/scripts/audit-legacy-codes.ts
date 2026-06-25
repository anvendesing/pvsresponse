#!/usr/bin/env tsx
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const isLegacy = (code: string | null) =>
  !!code && (code.startsWith("B.") || code.startsWith("S.") || code.startsWith("Z."));

(async () => {
  const warehouses = await db.warehouse.findMany({
    select: { id: true, code: true, scanPrefix: true },
    orderBy: { code: "asc" },
  });
  const bins = await db.bin.findMany({
    select: { code: true, warehouseId: true },
  });
  for (const wh of warehouses) {
    const whBins = bins.filter((b) => b.warehouseId === wh.id);
    const legacy = whBins.filter((b) => isLegacy(b.code)).length;
    const compact = whBins.filter((b) => b.code && !isLegacy(b.code)).length;
    if (whBins.length === 0) continue;
    console.log(
      `${wh.code.padEnd(20)} prefix=${(wh.scanPrefix ?? "—").padEnd(4)} bins=${String(whBins.length).padStart(4)} legacy=${String(legacy).padStart(4)} compact=${compact}`
    );
  }
  await db.$disconnect();
})();
