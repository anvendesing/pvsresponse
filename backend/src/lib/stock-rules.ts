// Stock rule engine: when stock falls below minQty, auto-create MO,
// replenishment transfer, or draft PO (grouped by vendor).

import { db } from "../db.js";
import { recordChange } from "../sync/log.js";
import { nextPoNo, resolvePoLine, type ResolvedPoLine } from "./po-lines.js";
import {
  getEffectiveBinStock,
  getEffectiveProductStock,
} from "./stock-rule-pipeline.js";

export type StockRuleTriggerResult = {
  ruleId: string;
  triggerType: string;
  created: { type: "mo" | "transfer" | "po"; id: string; documentNo: string } | null;
  skippedReason?: string;
};

const AUTO_PO_MARKER = "StockRule:auto";

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

const findOpenAutoPo = async (vendorId: string) =>
  db.purchaseOrder.findFirst({
    where: {
      vendorId,
      status: "draft",
      notes: { contains: AUTO_PO_MARKER },
    },
    include: { items: true },
  });

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

const computeVendorOrderQty = (
  rule: { minQty: number; maxQty: number | null; orderMultiple: number | null },
  currentQty: number,
  catalog: { packSize: number; minOrderQty: number }
): number => {
  const target = rule.maxQty ?? rule.minQty * 2;
  let internalNeed = Math.max(0, target - currentQty);
  if (internalNeed <= 0) internalNeed = rule.minQty;
  let vendorQty = internalNeed / Math.max(catalog.packSize, 0.0001);
  if (rule.orderMultiple && rule.orderMultiple > 0) {
    vendorQty = Math.ceil(vendorQty / rule.orderMultiple) * rule.orderMultiple;
  } else {
    vendorQty = Math.ceil(vendorQty * 1000) / 1000;
  }
  return Math.max(vendorQty, catalog.minOrderQty);
};

type PoRuleRow = {
  id: string;
  productId: string;
  variantId: string | null;
  minQty: number;
  maxQty: number | null;
  orderMultiple: number | null;
  vendorId: string | null;
};

/** Evaluate global PO rules; one draft PO per vendor with all low lines. */
export const checkGlobalPoStockRules = async (
  userId: string | null
): Promise<StockRuleTriggerResult[]> => {
  const rules = await db.stockRule.findMany({
    where: { active: true, triggerType: "po", monitorBinId: null },
    select: {
      id: true,
      productId: true,
      variantId: true,
      minQty: true,
      maxQty: true,
      orderMultiple: true,
      vendorId: true,
    },
    orderBy: [{ vendorId: "asc" }, { productId: "asc" }],
  });

  const results: StockRuleTriggerResult[] = [];
  const byVendor = new Map<string, PoRuleRow[]>();

  for (const rule of rules) {
    if (!rule.vendorId) {
      results.push({
        ruleId: rule.id,
        triggerType: "po",
        created: null,
        skippedReason: "no_vendor",
      });
      continue;
    }
    const list = byVendor.get(rule.vendorId) ?? [];
    list.push(rule);
    byVendor.set(rule.vendorId, list);
  }

  for (const [vendorId, vendorRules] of byVendor) {
    const existingPo = await findOpenAutoPo(vendorId);

    const pending: Array<{
      rule: PoRuleRow;
      vendorProductId: string;
      vendorQty: number;
      vendorRate: number;
    }> = [];

    for (const rule of vendorRules) {
      const stock = await getEffectiveProductStock(rule.productId, rule.variantId);
      if (stock.effective >= rule.minQty) {
        results.push({
          ruleId: rule.id,
          triggerType: "po",
          created: null,
          skippedReason: "above_min",
        });
        continue;
      }

      const vp = await db.vendorProduct.findFirst({
        where: {
          vendorId,
          productId: rule.productId,
          variantId: rule.variantId ?? null,
          active: true,
        },
        orderBy: { priority: "asc" },
      });
      if (!vp) {
        results.push({
          ruleId: rule.id,
          triggerType: "po",
          created: null,
          skippedReason: "no_vendor_catalog",
        });
        continue;
      }

      const vendorQty = computeVendorOrderQty(rule, stock.effective, vp);
      pending.push({
        rule,
        vendorProductId: vp.id,
        vendorQty,
        vendorRate: vp.price,
      });
    }

    if (pending.length === 0) continue;

    const resolvedLines: ResolvedPoLine[] = [];
    for (const p of pending) {
      resolvedLines.push(
        await resolvePoLine(
          {
            productId: p.rule.productId,
            vendorProductId: p.vendorProductId,
            vendorQty: p.vendorQty,
            vendorRate: p.vendorRate,
          },
          vendorId
        )
      );
    }
    const addAmount = resolvedLines.reduce((s, l) => s + l.amount, 0);

    if (existingPo) {
      await db.$transaction(async (tx) => {
        for (const line of resolvedLines) {
          await tx.purchaseOrderItem.create({
            data: {
              poId: existingPo.id,
              productId: line.productId,
              qty: line.qty,
              rate: line.rate,
              amount: line.amount,
              vendorProductId: line.vendorProductId,
              vendorQty: line.vendorQty,
              vendorUom: line.vendorUom,
              vendorRate: line.vendorRate,
            },
          });
        }
        await tx.purchaseOrder.update({
          where: { id: existingPo.id },
          data: { amount: existingPo.amount + addAmount },
        });
      });
      for (const p of pending) {
        results.push({
          ruleId: p.rule.id,
          triggerType: "po",
          created: { type: "po", id: existingPo.id, documentNo: existingPo.poNo },
        });
      }
      continue;
    }

    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const poNo = await nextPoNo();
    const po = await db.purchaseOrder.create({
      data: {
        poNo,
        vendorId,
        date: new Date(),
        expectedDate: expected,
        amount: addAmount,
        status: "draft",
        notes: `${AUTO_PO_MARKER} Auto-reorder from stock rules.`,
        items: { create: resolvedLines },
      },
    });
    await recordChange("PurchaseOrder", po.id, "insert", po, userId);
    for (const p of pending) {
      results.push({
        ruleId: p.rule.id,
        triggerType: "po",
        created: { type: "po", id: po.id, documentNo: poNo },
      });
    }
  }

  return results;
};

