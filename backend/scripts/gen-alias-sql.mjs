import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const db = new PrismaClient();
const rows = await db.product.findMany({
  where: { searchAliases: { not: null } },
  select: { name: true, searchAliases: true },
});

const lines = rows.map((r) => {
  const safe = (r.searchAliases ?? "").replace(/'/g, "''");
  const nameSafe = r.name.replace(/'/g, "''");
  return `UPDATE "Product" SET "searchAliases" = '${safe}' WHERE lower(trim(name)) = lower(trim('${nameSafe}'));`;
});

const sql = `-- Search alias patch: ${rows.length} products\n` + lines.join("\n") + "\n";
writeFileSync("../scripts/patch-search-aliases.sql", sql);
console.log("Written", rows.length, "rows to scripts/patch-search-aliases.sql");
await db.$disconnect();
