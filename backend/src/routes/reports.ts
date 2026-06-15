import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { containerCode } from "../lib/container-codes.js";
import { csvAttachment, toCsv } from "../lib/csv.js";
import { lineItemUom } from "../lib/line-item.js";

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
  //   * lines           - each ProductionLine inside the facility with
  //                       machine + active MO drill-down.
  //   * activeOrders    - count of in-progress MOs for this facility
  //                       (matched by facilityId FK, not station name).
  //   * outputToday     - sum of WO output rows whose lineId belongs to
  //                       this facility, startTime today.
  //   * utilisationPct  - outputToday / (capacityPerHour * 8h) * 100.
  //
  // The legacy /reports/production-lines endpoint is kept as an alias
  // and redirects to this same handler.
  const productionFacilitiesReport = async () => {
    const facilities = await db.productionFacility.findMany({
      where: { active: true },
      include: {
        lines: {
          where: { active: true },
          orderBy: { code: "asc" },
          include: {
            machines: {
              where: { active: true },
              orderBy: { code: "asc" },
            },
          },
        },
      },
      orderBy: { code: "asc" },
    });
    if (facilities.length === 0) {
      return { facilities: [], totals: { activeOrders: 0, outputToday: 0 } };
    }
    const facilityIds = facilities.map((f) => f.id);
    // Active MOs matched by facilityId FK.
    const activeMOs = await db.productionOrder.findMany({
      where: {
        status: { in: ["in-progress", "delayed"] },
        facilityId: { in: facilityIds },
      },
      include: {
        bom: {
          include: {
            product: { select: { sku: true, name: true } },
            variant: { select: { sku: true, size: true } },
          },
        },
        line: { select: { id: true, name: true } },
      },
    });
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);

    // Collect all line IDs across all active facilities.
    const allLineIds = facilities.flatMap((f) => f.lines.map((l) => l.id));

    // WO output sums for today grouped by lineId.
    const woRows = await db.workOrder.findMany({
      where: {
        lineId: { in: allLineIds },
        OR: [
          { startTime: { gte: todayStart, lt: tomorrowStart } },
          {
            AND: [
              { startTime: null },
              { output: { gt: 0 } },
              { updatedAt: { gte: todayStart, lt: tomorrowStart } },
            ],
          },
        ],
      },
      select: { lineId: true, output: true },
    });
    const outputByLineId = new Map<string, number>();
    for (const r of woRows) {
      if (r.lineId) {
        outputByLineId.set(r.lineId, (outputByLineId.get(r.lineId) ?? 0) + r.output);
      }
    }

    const ordersByFacilityId = new Map<string, Array<(typeof activeMOs)[number]>>();
    for (const mo of activeMOs) {
      if (!mo.facilityId) continue;
      const list = ordersByFacilityId.get(mo.facilityId) ?? [];
      list.push(mo);
      ordersByFacilityId.set(mo.facilityId, list);
    }

    // Machines busy if they have a running/queued WO via machineId or name.
    const activeWOs = await db.workOrder.findMany({
      where: { status: { in: ["running", "queued"] } },
      select: { machine: true, machineId: true },
    });
    const busyMachineIds = new Set<string>(activeWOs.map((w) => w.machineId).filter(Boolean) as string[]);
    const busyMachineNames = new Set<string>(activeWOs.map((w) => w.machine).filter((m): m is string => !!m && m !== "—"));

    const result = facilities.map((fac) => {
      const orders = ordersByFacilityId.get(fac.id) ?? [];
      const outputToday = fac.lines.reduce(
        (sum, l) => sum + (outputByLineId.get(l.id) ?? 0),
        0
      );
      const dailyCapacity =
        fac.capacityPerHour && fac.capacityPerHour > 0
          ? fac.capacityPerHour * 8
          : null;
      const utilisationPct =
        dailyCapacity !== null
          ? Math.min(100, Math.round((outputToday / dailyCapacity) * 100))
          : null;
      return {
        id: fac.id,
        code: fac.code,
        name: fac.name,
        capacityPerHour: fac.capacityPerHour,
        lines: fac.lines.map((l) => ({
          id: l.id,
          code: l.code,
          name: l.name,
          capacityPerHour: l.capacityPerHour,
          outputToday: outputByLineId.get(l.id) ?? 0,
          machines: l.machines.map((m) => ({
            id: m.id,
            code: m.code,
            name: m.name,
            status: m.status,
            busy: busyMachineIds.has(m.id) || busyMachineNames.has(m.name),
          })),
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
          lineId: o.lineId,
          lineName: o.line?.name ?? null,
        })),
        outputToday,
        dailyCapacity,
        utilisationPct,
      };
    });
    return {
      facilities: result,
      // Legacy field alias so existing frontend code that reads `.lines` keeps working.
      lines: result,
      totals: {
        activeOrders: activeMOs.length,
        outputToday: result.reduce((s, f) => s + f.outputToday, 0),
      },
    };
  };

  app.get("/reports/production-facilities", productionFacilitiesReport);
  // Legacy alias — keep for one release.
  app.get("/reports/production-lines", productionFacilitiesReport);

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

  // =====================================================================
  // Multi-container packing reports
  //
  // Four endpoints intended for ops + floor supervisors:
  //   1. /reports/pack-manifest/:packingSlipId
  //        Container-by-container breakdown of a packing slip. The packer
  //        prints this to confirm "what is in box 01 vs box 02" before
  //        sealing the trip. Also used as the customer-facing manifest
  //        when a delivery is split across multiple cartons.
  //   2. /reports/item-container-history?productId=&variantId=&days=
  //        For a given product/variant, the most-recent containers it has
  //        been packed into. Used by customer-care when a buyer reports
  //        a missing/damaged item and we need to trace which container.
  //   3. /reports/trip-manifest/:tripId
  //        Roll-up of every container across every dispatch on a trip.
  //        The loader prints this to verify the truck before departure;
  //        the totals match DispatchOrder.weightKg / Trip capacityKg.
  //   4. /reports/pack-throughput?days=30
  //        Daily counts of slips packed and containers sealed + total kg.
  //        Powers a small productivity widget on the dashboard.
  //
  // All four support `?format=csv` for download. Schemas validate the
  // querystring with zod so we get explicit 400s rather than silent
  // fallbacks.
  // =====================================================================

  const formatQ = z.object({ format: z.enum(["json", "csv"]).optional() });

  /** Sum of `qty` across a list of container items. */
  const sumQty = (entries: { qty: number }[]) =>
    entries.reduce((s, e) => s + e.qty, 0);

  // Stable string for null-safe display of a variant key.
  const variantKey = (
    v: { sku?: string | null; size?: string | null; color?: string | null } | null | undefined
  ): string => {
    if (!v) return "";
    return [v.sku, v.size, v.color].filter(Boolean).join(" / ");
  };

  // -------------------------------------------------------------------
  // 1. Pack manifest (per packing slip)
  // -------------------------------------------------------------------
  app.get<{ Params: { packingSlipId: string }; Querystring: { format?: "json" | "csv" } }>(
    "/reports/pack-manifest/:packingSlipId",
    async (req, reply) => {
      const { format } = formatQ.parse(req.query);
      const slip = await db.packingSlip.findUnique({
        where: { id: req.params.packingSlipId },
        include: {
          salesOrder: {
            select: {
              id: true,
              soNo: true,
              customer: { select: { id: true, code: true, name: true, city: true } },
            },
          },
          invoice: {
            select: {
              id: true,
              invoiceNo: true,
              dispatches: {
                select: {
                  id: true,
                  dispatchNo: true,
                  status: true,
                  trip: { select: { id: true, tripNo: true, scheduledDate: true } },
                },
              },
            },
          },
          items: {
            include: {
              product: { select: { id: true, sku: true, name: true, uom: true, barcode: true } },
              variant: {
                select: {
                  id: true,
                  sku: true,
                  size: true,
                  color: true,
                  barcode: true,
                  uom: true,
                },
              },
              containerEntries: { select: { qty: true, containerId: true } },
            },
          },
          containers: {
            orderBy: { seq: "asc" },
            include: {
              containerType: { select: { code: true, name: true, kind: true, tareKg: true } },
              items: {
                include: {
                  packingSlipItem: {
                    select: {
                      id: true,
                      qtyPacked: true,
                      product: {
                        select: { id: true, sku: true, name: true, uom: true, barcode: true },
                      },
                      variant: {
                        select: {
                          id: true,
                          sku: true,
                          size: true,
                          color: true,
                          barcode: true,
                          uom: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!slip) {
        reply.code(404);
        return { error: "not_found" };
      }

      const containers = slip.containers.map((c) => {
        const lines = c.items.map((ci) => ({
          packingSlipItemId: ci.packingSlipItemId,
          productId: ci.packingSlipItem.product.id,
          productSku: ci.packingSlipItem.product.sku,
          productName: ci.packingSlipItem.product.name,
          productBarcode: ci.packingSlipItem.product.barcode ?? null,
          // Effective UoM: variant.uom wins (e.g. "pc" for a bottled
          // pack), falling back to "pc" when the line has a variant
          // but no explicit UoM, and to the bulk product.uom otherwise.
          uom: lineItemUom(
            ci.packingSlipItem.product,
            ci.packingSlipItem.variant
          ),
          variantId: ci.packingSlipItem.variant?.id ?? null,
          variant: variantKey(ci.packingSlipItem.variant),
          variantBarcode: ci.packingSlipItem.variant?.barcode ?? null,
          qty: ci.qty,
          qtyPacked: ci.packingSlipItem.qtyPacked,
        }));
        return {
          id: c.id,
          seq: c.seq,
          label: c.label,
          code: containerCode(slip.packingSlipNo, c.seq),
          status: c.status,
          containerType: c.containerType
            ? {
                code: c.containerType.code,
                name: c.containerType.name,
                kind: c.containerType.kind,
                tareKg: c.containerType.tareKg,
              }
            : null,
          estWeightKg: c.estWeightKg,
          actualWeightKg: c.actualWeightKg,
          tareKgOverride: c.tareKgOverride,
          notes: c.notes,
          sealedAt: c.sealedAt,
          sealedById: c.sealedById,
          itemCount: lines.length,
          unitCount: sumQty(c.items),
          lines,
        };
      });

      // Any slip line that isn't fully allocated across sealed containers
      // is surfaced so the manifest viewer can flag stragglers (e.g. a
      // line still half open in container 02).
      const unallocated = slip.items
        .map((it) => {
          const allocated = sumQty(it.containerEntries);
          return {
            packingSlipItemId: it.id,
            productSku: it.product.sku,
            productName: it.product.name,
            variant: variantKey(it.variant),
            uom: lineItemUom(it.product, it.variant),
            qtyPacked: it.qtyPacked,
            allocated,
            shortage: Math.max(0, it.qtyPacked - allocated),
          };
        })
        .filter((r) => r.shortage > 1e-6);

      const payload = {
        slip: {
          id: slip.id,
          packingSlipNo: slip.packingSlipNo,
          status: slip.status,
          packedAt: slip.packedAt,
          totalEstWeightKg: slip.totalEstWeightKg,
          totalActualWeightKg: slip.totalActualWeightKg,
        },
        salesOrder: slip.salesOrder,
        invoice: slip.invoice,
        containers,
        unallocated,
        totals: {
          containerCount: containers.length,
          sealedCount: containers.filter((c) => c.status === "sealed").length,
          unitCount: containers.reduce((s, c) => s + c.unitCount, 0),
          estWeightKg: slip.totalEstWeightKg,
          actualWeightKg: slip.totalActualWeightKg,
        },
      };

      if (format === "csv") {
        const headers = [
          "container_label",
          "container_code",
          "container_type",
          "status",
          "est_weight_kg",
          "actual_weight_kg",
          "product_sku",
          "product_barcode",
          "product_name",
          "variant",
          "variant_barcode",
          "qty_in_container",
          "uom",
          "line_qty_packed",
        ];
        const rows: unknown[][] = [];
        for (const c of containers) {
          if (c.lines.length === 0) {
            rows.push([
              c.label,
              c.code,
              c.containerType?.code ?? "",
              c.status,
              c.estWeightKg,
              c.actualWeightKg,
              "",
              "",
              "(empty)",
              "",
              "",
              0,
              "",
              "",
            ]);
            continue;
          }
          for (const ln of c.lines) {
            rows.push([
              c.label,
              c.code,
              c.containerType?.code ?? "",
              c.status,
              c.estWeightKg,
              c.actualWeightKg,
              ln.productSku,
              ln.productBarcode ?? "",
              ln.productName,
              ln.variant,
              ln.variantBarcode ?? "",
              ln.qty,
              ln.uom,
              ln.qtyPacked,
            ]);
          }
        }
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header(
          "Content-Disposition",
          csvAttachment(`pack-manifest-${slip.packingSlipNo}.csv`)
        );
        return toCsv(headers, rows);
      }

      return payload;
    }
  );

  // -------------------------------------------------------------------
  // 2. Item -> container history
  // -------------------------------------------------------------------
  const itemHistoryQ = z.object({
    productId: z.string().optional(),
    variantId: z.string().optional(),
    barcode: z.string().optional(),
    sku: z.string().optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    format: z.enum(["json", "csv"]).optional(),
  });
  app.get("/reports/item-container-history", async (req, reply) => {
    const q = itemHistoryQ.parse(req.query);
    if (!q.productId && !q.variantId && !q.barcode && !q.sku) {
      reply.code(400);
      return { error: "missing_filter", message: "Provide productId, variantId, sku, or barcode." };
    }

    // Resolve sku/barcode to product/variant ids when given. We accept
    // either, case-insensitive — mirrors the rest of the search APIs.
    let productId = q.productId;
    let variantId = q.variantId;
    if (!productId && !variantId && (q.sku || q.barcode)) {
      const code = (q.sku ?? q.barcode ?? "").trim();
      if (code) {
        // SQLite Prisma doesn't support `mode: "insensitive"` — match
        // exact + uppercase variant explicitly, matching the pattern
        // used by /scan resolvers.
        const upper = code.toUpperCase();
        const variant = await db.productVariant.findFirst({
          where: {
            OR: [
              { sku: { equals: code } },
              { sku: { equals: upper } },
              { barcode: { equals: code } },
              { barcode: { equals: upper } },
            ],
          },
          select: { id: true, productId: true },
        });
        if (variant) {
          variantId = variant.id;
        } else {
          const product = await db.product.findFirst({
            where: {
              OR: [
                { sku: { equals: code } },
                { sku: { equals: upper } },
                { barcode: { equals: code } },
                { barcode: { equals: upper } },
              ],
            },
            select: { id: true },
          });
          if (product) productId = product.id;
        }
      }
    }

    if (!productId && !variantId) {
      reply.code(404);
      return { error: "item_not_found" };
    }

    const sinceDate = q.days
      ? new Date(Date.now() - q.days * 86400000)
      : new Date(Date.now() - 90 * 86400000);

    const where: {
      packingSlipItem: {
        productId?: string;
        variantId?: string;
        packingSlip: { packedAt: { gte: Date } };
      };
    } = {
      packingSlipItem: {
        ...(productId ? { productId } : {}),
        ...(variantId ? { variantId } : {}),
        packingSlip: { packedAt: { gte: sinceDate } },
      },
    };

    const entries = await db.packingContainerItem.findMany({
      where,
      take: q.limit ?? 200,
      orderBy: { id: "desc" }, // proxy for createdAt; this table has no timestamp.
      include: {
        container: {
          include: {
            containerType: { select: { code: true, kind: true } },
            packingSlip: {
              select: {
                id: true,
                packingSlipNo: true,
                packedAt: true,
                status: true,
                salesOrder: {
                  select: {
                    id: true,
                    soNo: true,
                    customer: { select: { id: true, code: true, name: true } },
                  },
                },
                invoice: {
                  select: {
                    id: true,
                    invoiceNo: true,
                    dispatches: {
                      select: {
                        id: true,
                        dispatchNo: true,
                        status: true,
                        trip: { select: { id: true, tripNo: true, scheduledDate: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        packingSlipItem: {
          select: {
            qtyPacked: true,
            product: { select: { id: true, sku: true, name: true, uom: true, barcode: true } },
            variant: {
              select: {
                id: true,
                sku: true,
                size: true,
                color: true,
                barcode: true,
                uom: true,
              },
            },
          },
        },
      },
    });

    // Sort newest-first by the slip's packedAt for the response — the
    // SQL `id desc` ordering is just a stable cursor proxy.
    const rows = entries
      .filter((e) => !!e.container.packingSlip.packedAt)
      .sort((a, b) => {
        const ta = a.container.packingSlip.packedAt?.getTime() ?? 0;
        const tb = b.container.packingSlip.packedAt?.getTime() ?? 0;
        return tb - ta;
      })
      .map((e) => ({
        packingSlipId: e.container.packingSlip.id,
        packingSlipNo: e.container.packingSlip.packingSlipNo,
        packedAt: e.container.packingSlip.packedAt,
        slipStatus: e.container.packingSlip.status,
        containerId: e.container.id,
        containerSeq: e.container.seq,
        containerLabel: e.container.label,
        containerCode: containerCode(
          e.container.packingSlip.packingSlipNo,
          e.container.seq
        ),
        containerType: e.container.containerType?.code ?? null,
        containerStatus: e.container.status,
        qty: e.qty,
        qtyPacked: e.packingSlipItem.qtyPacked,
        // Surface variant.uom inside the product blob so client renders
        // that don't know about variant fall-through still display the
        // right "pc" / "kg" / "L" suffix.
        product: {
          ...e.packingSlipItem.product,
          uom: lineItemUom(
            e.packingSlipItem.product,
            e.packingSlipItem.variant
          ),
        },
        variant: e.packingSlipItem.variant,
        salesOrder: e.container.packingSlip.salesOrder,
        invoiceNo: e.container.packingSlip.invoice?.invoiceNo ?? null,
        dispatches:
          e.container.packingSlip.invoice?.dispatches.map((d) => ({
            dispatchNo: d.dispatchNo,
            status: d.status,
            tripNo: d.trip?.tripNo ?? null,
            scheduledDate: d.trip?.scheduledDate ?? null,
          })) ?? [],
      }));

    if (q.format === "csv") {
      const headers = [
        "packed_at",
        "packing_slip_no",
        "container_label",
        "container_code",
        "container_type",
        "container_status",
        "product_sku",
        "product_barcode",
        "product_name",
        "variant",
        "qty_in_container",
        "uom",
        "so_no",
        "customer",
        "invoice_no",
        "dispatch_no",
        "trip_no",
      ];
      const csvRows = rows.map((r) => [
        r.packedAt,
        r.packingSlipNo,
        r.containerLabel,
        r.containerCode,
        r.containerType ?? "",
        r.containerStatus,
        r.product.sku,
        r.product.barcode ?? "",
        r.product.name,
        variantKey(r.variant),
        r.qty,
        r.product.uom,
        r.salesOrder?.soNo ?? "",
        r.salesOrder?.customer?.name ?? "",
        r.invoiceNo ?? "",
        r.dispatches.map((d) => d.dispatchNo).join(" / "),
        r.dispatches.map((d) => d.tripNo ?? "").join(" / "),
      ]);
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        csvAttachment(
          `item-container-history-${variantId ?? productId ?? "item"}.csv`
        )
      );
      return toCsv(headers, csvRows);
    }

    return {
      productId: productId ?? null,
      variantId: variantId ?? null,
      sinceDate,
      count: rows.length,
      rows,
    };
  });

  // -------------------------------------------------------------------
  // 3. Trip manifest
  // -------------------------------------------------------------------
  app.get<{ Params: { tripId: string }; Querystring: { format?: "json" | "csv" } }>(
    "/reports/trip-manifest/:tripId",
    async (req, reply) => {
      const { format } = formatQ.parse(req.query);
      const trip = await db.trip.findUnique({
        where: { id: req.params.tripId },
        include: {
          dispatches: {
            include: {
              invoice: {
                select: {
                  id: true,
                  invoiceNo: true,
                  amount: true,
                  customer: { select: { id: true, code: true, name: true, city: true } },
                  packingSlip: {
                    include: {
                      containers: {
                        orderBy: { seq: "asc" },
                        include: {
                          containerType: { select: { code: true, kind: true, tareKg: true } },
                          items: {
                            include: {
                              packingSlipItem: {
                                select: {
                                  id: true,
                                  qtyPacked: true,
                                  product: {
                                    select: {
                                      id: true,
                                      sku: true,
                                      name: true,
                                      uom: true,
                                      barcode: true,
                                    },
                                  },
                                  variant: {
                                    select: {
                                      id: true,
                                      sku: true,
                                      size: true,
                                      color: true,
                                      barcode: true,
                                      uom: true,
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!trip) {
        reply.code(404);
        return { error: "not_found" };
      }

      const stops = trip.dispatches.map((d) => {
        const slip = d.invoice.packingSlip;
        const containers = (slip?.containers ?? []).map((c) => {
          const slipNo = slip?.packingSlipNo ?? "";
          const lines = c.items.map((ci) => ({
            productSku: ci.packingSlipItem.product.sku,
            productName: ci.packingSlipItem.product.name,
            productBarcode: ci.packingSlipItem.product.barcode ?? null,
            // Effective UoM: variant wins over parent product.
            uom: lineItemUom(
              ci.packingSlipItem.product,
              ci.packingSlipItem.variant
            ),
            variant: variantKey(ci.packingSlipItem.variant),
            variantBarcode: ci.packingSlipItem.variant?.barcode ?? null,
            qty: ci.qty,
          }));
          return {
            id: c.id,
            seq: c.seq,
            label: c.label,
            code: containerCode(slipNo, c.seq),
            status: c.status,
            containerType: c.containerType,
            estWeightKg: c.estWeightKg,
            actualWeightKg: c.actualWeightKg,
            unitCount: sumQty(c.items),
            lines,
          };
        });
        const slipEst = slip?.totalEstWeightKg ?? 0;
        const slipActual = slip?.totalActualWeightKg ?? null;
        return {
          dispatchId: d.id,
          dispatchNo: d.dispatchNo,
          status: d.status,
          weightKg: d.weightKg,
          invoiceNo: d.invoice.invoiceNo,
          customer: d.invoice.customer,
          packingSlip: slip
            ? {
                id: slip.id,
                packingSlipNo: slip.packingSlipNo,
                totalEstWeightKg: slipEst,
                totalActualWeightKg: slipActual,
              }
            : null,
          containers,
          containerCount: containers.length,
          unitCount: containers.reduce((s, c) => s + c.unitCount, 0),
          estWeightKg: slipEst,
          actualWeightKg: slipActual,
        };
      });

      const payload = {
        trip: {
          id: trip.id,
          tripNo: trip.tripNo,
          scheduledDate: trip.scheduledDate,
          status: trip.status,
          vehicle: trip.vehicle,
          driver: trip.driver,
          route: trip.route,
          capacityKg: trip.capacityKg,
        },
        stops,
        totals: {
          stopCount: stops.length,
          containerCount: stops.reduce((s, st) => s + st.containerCount, 0),
          unitCount: stops.reduce((s, st) => s + st.unitCount, 0),
          // Sum of DispatchOrder.weightKg — this is the canonical value
          // driving load planning. Falls back to per-stop est when a
          // dispatch's weight wasn't recomputed yet.
          weightKg:
            Math.round(
              stops.reduce((s, st) => s + (st.weightKg || st.estWeightKg), 0) *
                100
            ) / 100,
          capacityKg: trip.capacityKg,
        },
      };

      if (format === "csv") {
        const headers = [
          "dispatch_no",
          "customer",
          "customer_city",
          "invoice_no",
          "packing_slip_no",
          "container_label",
          "container_code",
          "container_type",
          "container_status",
          "container_est_kg",
          "container_actual_kg",
          "product_sku",
          "product_barcode",
          "product_name",
          "variant",
          "qty_in_container",
          "uom",
        ];
        const rows: unknown[][] = [];
        for (const st of stops) {
          if (st.containers.length === 0) {
            rows.push([
              st.dispatchNo,
              st.customer?.name ?? "",
              st.customer?.city ?? "",
              st.invoiceNo,
              st.packingSlip?.packingSlipNo ?? "",
              "(no containers)",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              "",
            ]);
            continue;
          }
          for (const c of st.containers) {
            if (c.lines.length === 0) {
              rows.push([
                st.dispatchNo,
                st.customer?.name ?? "",
                st.customer?.city ?? "",
                st.invoiceNo,
                st.packingSlip?.packingSlipNo ?? "",
                c.label,
                c.code,
                c.containerType?.code ?? "",
                c.status,
                c.estWeightKg,
                c.actualWeightKg,
                "",
                "",
                "(empty)",
                "",
                "",
                "",
              ]);
              continue;
            }
            for (const ln of c.lines) {
              rows.push([
                st.dispatchNo,
                st.customer?.name ?? "",
                st.customer?.city ?? "",
                st.invoiceNo,
                st.packingSlip?.packingSlipNo ?? "",
                c.label,
                c.code,
                c.containerType?.code ?? "",
                c.status,
                c.estWeightKg,
                c.actualWeightKg,
                ln.productSku,
                ln.productBarcode ?? "",
                ln.productName,
                ln.variant,
                ln.qty,
                ln.uom,
              ]);
            }
          }
        }
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header(
          "Content-Disposition",
          csvAttachment(`trip-manifest-${trip.tripNo}.csv`)
        );
        return toCsv(headers, rows);
      }

      return payload;
    }
  );

  // -------------------------------------------------------------------
  // 4. Pack throughput (daily)
  // -------------------------------------------------------------------
  const throughputQ = z.object({
    days: z.coerce.number().int().min(1).max(180).optional(),
    format: z.enum(["json", "csv"]).optional(),
  });
  app.get("/reports/pack-throughput", async (req, reply) => {
    const q = throughputQ.parse(req.query);
    const days = q.days ?? 14;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setTime(start.getTime() - (days - 1) * 86400000);

    const [slips, containers] = await Promise.all([
      db.packingSlip.findMany({
        where: { packedAt: { gte: start } },
        select: { id: true, packedAt: true, totalEstWeightKg: true, totalActualWeightKg: true },
      }),
      db.packingContainer.findMany({
        where: { sealedAt: { gte: start } },
        select: { sealedAt: true, estWeightKg: true, actualWeightKg: true },
      }),
    ]);

    type Bucket = {
      day: string;
      slips: number;
      containers: number;
      estKg: number;
      actualKg: number;
    };
    const buckets = new Map<string, Bucket>();
    const fmt = (d: Date) => d.toISOString().slice(0, 10); // yyyy-mm-dd
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 86400000);
      const key = fmt(d);
      buckets.set(key, { day: key, slips: 0, containers: 0, estKg: 0, actualKg: 0 });
    }
    for (const s of slips) {
      if (!s.packedAt) continue;
      const key = fmt(s.packedAt);
      const b = buckets.get(key);
      if (!b) continue;
      b.slips += 1;
    }
    for (const c of containers) {
      if (!c.sealedAt) continue;
      const key = fmt(c.sealedAt);
      const b = buckets.get(key);
      if (!b) continue;
      b.containers += 1;
      b.estKg += c.estWeightKg;
      if (c.actualWeightKg != null) b.actualKg += c.actualWeightKg;
    }
    const rows = [...buckets.values()].map((b) => ({
      day: b.day,
      slips: b.slips,
      containers: b.containers,
      estKg: Math.round(b.estKg * 100) / 100,
      actualKg: Math.round(b.actualKg * 100) / 100,
    }));

    if (q.format === "csv") {
      const headers = ["day", "slips_packed", "containers_sealed", "est_weight_kg", "actual_weight_kg"];
      const csvRows = rows.map((r) => [r.day, r.slips, r.containers, r.estKg, r.actualKg]);
      reply.header("Content-Type", "text/csv; charset=utf-8");
      reply.header(
        "Content-Disposition",
        csvAttachment(`pack-throughput-${days}d.csv`)
      );
      return toCsv(headers, csvRows);
    }

    return {
      rangeStart: start,
      days,
      totals: {
        slips: rows.reduce((s, r) => s + r.slips, 0),
        containers: rows.reduce((s, r) => s + r.containers, 0),
        estKg: Math.round(rows.reduce((s, r) => s + r.estKg, 0) * 100) / 100,
        actualKg: Math.round(rows.reduce((s, r) => s + r.actualKg, 0) * 100) / 100,
      },
      rows,
    };
  });
};