const createAutoMo = async (
  rule: {
    id: string;
    productId: string;
    variantId: string | null;
    minQty: number;
    maxQty: number | null;
    bomId: string | null;
    bom: {
      id: string;
      productId: string;
      variantId: string | null;
      outputQty: number;
      defaultFacilityId: string | null;
      defaultFacility: { id: string; name: string } | null;
      defaultLineId: string | null;
      defaultMachine: { name: string } | null;
    } | null;
  },
  userId: string | null,
  binQty: number
) => {
  if (!rule.bomId || !rule.bom) {
    return { created: null, skippedReason: "no_bom" } as const;
  }
  if (!rule.bom.defaultFacilityId) {
    return { created: null, skippedReason: "no_default_facility" } as const;
  }
  const stock = await getEffectiveBinStock(binQty, rule.productId, rule.variantId);
  if (stock.effective >= rule.minQty) {
    return { created: null, skippedReason: "above_min" } as const;
  }
  if (await hasOpenMoForBom(rule.bomId)) {
    return { created: null, skippedReason: "open_mo_exists" } as const;
  }
  const batch = Math.max(1, rule.bom.outputQty);
  const target = rule.maxQty ?? rule.minQty * 2;
  const need = Math.max(0, target - stock.effective);
  const plannedQty =
    need > 0 ? Math.max(batch, Math.ceil(need / batch) * batch) : batch;
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
    monitorBinId: string | null;
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
  if (!rule.monitorBinId) {
    return { created: null, skippedReason: "no_monitor_bin" } as const;
  }
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

  // Build a human-readable note. Auto-replenish notes used to be just
  // the bare rule marker ("StockRule:<id> auto-replenish transfer"),
  // which is meaningless to anyone reading the transfers screen. We now
  // include the product, qty + uom, and the from/to warehouse codes so
  // operators see context at a glance. The marker is appended at the
  // END so hasOpenTransferForRule() (which does a `contains` lookup)
  // still works, and the UI can strip it cleanly for display.
  const productId = rule.sourceBin.productId ?? rule.productId;
  const [product, variant, fromWh, toWh] = await Promise.all([
    db.product.findUnique({
      where: { id: productId },
      select: { sku: true, name: true, uom: true },
    }),
    rule.variantId
      ? db.productVariant.findUnique({
          where: { id: rule.variantId },
          select: { sku: true, uom: true },
        })
      : Promise.resolve(null),
    db.warehouse.findUnique({
      where: { id: rule.sourceBin.warehouseId },
      select: { code: true },
    }),
    db.warehouse.findUnique({
      where: { id: destWhId },
      select: { code: true },
    }),
  ]);
  const itemLabel = variant
    ? `${variant.sku} (${product?.name ?? product?.sku ?? "item"})`
    : product
      ? `${product.sku} — ${product.name}`
      : "item";
  const uom = variant?.uom ?? product?.uom ?? "";
  const route = fromWh && toWh ? ` · ${fromWh.code} → ${toWh.code}` : "";
  const humanNote = `Auto-replenish · ${itemLabel} · ${qty}${uom ? " " + uom : ""}${route}`;

  const transferNo = await nextTransferNo();
  const toOrder = await db.transferOrder.create({
    data: {
      transferNo,
      kind: "replenishment",
      status: "ready",
      fromWarehouseId: rule.sourceBin.warehouseId,
      toWarehouseId: destWhId,
      notes: `${humanNote} · ${ruleMarker(rule.id)}`,
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

/** Evaluate bin-scoped rules watching this bin. */
export const checkStockRules = async (
  binId: string,
  userId: string | null,
  opts?: { skipGlobalPo?: boolean }
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
    const stock = await getEffectiveBinStock(currentQty, rule.productId, rule.variantId);
    if (stock.effective >= rule.minQty) {
      results.push({
        ruleId: rule.id,
        triggerType: rule.triggerType,
        created: null,
        skippedReason: "above_min",
      });
      continue;
    }

    if (rule.triggerType === "mo") {
      const out = await createAutoMo(rule, userId, currentQty);
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

  if (!opts?.skipGlobalPo) {
    results.push(...(await checkGlobalPoStockRules(userId)));
  }
  return results;
};

/** Run bin-scoped checks plus global PO rules (grouped by vendor). */
export const checkAllStockRules = async (userId: string | null) => {
  const rules = await db.stockRule.findMany({
    where: { active: true, monitorBinId: { not: null } },
    select: { monitorBinId: true },
    distinct: ["monitorBinId"],
  });
  const all: StockRuleTriggerResult[] = [];
  for (const r of rules) {
    if (!r.monitorBinId) continue;
    const part = await checkStockRules(r.monitorBinId, userId, { skipGlobalPo: true });
    all.push(...part);
  }
  all.push(...(await checkGlobalPoStockRules(userId)));
  return all;
};
