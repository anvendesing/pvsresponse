/**
 * Odoo-style work orders from BOM operations (mrp.bom.operation → mrp.workorder).
 */
import type { PrismaClient } from "@prisma/client";
import {
  loadMoByproductContext,
  postMoByproductEntries,
  type MoByproductEntry,
} from "./mo-byproduct-post.js";

type Db = PrismaClient;

export type RunByproductPatch = { bomByproductId: string; qty: number };

const woDone = (status: string, qaStatus: string | null) =>
  status === "complete" && (qaStatus === "pass" || qaStatus === null);

/** Create work orders when an MO is created — one WO per operation by default. */
export async function createWorkOrdersFromBom(
  db: Db,
  opts: {
    productionOrderId: string;
    orderNo: string;
    plannedQty: number;
    station: string;
    machine: string;
    defaultLineId: string | null;
    bomId: string;
  }
) {
  const operations = await db.bomOperation.findMany({
    where: { bomId: opts.bomId },
    orderBy: { seq: "asc" },
  });

  if (operations.length === 0) {
    await db.workOrder.create({
      data: {
        workOrderNo: `${opts.orderNo}/1`,
        productionOrderId: opts.productionOrderId,
        station: opts.station,
        machine: opts.machine,
        workers: "",
        target: opts.plannedQty,
        lineId: opts.defaultLineId,
        status: "ready",
      },
    });
    return;
  }

  for (const op of operations) {
    const initialStatus = op.blockedByOperationId ? "waiting" : "ready";
    await db.workOrder.create({
      data: {
        workOrderNo: `${opts.orderNo}/${op.seq}`,
        productionOrderId: opts.productionOrderId,
        station: opts.station,
        machine: opts.machine,
        workers: "",
        target: opts.plannedQty,
        plannedSplitQty: opts.plannedQty,
        bomOperationId: op.id,
        splitSeq: 0,
        lineId: op.lineId ?? opts.defaultLineId,
        machineId: op.machineId,
        status: initialStatus,
      },
    });
  }
}

/** Split one operation across multiple lines/machines (parallel extraction). */
export async function splitOperationWorkOrders(
  db: Db,
  opts: {
    productionOrderId: string;
    orderNo: string;
    bomOperationId: string;
    plannedQty: number;
    station: string;
    machine: string;
    splits: Array<{ lineId: string; machineId?: string | null; qty: number }>;
  }
) {
  const op = await db.bomOperation.findUnique({
    where: { id: opts.bomOperationId },
  });
  if (!op) throw new Error("Operation not found");

  const sum = opts.splits.reduce((s, x) => s + x.qty, 0);
  if (Math.abs(sum - opts.plannedQty) > 0.001) {
    throw new Error(
      `Split quantities (${sum}) must equal MO planned qty (${opts.plannedQty}).`
    );
  }

  const existing = await db.workOrder.findFirst({
    where: {
      productionOrderId: opts.productionOrderId,
      bomOperationId: opts.bomOperationId,
    },
  });
  const initialStatus =
    existing?.status === "waiting" || op.blockedByOperationId ? "waiting" : "ready";

  await db.workOrder.deleteMany({
    where: {
      productionOrderId: opts.productionOrderId,
      bomOperationId: opts.bomOperationId,
    },
  });

  const letters = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < opts.splits.length; i++) {
    const sp = opts.splits[i]!;
    const suffix = opts.splits.length > 1 ? letters[i] ?? String(i) : "";
    await db.workOrder.create({
      data: {
        workOrderNo: `${opts.orderNo}/${op.seq}${suffix}`,
        productionOrderId: opts.productionOrderId,
        station: opts.station,
        machine: opts.machine,
        workers: "",
        target: sp.qty,
        plannedSplitQty: sp.qty,
        bomOperationId: op.id,
        splitSeq: i,
        lineId: sp.lineId,
        machineId: sp.machineId ?? null,
        status: initialStatus,
      },
    });
  }

  await refreshWaitingReady(db, opts.productionOrderId);
}

/**
 * Has any material been issued against this MO? Source of truth is
 * the stock ledger - any consumption row (qty<0) ref'd by the MO's
 * orderNo means materials were issued. We use this as the hard gate
 * for starting / completing work orders so the shop floor can't
 * record output against a run that never actually pulled stock.
 */
