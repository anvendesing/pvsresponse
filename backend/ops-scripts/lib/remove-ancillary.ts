/**
 * Remove obsolete WH-ANC-* ancillary warehouses from an earlier ops-script version.
 * Current layout uses production-line WH only (no ancillary).
 */
import { db, dryRun, log } from "./db.js";

const ANCILLARY_CODE_PREFIX = "WH-ANC-";

function isObsoleteAncillary(code: string, name: string): boolean {
  return (
    code.startsWith(ANCILLARY_CODE_PREFIX) ||
    /ancillary/i.test(name)
  );
}

export async function removeObsoleteAncillaryWarehouses(): Promise<number> {
  const all = await db.warehouse.findMany({
    orderBy: { code: "asc" },
    include: {
      _count: { select: { bins: true, ledger: true } },
      productionWorkCenter: { select: { code: true } },
    },
  });

  const obsolete = all.filter((w) => isObsoleteAncillary(w.code, w.name));

  if (obsolete.length === 0) {
    log("  ✓ No obsolete ancillary warehouses (WH-ANC-* / name contains Ancillary)");
    return 0;
  }

  let cleaned = 0;
  for (const wh of obsolete) {
    const wc = wh.productionWorkCenter?.code;
    const summary = `${wh.code} (${wh.name}) — ${wh._count.bins} bin(s), ${wh._count.ledger} ledger`;

    if (dryRun) {
      log(`  [dry] remove ${summary}${wc ? `, linked WC ${wc}` : ""}`);
      cleaned++;
      continue;
    }

    // Unlink work center if it still points at ancillary WH (02 script should use WH-PROD-*).
    if (wh.productionWorkCenter) {
      await db.workCenter.update({
        where: { productionLineWarehouseId: wh.id },
        data: { productionLineWarehouseId: null },
      });
      log(`  ↪ Unlinked ${wc} from ${wh.code}`);
    }

    await db.putawayRule.deleteMany({ where: { toWarehouseId: wh.id } });
    await db.stockRule.deleteMany({ where: { toWarehouseId: wh.id } });

    const stockedBins = await db.bin.count({
      where: {
        warehouseId: wh.id,
        OR: [{ qty: { not: 0 } }, { reservedQty: { not: 0 } }],
      },
    });

    if (stockedBins > 0 || wh._count.ledger > 0) {
      await db.warehouse.update({ where: { id: wh.id }, data: { active: false } });
      log(`  ⊘ Deactivated ${summary} — stock or ledger present`);
      cleaned++;
      continue;
    }

    await db.bin.deleteMany({ where: { warehouseId: wh.id } });
    await db.warehouse.delete({ where: { id: wh.id } });
    log(`  ✗ Deleted ${summary}`);
    cleaned++;
  }

  log(`  ✓ Cleaned ${cleaned} obsolete ancillary warehouse(s)`);
  return cleaned;
}
