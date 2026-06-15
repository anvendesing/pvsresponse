// Stock rule engine: when a monitored bin falls below minQty, auto-create
// a production order (mo) or replenishment transfer (transfer).

import { db } from "../db.js";
import { recordChange } from "../sync/log.js";

export type StockRuleTriggerResult = {
  ruleId: string;
  triggerType: string;
  created: { type: "mo" | "transfer"; id: string; documentNo: string } | null;
  skippedReason?: string;
};

const nextTransferNo = async (): Promise<string> => {
  const year = new Date().getUTCFullYear();
  const prefix = `TRF-${year}-`;
  const last = await db.transferOrder.findFirst({
    where: { transferNo: { startsWith: prefix } },
    orderBy: { transferNo: "desc" },
    select: { transferNo: true },
  });
  const n = last
    ? parseInt(last.transferNo.split("-").pop() ?? "2200", 10) + 1
    : 2201;
  return `${prefix}${String(n).padStart(4, "0")}`;
};

const nextMoNo = async (): Promise<string> => {
  const last = await db.productionOrder.findFirst({
    where: { orderNo: { startsWith: "MO-2026-" } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  const n = last
    ? parseInt(last.orderNo.split("-").pop() ?? "2200", 10) + 1
    : 2201;
  return `MO-2026-${String(n).padStart(4, "0")}`;
};

const ruleMarker = (ruleId: string) => `StockRule:${ruleId}`;

const hasOpenMoForBom = async (bomId: string) => {
  const open = await db.productionOrder.findFirst({
    where: {
      bomId,
      status: { in: ["planned", "in-progress", "qc", "delayed"] },
    },
    select: { id: true },
  });
  return !!open;
};

const hasOpenTransferForRule = async (ruleId: string) => {
  const marker = ruleMarker(ruleId);
  const open = await db.transferOrder.findFirst({
    where: {
      status: { in: ["draft", "ready", "in_transit"] },
      notes: { contains: marker },
    },
    select: { id: true },
  });
  return !!open;
};

const createAutoMo = async (
  rule: {
    id: string;
    bomId: string | null;
    bom: {
      id: string;
      outputQty: number;
      defaultFacilityId: string | null;
      defaultFacility: { id: string; name: string } | null;
      defaultLineId: string | null;
      defaultMachine: { name: string } | null;
    } | null;
  },
  userId: string | null
) => {
  if (!rule.bomId || !rule.bom) {
    return { created: null, skippedReason: "no_bom" } as const;
  }
  if (!rule.bom.defaultFacilityId) {
    return { created: null, skippedReason: "no_default_facility" } as const;
  }
  if (await hasOpenMoForBom(rule.bomId)) {
    return { created: null, skippedReason: "open_mo_exists" } as const;
  }
  const plannedQty = Math.max(1, Math.round(rule.bom.outputQty));
  const station = rule.bom.defaultFacility?.name ?? "Assembly 1";
  const machine = rule.bom.defaultMachine?.name ?? "—";
  const orderNo = await nextMoNo();
  const due = new Date();
  due.setDate(due.getDate() + 7);
  const created = await db.productionOrder.create({
    data: {
      orderNo,
      bomId: rule.bom.id,
      station,
      facilityId: rule.bom.defaultFacilityId,
      lineId: rule.bom.defaultLineId ?? null,
      plannedQty,
      startDate: new Date(),
      dueDate: due,
    },
  });
  await db.workOrder.create({
    data: {
      workOrderNo: `${orderNo}/1`,
      productionOrderId: created.id,
      station,
      machine,
      workers: "",
      target: plannedQty,
      lineId: rule.bom.defaultLineId ?? null,
    },
  });
  await recordChange("ProductionOrder", created.id, "insert", created, userId);
  return {
    created: { type: "mo" as const, id: created.id, documentNo: orderNo },
  };
};

const createAutoTransfer = async (
  rule: {
    id: string;
    minQty: number;
    tags: string | null;
    productId: string;
    variantId: string | null;
    monitorBinId: string;
    sourceBinId: string | null;
    toBinId: string | null;
    toWarehouseId: string | null;
    monitorBin: {
      warehouseId: string;
      qty: number;
    };
    sourceBin: {
      id: string;
      warehouseId: string;
      productId: string | null;
      qty: number;
    } | null;
    toBin: { id: string; warehouseId: string } | null;
  },
  userId: string | null
) => {
  if (!rule.sourceBinId || !rule.sourceBin) {
    return { created: null, skippedReason: "no_source_bin" } as const;
  }
  if (await hasOpenTransferForRule(rule.id)) {
    return { created: null, skippedReason: "open_transfer_exists" } as const;
  }
  const destBinId = rule.toBinId ?? rule.monitorBinId;
  const destWhId =
    rule.toWarehouseId ??
    rule.toBin?.warehouseId ??
    rule.monitorBin.warehouseId;
  const shortage = Math.max(0, rule.minQty - rule.monitorBin.qty);
  const available = Math.max(0, rule.sourceBin.qty);
  const qtyRequested = Math.max(1, Math.ceil(shortage > 0 ? shortage : rule.minQty));
  const qty = Math.min(qtyRequested, available);
  if (qty <= 0) {
    return { created: null, skippedReason: "source_empty" } as const;
  }

  const transferNo = await nextTransferNo();
  const toOrder = await db.transferOrder.create({
    data: {
      transferNo,
      kind: "replenishment",
      status: "ready",
      fromWarehouseId: rule.sourceBin.warehouseId,
      toWarehouseId: destWhId,
      notes: `${ruleMarker(rule.id)} auto-replenish transfer`,
      tags: rule.tags,
      items: {
        create: [
          {
            productId: rule.sourceBin.productId ?? rule.productId,
            variantId: rule.variantId,
            qtyRequested: qty,
            fromBinId: rule.sourceBin.id,
            toBinId: destBinId,
          },
        ],
      },
    },
  });
  await recordChange("TransferOrder", toOrder.id, "insert", toOrder, userId);
  return {
    created: {
      type: "transfer" as const,
      id: toOrder.id,
      documentNo: transferNo,
    },
  };
};

/** Evaluate all active rules watching this bin; create MO/TO when below min. */
export const checkStockRules = async (
  binId: string,
  userId: string | null
): Promise<StockRuleTriggerResult[]> => {
  const bin = await db.bin.findUnique({
    where: { id: binId },
    select: { id: true, qty: true, warehouseId: true },
  });
  if (!bin) return [];

  const rules = await db.stockRule.findMany({
    where: { monitorBinId: binId, active: true },
    include: {
      bom: {
        include: {
          defaultFacility: { select: { id: true, name: true } },
          defaultMachine: { select: { name: true } },
        },
      },
      monitorBin: { select: { warehouseId: true, qty: true } },
      sourceBin: {
        select: { id: true, warehouseId: true, productId: true, qty: true },
      },
      toBin: { select: { id: true, warehouseId: true } },
    },
  });

  const results: StockRuleTriggerResult[] = [];

  for (const rule of rules) {
    const currentQty = bin.qty;
    if (currentQty >= rule.minQty) {
      results.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        created: null,
        skippedReason: "above_min",
      });
      continue;
    }

    if (rule.triggerType === "mo") {
      const out = await createAutoMo(rule, userId);
      results.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        created: out.created,
        skippedReason: out.skippedReason,
      });
    } else if (rule.triggerType === "transfer") {
      const out = await createAutoTransfer(
        {
          ...rule,
          monitorBin: { warehouseId: bin.warehouseId, qty: currentQty },
        },
        userId
      );
      results.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        created: out.created,
        skippedReason: out.skippedReason,
      });
    } else {
      results.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        created: null,
        skippedReason: "unknown_trigger",
      });
    }
  }

  return results;
};

/** Run checkStockRules for every distinct monitor bin on active rules. */
export const checkAllStockRules = async (userId: string | null) => {
  const rules = await db.stockRule.findMany({
    where: { active: true },
    select: { monitorBinId: true },
    distinct: ["monitorBinId"],
  });
  const all: StockRuleTriggerResult[] = [];
  for (const r of rules) {
    const part = await checkStockRules(r.monitorBinId, userId);
    all.push(...part);
  }
  return all;
};