async function materialsIssuedForMo(
  db: Db,
  productionOrderId: string
): Promise<{ issued: boolean; orderNo: string }> {
  const po = await db.productionOrder.findUnique({
    where: { id: productionOrderId },
    select: { orderNo: true, bomId: true },
  });
  if (!po) throw new Error("Production order not found");

  // Skip the gate for BOMs that have no consumable components - rare,
  // but valid for service-only BOMs (e.g. an inspection or labelling
  // operation that doesn't consume any raw material). Without this
  // escape hatch such MOs could never run.
  const componentCount = await db.bomItem.count({
    where: { bomId: po.bomId },
  });
  if (componentCount === 0) return { issued: true, orderNo: po.orderNo };

  const consumed = await db.stockLedger.count({
    where: { ref: po.orderNo, qty: { lt: 0 } },
  });
  return { issued: consumed > 0, orderNo: po.orderNo };
}

export async function startWorkOrder(db: Db, woId: string) {
  const wo = await db.workOrder.findUnique({ where: { id: woId } });
  if (!wo) throw new Error("Work order not found");
  if (wo.status !== "ready" && wo.status !== "queued" && wo.status !== "rework") {
    throw new Error(`Cannot start work order in status ${wo.status}`);
  }
  const { issued, orderNo } = await materialsIssuedForMo(
    db,
    wo.productionOrderId
  );
  if (!issued) {
    throw new Error(
      `Issue materials to MO ${orderNo} before starting work orders.`
    );
  }
  return db.workOrder.update({
    where: { id: woId },
    data: { status: "running", startTime: wo.startTime ?? new Date() },
  });
}

/**
 * When an operator marks a WO Done without logging machine batches, record one
 * completed batch at 100% of the step target using the assigned line/machine.
 * Exact weights and by-products stay at MO completion — this is cycle progress only.
 */
async function ensureDefaultRunOnComplete(
  db: Db,
  wo: {
    id: string;
    machineId: string | null;
    lineId: string | null;
    plannedSplitQty: number | null;
    target: number;
    startTime: Date | null;
  }
) {
  const runCount = await db.workOrderRun.count({ where: { workOrderId: wo.id } });
  if (runCount > 0) return;

  const qty = wo.plannedSplitQty ?? wo.target;
  if (qty <= 0) return;

  const now = new Date();

  if (wo.machineId) {
    await db.workOrderRun.create({
      data: {
        workOrderId: wo.id,
        machineId: wo.machineId,
        lineId: wo.lineId,
        batchSeq: 1,
        plannedQty: qty,
        goodQty: qty,
        scrapQty: 0,
        inputQty: 0,
        status: "complete",
        startTime: wo.startTime ?? now,
        endTime: now,
      },
    });
    await recomputeWorkOrderFromRuns(db, wo.id);
    return;
  }

  await db.workOrder.update({
    where: { id: wo.id },
    data: { output: Math.round(qty * 1000) / 1000 },
  });
}

/** Mark WO done; if QA required, hold until QA pass before unblocking successors. */
export async function completeWorkOrder(db: Db, woId: string) {
  const wo = await db.workOrder.findUnique({
    where: { id: woId },
    include: { bomOperation: { select: { requiresQa: true } } },
  });
  if (!wo) throw new Error("Work order not found");
  if (wo.status === "waiting") {
    throw new Error("Work order is waiting for a predecessor operation.");
  }
  const { issued, orderNo } = await materialsIssuedForMo(
    db,
    wo.productionOrderId
  );
  if (!issued) {
    throw new Error(
      `Issue materials to MO ${orderNo} before completing work orders.`
    );
  }

  await ensureDefaultRunOnComplete(db, wo);

  const needsQa = wo.bomOperation?.requiresQa ?? false;
  await db.workOrder.update({
    where: { id: woId },
    data: {
      status: "complete",
      qaStatus: needsQa ? "pending" : "pass",
      endTime: new Date(),
    },
  });

  if (!needsQa) {
    await refreshWaitingReady(db, wo.productionOrderId);
  }
  return { needsQa };
}

