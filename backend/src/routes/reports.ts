import type { FastifyInstance } from "fastify";
import { db } from "../db.js";

export const reportsRoutes = async (app: FastifyInstance) => {
  app.get("/reports/dashboard", async () => {
    const [
      productCount,
      activeWorkers,
      delayedOrders,
      lowStock,
      productionTotals,
      salesAgg,
      pendingApprovals,
    ] = await Promise.all([
      db.product.count(),
      db.worker.count({ where: { status: "in" } }),
      db.productionOrder.count({ where: { status: "delayed" } }),
      db.product.count({ where: { stockOnHand: { lt: 50 } } }),
      db.productionOrder.aggregate({
        _sum: { actualQty: true, plannedQty: true, scrapQty: true },
      }),
      db.invoice.aggregate({
        _sum: { amount: true },
        where: { status: { in: ["paid", "partial"] } },
      }),
      db.approval.count({ where: { status: "pending" } }),
    ]);
    return {
      productCount,
      activeWorkers,
      delayedOrders,
      lowStock,
      productionTotals,
      sales: salesAgg._sum.amount ?? 0,
      pendingApprovals,
    };
  });

  app.get("/reports/production-trend", async () => {
    const days = 14;
    const trend: { day: string; planned: number; actual: number; scrap: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(Date.now() - i * 86400000);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const agg = await db.productionOrder.aggregate({
        _sum: { plannedQty: true, actualQty: true, scrapQty: true },
        where: { startDate: { gte: start, lt: end } },
      });
      trend.push({
        day: `D${days - i}`,
        planned: agg._sum.plannedQty ?? 0,
        actual: agg._sum.actualQty ?? 0,
        scrap: agg._sum.scrapQty ?? 0,
      });
    }
    return trend;
  });

  app.get("/reports/procurement-split", async () => {
    const rows = await db.purchaseOrderItem.findMany({
      include: { product: { select: { category: { select: { name: true } } } } },
    });
    const by: Record<string, number> = {};
    for (const r of rows) {
      const cat = r.product.category?.name ?? "Uncategorized";
      by[cat] = (by[cat] ?? 0) + r.amount;
    }
    return Object.entries(by).map(([name, value]) => ({ name, value }));
  });

  app.get("/reports/sales-trend", async () => {
    const days = 14;
    const trend: { day: string; sales: number; cogs: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(Date.now() - i * 86400000);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 86400000);
      const agg = await db.invoice.aggregate({
        _sum: { amount: true },
        where: { date: { gte: start, lt: end } },
      });
      const sales = agg._sum.amount ?? 0;
      trend.push({
        day: `D${days - i}`,
        sales,
        cogs: Math.round(sales * 0.62),
      });
    }
    return trend;
  });

  app.get("/reports/station-load", async () => {
    const stations = await db.workOrder.groupBy({
      by: ["station"],
      _sum: { output: true, target: true },
    });
    return stations.map((s) => {
      const target = s._sum.target ?? 0;
      const output = s._sum.output ?? 0;
      const efficiency = target > 0 ? Math.round((output / target) * 100) : 0;
      return {
        station: s.station,
        target,
        output,
        efficiency,
      };
    });
  });

  app.get("/reports/workers-summary", async () => {
    const workers = await db.worker.findMany({
      select: { id: true, status: true },
    });
    return {
      total: workers.length,
      in: workers.filter((w) => w.status === "in").length,
      out: workers.filter((w) => w.status === "out").length,
    };
  });

  // Per-WorkCenter rollup used by the Manufacturing right rail and the
  // Productivity "Production lines" overview.
  //
  // Returns one row per active WorkCenter with:
  //   * machines        - id/code/name/status, plus a derived
  //                       'busy' flag if any in-progress MO ran
  //                       through them today.
  //   * activeOrders    - count of MOs whose station name == WC name
  //                       and status == 'in-progress'.
  //   * outputToday     - sum of WorkOrder.output rows whose station
  //                       == WC name AND startTime is today (or
  //                       updatedAt today as a fallback when startTime
  //                       wasn't recorded).
  //   * utilisationPct  - outputToday / (capacityPerHour * 8h) * 100,
  //                       capped at 100. null when capacity unknown.
  //
  // Only active WorkCenters are returned. Inactive ones are treated as
  // historical and excluded from rollups.
  app.get("/reports/production-lines", async () => {
    const workCenters = await db.workCenter.findMany({
      where: { active: true },
      include: {
        machines: {
          where: { active: true },
          orderBy: { code: "asc" },
        },
      },
      orderBy: { code: "asc" },
    });
    if (workCenters.length === 0) {
      return { lines: [], totals: { activeOrders: 0, outputToday: 0 } };
    }
    const wcNames = workCenters.map((wc) => wc.name);
    // Active MOs whose station matches one of our WC names.
    const activeMOs = await db.productionOrder.findMany({
      where: {
        status: { in: ["in-progress", "delayed"] },
        station: { in: wcNames },
      },
      include: {
        bom: {
          include: {
            product: { select: { sku: true, name: true } },
            variant: { select: { sku: true, size: true } },
          },
        },
      },
    });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);
    // WO.output sums for today, grouped by station (== WC name).
    const woAgg = await db.workOrder.groupBy({
      by: ["station"],
      where: {
        station: { in: wcNames },
        OR: [
          { startTime: { gte: todayStart, lt: tomorrowStart } },
          {
            // Fall back to updatedAt when WO never had a start time
            // recorded (older rows). We compare on updatedAt only when
            // there's a non-zero output to avoid pulling idle rows.
            AND: [
              { startTime: null },
              { output: { gt: 0 } },
              { updatedAt: { gte: todayStart, lt: tomorrowStart } },
            ],
          },
        ],
      },
      _sum: { output: true },
    });
    const outputByStation = new Map<string, number>();
    for (const r of woAgg) outputByStation.set(r.station, r._sum.output ?? 0);

    const ordersByStation = new Map<
      string,
      Array<(typeof activeMOs)[number]>
    >();
    for (const mo of activeMOs) {
      const list = ordersByStation.get(mo.station) ?? [];
      list.push(mo);
      ordersByStation.set(mo.station, list);
    }
    // Machines whose code/name appears as the machine field of an
    // active WorkOrder are flagged busy. We check by name because the
    // WO.machine column is free-text.
    const activeWOs = await db.workOrder.findMany({
      where: { status: { in: ["running", "queued"] } },
      select: { machine: true, station: true },
    });
    const busyMachineNames = new Set<string>(
      activeWOs.map((w) => w.machine).filter((m) => m && m !== "—")
    );

    const lines = workCenters.map((wc) => {
      const orders = ordersByStation.get(wc.name) ?? [];
      const outputToday = outputByStation.get(wc.name) ?? 0;
      // 8h shift assumption is a sensible default - operators can
      // override later via Settings if needed.
      const dailyCapacity =
        wc.capacityPerHour && wc.capacityPerHour > 0
          ? wc.capacityPerHour * 8
          : null;
      const utilisationPct =
        dailyCapacity !== null
          ? Math.min(100, Math.round((outputToday / dailyCapacity) * 100))
          : null;
      return {
        id: wc.id,
        code: wc.code,
        name: wc.name,
        capacityPerHour: wc.capacityPerHour,
        machines: wc.machines.map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          status: m.status,
          busy: busyMachineNames.has(m.name),
        })),
        activeOrders: orders.length,
        orders: orders.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          status: o.status,
          plannedQty: o.plannedQty,
          actualQty: o.actualQty,
          productSku: o.bom.variant?.sku ?? o.bom.product.sku,
          productName: o.bom.product.name,
        })),
        outputToday,
        dailyCapacity,
        utilisationPct,
      };
    });
    return {
      lines,
      totals: {
        activeOrders: activeMOs.length,
        outputToday: lines.reduce((s, l) => s + l.outputToday, 0),
      },
    };
  });

  // Real attendance heatmap - replaces the seeded sequence the
  // Productivity page used to show. Returns an array of `days` rows,
  // most recent last. Each row carries the date, weekday (Mon-Sun),
  // and presentCount (workers with at least one Attendance.inAt that
  // day).
  app.get("/reports/attendance-heatmap", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const days = Math.min(Math.max(Number(q.days ?? 28), 7), 90);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const out: Array<{
      date: string;
      weekday: string;
      presentCount: number;
    }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(today.getTime() - i * 86400000);
      const end = new Date(start.getTime() + 86400000);
      // Distinct workers with at least one in-punch in the window. We
      // can't rely on `groupBy` distinct counts in Prisma+SQLite, so
      // pull rows + dedupe in-process. The volume here is tiny.
      const rows = await db.attendance.findMany({
        where: {
          inAt: { gte: start, lt: end },
        },
        select: { workerId: true },
      });
      const present = new Set(rows.map((r) => r.workerId));
      out.push({
        date: start.toISOString().slice(0, 10),
        weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
          start.getDay()
        ],
        presentCount: present.size,
      });
    }
    return out;
  });

  // Workers who punched in on a given calendar day (for heatmap drill-down).
  app.get("/reports/attendance-day", async (req, reply) => {
    const dateStr = (req.query as { date?: string }).date;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return reply.code(400).send({
        error: { code: "bad_request", message: "Query param date=YYYY-MM-DD is required." },
      });
    }
    const start = new Date(`${dateStr}T00:00:00`);
    const end = new Date(start.getTime() + 86400000);
    const rows = await db.attendance.findMany({
      where: { inAt: { gte: start, lt: end } },
      include: {
        worker: {
          select: { id: true, empNo: true, name: true, shift: true, station: true },
        },
      },
      orderBy: { inAt: "asc" },
    });
    const byWorker = new Map<
      string,
      {
        workerId: string;
        empNo: string;
        name: string;
        shift: string;
        station: string;
        inAt: string | null;
        outAt: string | null;
      }
    >();
    for (const row of rows) {
      const existing = byWorker.get(row.workerId);
      const inAt = row.inAt?.toISOString() ?? null;
      const outAt = row.outAt?.toISOString() ?? null;
      if (!existing) {
        byWorker.set(row.workerId, {
          workerId: row.workerId,
          empNo: row.worker.empNo,
          name: row.worker.name,
          shift: row.worker.shift,
          station: row.worker.station,
          inAt,
          outAt,
        });
        continue;
      }
      if (inAt && (!existing.inAt || inAt < existing.inAt)) existing.inAt = inAt;
      if (outAt && (!existing.outAt || outAt > existing.outAt)) existing.outAt = outAt;
    }
    return {
      date: dateStr,
      presentCount: byWorker.size,
      workers: [...byWorker.values()].sort((a, b) => a.empNo.localeCompare(b.empNo)),
    };
  });

  // GET /reports/transfer-throughput
  // Returns daily TransferOrder completion counts (done) over the last 30 days,
  // broken down by kind (putaway / replenishment / manual).
  app.get("/reports/transfer-throughput", async (req) => {
    const q = (req.query as Record<string, string>) ?? {};
    const days = Math.min(parseInt(q.days ?? "30", 10) || 30, 90);
    const since = new Date(Date.now() - days * 86400000);
    const done = await db.transferOrder.findMany({
      where: { status: "done", droppedAt: { gte: since } },
      select: { kind: true, droppedAt: true, items: { select: { qtyDropped: true } } },
    });

    const buckets: Record<string, Record<string, number>> = {};
    for (const to of done) {
      if (!to.droppedAt) continue;
      const date = to.droppedAt.toISOString().slice(0, 10);
      buckets[date] ??= {};
      buckets[date][to.kind] = (buckets[date][to.kind] ?? 0) + 1;
    }

    const rows: Array<{ date: string; putaway: number; replenishment: number; manual: number; total: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const b = buckets[d] ?? {};
      rows.push({
        date: d,
        putaway: b.putaway ?? 0,
        replenishment: b.replenishment ?? 0,
        manual: b.manual ?? 0,
        total: (b.putaway ?? 0) + (b.replenishment ?? 0) + (b.manual ?? 0),
      });
    }
    return rows;
  });

  // GET /reports/skus-missing-putaway-rules
  // Lists active products that have no active PutawayRule, so ops teams
  // know which SKUs need to be configured before routing will work.
  app.get("/reports/skus-missing-putaway-rules", async () => {
    const allProducts = await db.product.findMany({
      where: {},
      select: { id: true, sku: true, name: true, uom: true, stockOnHand: true },
      orderBy: { sku: "asc" },
    });

    const ruledProductIds = new Set(
      (await db.putawayRule.findMany({
        where: { active: true },
        select: { productId: true },
      })).map((r) => r.productId)
    );

    return allProducts.filter((p) => !ruledProductIds.has(p.id)).map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      uom: p.uom,
      stockOnHand: p.stockOnHand,
    }));
  });
};