/** Odoo-style quality.check — pass unblocks successors; fail reopens this step for rework. */
export async function recordWorkOrderQa(
  db: Db,
  woId: string,
  pass: boolean,
  notes?: string
) {
  const wo = await db.workOrder.findUnique({
    where: { id: woId },
    include: { bomOperation: true },
  });
  if (!wo) throw new Error("Work order not found");
  if (wo.qaStatus !== "pending") {
    throw new Error("Work order is not awaiting QA.");
  }

  if (pass) {
    await db.workOrder.update({
      where: { id: woId },
      data: { qaStatus: "pass", qaNotes: notes ?? null },
    });
    await refreshWaitingReady(db, wo.productionOrderId);
    return { action: "passed" as const };
  }

  // QA failed — rework the step that failed inspection, not its predecessor.
  await db.workOrder.update({
    where: { id: woId },
    data: {
      qaStatus: "fail",
      qaNotes: notes ?? null,
      status: "rework",
      endTime: null,
    },
  });

  await db.productionOrder.update({
    where: { id: wo.productionOrderId },
    data: { reworkQty: { increment: wo.output || 1 } },
  });

  // Re-block all operations after the failed step until this one passes QA.
  if (wo.bomOperationId) {
    const laterOps = await db.bomOperation.findMany({
      where: {
        bomId: wo.bomOperation!.bomId,
        seq: { gt: wo.bomOperation!.seq },
      },
      select: { id: true },
    });
    if (laterOps.length > 0) {
      await db.workOrder.updateMany({
        where: {
          productionOrderId: wo.productionOrderId,
          bomOperationId: { in: laterOps.map((o) => o.id) },
        },
        data: { status: "waiting" },
      });
    }
  }

  return { action: "failed_reopened_current" as const };
}

/** Unblock WOs when all predecessor-operation WOs are complete (+ QA pass). */
async function refreshWaitingReady(db: Db, productionOrderId: string) {
  const wos = await db.workOrder.findMany({
    where: { productionOrderId },
    include: { bomOperation: { select: { blockedByOperationId: true } } },
  });

  for (const wo of wos) {
    if (wo.status !== "waiting") continue;
    const predOpId = wo.bomOperation?.blockedByOperationId;
    if (!predOpId) {
      await db.workOrder.update({ where: { id: wo.id }, data: { status: "ready" } });
      continue;
    }
    const preds = wos.filter((w) => w.bomOperationId === predOpId);
    if (preds.length === 0) continue;
    if (preds.every((p) => woDone(p.status, p.qaStatus))) {
      await db.workOrder.update({ where: { id: wo.id }, data: { status: "ready" } });
    }
  }
}

/** Supervisor assigns a work order to a production line and optional machine. */
export async function assignWorkOrderLineMachine(
  db: Db,
  opts: {
    productionOrderId: string;
    workOrderId: string;
    lineId?: string;
    machineId?: string | null;
  }
) {
  const wo = await db.workOrder.findFirst({
    where: { id: opts.workOrderId, productionOrderId: opts.productionOrderId },
    include: {
      productionOrder: { select: { facilityId: true, status: true } },
    },
  });
  if (!wo) {
    throw Object.assign(new Error("Work order not found on this MO."), { statusCode: 404 });
  }
  if (wo.productionOrder.status === "completed") {
    throw Object.assign(new Error("MO is already completed."), { statusCode: 409 });
  }
  if (wo.status === "running" || wo.status === "complete") {
    throw Object.assign(
      new Error(`Cannot reassign line/machine while work order is ${wo.status}.`),
      { statusCode: 409 }
    );
  }

  const lineId = opts.lineId ?? wo.lineId;
  if (!lineId && opts.machineId) {
    throw Object.assign(new Error("Select a production line before choosing a machine."), {
      statusCode: 400,
    });
  }

  if (opts.lineId) {
    const line = await db.productionLine.findUnique({
      where: { id: opts.lineId },
      select: { id: true, facilityId: true, name: true },
    });
    if (!line) {
      throw Object.assign(new Error("Production line not found."), { statusCode: 404 });
    }
    if (wo.productionOrder.facilityId && line.facilityId !== wo.productionOrder.facilityId) {
      throw Object.assign(
        new Error(`Line "${line.name}" does not belong to this MO's facility.`),
        { statusCode: 400 }
      );
    }
  }

  let machineName = wo.machine;
  let machineId: string | null | undefined = opts.machineId;

  if (opts.machineId !== undefined) {
    if (opts.machineId === null) {
      machineId = null;
      machineName = "—";
    } else {
      const machine = await db.machine.findUnique({
        where: { id: opts.machineId },
        select: { id: true, name: true, productionLineId: true, active: true },
      });
      if (!machine || !machine.active) {
        throw Object.assign(new Error("Machine not found or inactive."), { statusCode: 404 });
      }
      if (lineId && machine.productionLineId !== lineId) {
        throw Object.assign(
          new Error("Selected machine does not belong to the chosen production line."),
          { statusCode: 400 }
        );
      }
      machineId = machine.id;
      machineName = machine.name;
    }
  }

  return db.workOrder.update({
    where: { id: wo.id },
    data: {
      ...(opts.lineId ? { lineId: opts.lineId } : {}),
      ...(opts.machineId !== undefined ? { machineId, machine: machineName } : {}),
    },
    include: {
      bomOperation: { select: { id: true, seq: true, name: true, requiresQa: true } },
      line: { select: { id: true, code: true, name: true } },
      machineRef: { select: { id: true, code: true, name: true } },
      runs: { include: { machine: { select: { id: true, code: true, name: true } }, line: { select: { id: true, code: true, name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
}

// =====================================================================
// Multi-machine parallel runs inside a single WorkOrder
// =====================================================================
//
// Real shop floors run a single operation step (e.g. "Extraction") on
// multiple parallel machines (two screw presses, three extruders) and
// each machine consumes part of the input + produces part of the output.
// A WO with zero runs keeps legacy single-machine behavior. A WO with
// >=1 run rolls up its `output` from sum(runs.goodQty) — the operator
// never types the WO total directly; they log each machine run.

type RunStatus = "queued" | "running" | "complete" | "abandoned";

const VALID_RUN_STATUSES: RunStatus[] = ["queued", "running", "complete", "abandoned"];

const runInclude = {
  machine: { select: { id: true, code: true, name: true, productionLineId: true } },
  line: { select: { id: true, code: true, name: true } },
  byproducts: {
    include: {
      bomByproduct: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true } },
          variant: { select: { id: true, sku: true, size: true } },
        },
      },
    },
  },
};

async function syncRunByproductDrafts(
  db: Db,
  runId: string,
  entries: RunByproductPatch[]
) {
  const keepIds = entries.filter((e) => e.qty > 0).map((e) => e.bomByproductId);
  if (keepIds.length === 0) {
    await db.workOrderRunByproduct.deleteMany({
      where: { workOrderRunId: runId, posted: false },
    });
  } else {
    await db.workOrderRunByproduct.deleteMany({
      where: {
        workOrderRunId: runId,
        posted: false,
        bomByproductId: { notIn: keepIds },
      },
    });
  }
  for (const e of entries) {
    if (e.qty <= 0) {
      await db.workOrderRunByproduct.deleteMany({
        where: {
          workOrderRunId: runId,
          bomByproductId: e.bomByproductId,
          posted: false,
        },
      });
      continue;
    }
    await db.workOrderRunByproduct.upsert({
      where: {
        workOrderRunId_bomByproductId: {
          workOrderRunId: runId,
          bomByproductId: e.bomByproductId,
        },
      },
      create: {
        workOrderRunId: runId,
        bomByproductId: e.bomByproductId,
        qty: e.qty,
        posted: false,
      },
      update: { qty: e.qty },
    });
  }
}

async function applyRunOutputToMo(
  db: Db,
  productionOrderId: string,
  goodDelta: number,
  scrapDelta: number
) {
  if (goodDelta === 0 && scrapDelta === 0) return;
  const po = await db.productionOrder.findUnique({ where: { id: productionOrderId } });
  if (!po || po.status === "completed") return;
  const newActual = Math.max(0, po.actualQty + goodDelta);
  const newScrap = Math.max(0, po.scrapQty + scrapDelta);
  await db.productionOrder.update({
    where: { id: productionOrderId },
    data: {
      actualQty: newActual,
      scrapQty: newScrap,
      status: po.status === "planned" && newActual > 0 ? "in-progress" : po.status,
      efficiency:
        po.plannedQty > 0
          ? Math.round((newActual / po.plannedQty) * 1000) / 10
          : po.efficiency,
    },
  });
}

async function maybeSetMachineIdle(db: Db, machineId: string) {
  const stillRunning = await db.workOrderRun.count({
    where: { machineId, status: "running" },
  });
  if (stillRunning > 0) return;
  const m = await db.machine.findUnique({
    where: { id: machineId },
    select: { status: true },
  });
  if (m?.status === "running") {
    await db.machine.update({ where: { id: machineId }, data: { status: "idle" } });
  }
}

async function recomputeWorkOrderFromRuns(db: Db, workOrderId: string) {
  const runs = await db.workOrderRun.findMany({
    where: { workOrderId },
    select: { goodQty: true, scrapQty: true, status: true, startTime: true, endTime: true },
  });
  if (runs.length === 0) return; // no runs → WO output stays operator-managed
  const goodSum = runs.reduce((s, r) => s + (r.goodQty ?? 0), 0);
  const anyRunning = runs.some((r) => r.status === "running");
  const allDone =
    runs.length > 0 && runs.every((r) => r.status === "complete" || r.status === "abandoned");
  const earliestStart = runs
    .map((r) => r.startTime)
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const latestEnd = allDone
    ? runs
        .map((r) => r.endTime)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0]
    : null;

  const wo = await db.workOrder.findUnique({ where: { id: workOrderId } });
  if (!wo) return;
  // Hybrid policy: rollup overrides output only when runs exist; status
  // moves to "running" when any run starts; WO is auto-marked
  // "complete" only when every run is done AND target is satisfied.
  const next: {
    output: number;
    status?: string;
    startTime?: Date | null;
    endTime?: Date | null;
  } = { output: Math.round(goodSum * 1000) / 1000 };
  if (anyRunning && wo.status === "ready") next.status = "running";
  if (anyRunning && !wo.startTime && earliestStart) next.startTime = earliestStart;
  if (allDone && wo.status !== "complete" && goodSum >= wo.target * 0.999) {
    // leave QA path to completeWorkOrder() — don't auto-flip status; just
    // surface a "ready-to-close" signal via output ≥ target.
  }
  if (latestEnd && wo.endTime == null && wo.status === "complete") next.endTime = latestEnd;
  await db.workOrder.update({ where: { id: workOrderId }, data: next });
}

async function loadRunWorkOrder(db: Db, workOrderId: string) {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      productionOrder: { select: { id: true, status: true, facilityId: true, orderNo: true } },
    },
  });
  if (!wo) throw Object.assign(new Error("Work order not found."), { statusCode: 404 });
  if (wo.productionOrder.status === "completed") {
    throw Object.assign(new Error("MO is already completed."), { statusCode: 409 });
  }
  return wo;
}

export async function addWorkOrderRun(
  db: Db,
  opts: {
    workOrderId: string;
    machineId: string;
    lineId?: string | null;
    plannedQty?: number | null;
    operator?: string | null;
  }
) {
  const wo = await loadRunWorkOrder(db, opts.workOrderId);
  const machine = await db.machine.findUnique({
    where: { id: opts.machineId },
    select: { id: true, name: true, productionLineId: true, active: true },
  });
  if (!machine || !machine.active) {
    throw Object.assign(new Error("Machine not found or inactive."), { statusCode: 404 });
  }
  const lineId = opts.lineId ?? machine.productionLineId ?? wo.lineId ?? null;
  if (lineId) {
    const line = await db.productionLine.findUnique({
      where: { id: lineId },
      select: { id: true, facilityId: true },
    });
    if (!line) throw Object.assign(new Error("Line not found."), { statusCode: 404 });
    if (wo.productionOrder.facilityId && line.facilityId !== wo.productionOrder.facilityId) {
      throw Object.assign(new Error("Line is in a different facility."), { statusCode: 400 });
    }
    if (machine.productionLineId && machine.productionLineId !== lineId) {
      throw Object.assign(
        new Error("Machine does not belong to the selected line."),
        { statusCode: 400 }
      );
    }
  }
  const activeOnMachine = await db.workOrderRun.findFirst({
    where: {
      workOrderId: wo.id,
      machineId: machine.id,
      status: { in: ["queued", "running"] },
    },
    select: { id: true, batchSeq: true },
  });
  if (activeOnMachine) {
    throw Object.assign(
      new Error(
        `Machine ${machine.name} already has batch #${activeOnMachine.batchSeq} in progress. Complete or abandon it before starting another batch on this machine.`
      ),
      { statusCode: 409, code: "machine_run_active" }
    );
  }
  const maxBatch = await db.workOrderRun.aggregate({
    where: { workOrderId: wo.id },
    _max: { batchSeq: true },
  });
  const created = await db.workOrderRun.create({
    data: {
      workOrderId: wo.id,
      machineId: machine.id,
      lineId,
      batchSeq: (maxBatch._max.batchSeq ?? 0) + 1,
      plannedQty: opts.plannedQty ?? null,
      operator: opts.operator?.trim() || null,
      status: "queued",
    },
    include: runInclude,
  });
  await recomputeWorkOrderFromRuns(db, wo.id);
  return created;
}

async function loadRun(db: Db, workOrderId: string, runId: string) {
  const run = await db.workOrderRun.findFirst({
    where: { id: runId, workOrderId },
  });
  if (!run) throw Object.assign(new Error("Run not found on this WO."), { statusCode: 404 });
  return run;
}

export async function startWorkOrderRun(db: Db, workOrderId: string, runId: string) {
  const wo = await loadRunWorkOrder(db, workOrderId);
  const run = await loadRun(db, wo.id, runId);
  if (run.status === "running") return run;
  if (run.status === "complete" || run.status === "abandoned") {
    throw Object.assign(new Error(`Run is already ${run.status}.`), { statusCode: 409 });
  }
  const { issued, orderNo } = await materialsIssuedForMo(db, wo.productionOrderId);
  if (!issued) {
    throw Object.assign(
      new Error(`Issue materials to MO ${orderNo} before starting any run.`),
      { statusCode: 409 }
    );
  }
  const updated = await db.workOrderRun.update({
    where: { id: run.id },
    data: { status: "running", startTime: run.startTime ?? new Date() },
    include: runInclude,
  });
  // Mark machine running so the Production Lines panel reflects it.
  await db.machine.update({ where: { id: run.machineId }, data: { status: "running" } });
  await recomputeWorkOrderFromRuns(db, wo.id);
  return updated;
}

export async function logWorkOrderRun(
  db: Db,
  workOrderId: string,
  runId: string,
  patch: {
    goodQty?: number;
    scrapQty?: number;
    inputQty?: number;
    notes?: string | null;
    operator?: string | null;
    byproducts?: RunByproductPatch[];
  }
) {
  const wo = await loadRunWorkOrder(db, workOrderId);
  const run = await loadRun(db, wo.id, runId);
  if (run.status === "abandoned") {
    throw Object.assign(new Error("Run is abandoned — cannot log output."), { statusCode: 409 });
  }
  if (patch.byproducts?.length) {
    const { bpById } = await loadMoByproductContext(db, wo.productionOrderId);
    for (const entry of patch.byproducts) {
      if (entry.qty <= 0) continue;
      if (!bpById.has(entry.bomByproductId)) {
        throw Object.assign(
          new Error(`Byproduct ${entry.bomByproductId} is not on this MO's BOM.`),
          { statusCode: 400, code: "byproduct_not_on_bom" }
        );
      }
    }
    await syncRunByproductDrafts(db, run.id, patch.byproducts);
  }
  const updated = await db.workOrderRun.update({
    where: { id: run.id },
    data: {
      ...(patch.goodQty !== undefined ? { goodQty: Math.max(0, patch.goodQty) } : {}),
      ...(patch.scrapQty !== undefined ? { scrapQty: Math.max(0, patch.scrapQty) } : {}),
      ...(patch.inputQty !== undefined ? { inputQty: Math.max(0, patch.inputQty) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.operator !== undefined ? { operator: patch.operator?.trim() || null } : {}),
    },
    include: runInclude,
  });
  await recomputeWorkOrderFromRuns(db, wo.id);
  return updated;
}

export async function completeWorkOrderRun(
  db: Db,
  workOrderId: string,
  runId: string,
  patch: {
    goodQty?: number;
    scrapQty?: number;
    inputQty?: number;
    notes?: string | null;
    byproducts?: RunByproductPatch[];
  }
) {
  const wo = await loadRunWorkOrder(db, workOrderId);
  const run = await loadRun(db, wo.id, runId);
  if (run.status === "complete") {
    return db.workOrderRun.findUniqueOrThrow({
      where: { id: run.id },
      include: runInclude,
    });
  }
  if (run.status === "abandoned") {
    throw Object.assign(new Error("Run is abandoned — cannot complete."), { statusCode: 409 });
  }

  const prevGood = run.goodQty;
  const prevScrap = run.scrapQty;

  if (patch.byproducts?.length) {
    await syncRunByproductDrafts(db, run.id, patch.byproducts);
  }

  const updated = await db.workOrderRun.update({
    where: { id: run.id },
    data: {
      status: "complete",
      endTime: new Date(),
      startTime: run.startTime ?? new Date(),
      ...(patch.goodQty !== undefined ? { goodQty: Math.max(0, patch.goodQty) } : {}),
      ...(patch.scrapQty !== undefined ? { scrapQty: Math.max(0, patch.scrapQty) } : {}),
      ...(patch.inputQty !== undefined ? { inputQty: Math.max(0, patch.inputQty) } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
    },
    include: runInclude,
  });

  const goodDelta = updated.goodQty - prevGood;
  const scrapDelta = updated.scrapQty - prevScrap;
  await applyRunOutputToMo(db, wo.productionOrderId, goodDelta, scrapDelta);

  const alreadyPosted = await db.workOrderRunByproduct.count({
    where: { workOrderRunId: run.id, posted: true, qty: { gt: 0 } },
  });
  if (alreadyPosted === 0) {
    const draftRows = await db.workOrderRunByproduct.findMany({
      where: { workOrderRunId: run.id, posted: false, qty: { gt: 0 } },
    });
    const entries: MoByproductEntry[] =
      patch.byproducts?.filter((b) => b.qty > 0) ??
      draftRows.map((d) => ({ bomByproductId: d.bomByproductId, qty: d.qty }));
    if (entries.length > 0) {
      const { bpById, landingWhId, orderNo } = await loadMoByproductContext(
        db,
        wo.productionOrderId
      );
      await postMoByproductEntries(db, {
        productionOrderId: wo.productionOrderId,
        orderNo,
        landingWhId,
        entries,
        bpById,
      });
      await db.workOrderRunByproduct.updateMany({
        where: { workOrderRunId: run.id },
        data: { posted: true },
      });
    }
  }

  await maybeSetMachineIdle(db, run.machineId);
  await recomputeWorkOrderFromRuns(db, wo.id);
  return db.workOrderRun.findUniqueOrThrow({
    where: { id: run.id },
    include: runInclude,
  });
}

export async function abandonWorkOrderRun(db: Db, workOrderId: string, runId: string) {
  const wo = await loadRunWorkOrder(db, workOrderId);
  const run = await loadRun(db, wo.id, runId);
  if (run.status === "complete") {
    throw Object.assign(new Error("Cannot abandon a completed run."), { statusCode: 409 });
  }
  const updated = await db.workOrderRun.update({
    where: { id: run.id },
    data: { status: "abandoned", endTime: new Date() },
    include: runInclude,
  });
  await recomputeWorkOrderFromRuns(db, wo.id);
  return updated;
}

export async function deleteWorkOrderRun(db: Db, workOrderId: string, runId: string) {
  const wo = await loadRunWorkOrder(db, workOrderId);
  const run = await loadRun(db, wo.id, runId);
  if (run.status === "running") {
    throw Object.assign(new Error("Abandon the run before deleting."), { statusCode: 409 });
  }
  await db.workOrderRun.delete({ where: { id: run.id } });
  await recomputeWorkOrderFromRuns(db, wo.id);
  return { id: run.id };
}

export const RUN_STATUSES = VALID_RUN_STATUSES;
